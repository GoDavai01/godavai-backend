// utils/tax/taxClassifier.js
// Classifies an item into { hsn, gstRate } with caching in MongoDB.
// Order of decision:
//  0) explicit on item
//  1) cache (TaxMap)
//  2) static rules
//  3) web consensus (Bing + Google CSE, with gov.in weighting)
//  4) optional GPT fallback (off by default)
//  5) conservative default (HSN 3004, 12%)
//
// ENV:
//  TAX_AUTO_APPROVE_MIN=0.88
//  TAX_DEFAULT_MEDICINE_GST=12
//  TAX_USE_GPT_FALLBACK=0|1  (default 0; enable only if you want GPT after web)
//  (web lookup keys live in utils/tax/webLookup.js envs)

"use strict";

const TaxMap = require("../../models/TaxMap");
const { webLookup } = require("./webLookup");

// ---------- config ----------
const ALLOWED_RATES = new Set([0, 5, 12, 18, 28]);
const AUTO_APPROVE_MIN = Number(process.env.TAX_AUTO_APPROVE_MIN || 0.88);
const DEFAULT_RATE = ALLOWED_RATES.has(Number(process.env.TAX_DEFAULT_MEDICINE_GST))
  ? Number(process.env.TAX_DEFAULT_MEDICINE_GST) : 12;
const USE_GPT = process.env.TAX_USE_GPT_FALLBACK === "1";

// ---------- helpers ----------
function clean(s = "") { return String(s).replace(/\s+/g, " ").trim(); }
function keyFrom(item) {
  const form = Array.isArray(item?.category) ? item.category.join(" ")
    : (item?.form || item?.category || "");
  return clean(`${item?.name || ""} ${item?.brand || ""} ${form || ""}`).toLowerCase();
}

function approveByConfidence(conf) {
  return conf >= AUTO_APPROVE_MIN;
}

// A few pragmatic static patterns that cover most traffic
const STATIC = [
  { rx: /(insulin|vaccine|bcg|opv|rabies|anti[- ]?rabies|dialysis|anti[- ]?cancer|oncology)/i,
    hsn: "3004", gst: 5, why: "essential / life-saving" },
  { rx: /(tablet|tab\.?|capsule|cap\.?|syrup|susp(?:ension)?|ointment|cream|gel|drop|drops|injection|paracetamol|ibuprofen|metformin|omeprazole|pantoprazole|azithromycin|cetirizine|antibiotic)/i,
    hsn: "3004", gst: 12, why: "finished medicament retail sale" },
  { rx: /(bandage|gauze|wadding|plaster)/i,
    hsn: "3005", gst: 12, why: "dressings" },
  { rx: /(syringe|needle|cannula|catheter|iv set|bp monitor|stethoscope|nebulizer|oximeter)/i,
    hsn: "9018", gst: 12, why: "medical devices" },
  { rx: /(thermometer)/i,
    hsn: "9025", gst: 18, why: "thermometer" },
  { rx: /(glucometer|test strip|ketone strip)/i,
    hsn: "9027", gst: 18, why: "measuring instruments" },
];

function staticGuess(name) {
  for (const r of STATIC) {
    if (r.rx.test(name)) {
      return { hsn: r.hsn, gstRate: r.gst, source: "static", confidence: 0.9, reason: r.why };
    }
  }
  return null;
}

// ---------- optional GPT fallback ----------
async function getOpenAI() {
  if (!USE_GPT || !process.env.OPENAI_API_KEY) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function gptGuess(name, ctx) {
  const client = await getOpenAI();
  if (!client) return null;

  const model = process.env.GPT_MED_MODEL || "gpt-4o-mini";
  const messages = [
    { role: "system",
      content: "You are an Indian GST classifier. Output probable HSN (4–8 digits) and GST slab (0/5/12/18/28). Be conservative and lower confidence if unsure." },
    { role: "user",
      content: `Item: ${name}\nExtra: ${JSON.stringify(ctx || {})}\nReturn STRICT JSON: {hsn:string,gstRate:number,confidence:number,reason:string}` }
  ];

  const res = await client.chat.completions.create({
    model, temperature: 0, response_format: { type: "json_object" }, messages,
  });

  try {
    const j = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const rate = Number(j.gstRate);
    if (j?.hsn && Number.isFinite(rate) && ALLOWED_RATES.has(rate)) {
      return {
        hsn: String(j.hsn),
        gstRate: rate,
        source: "gpt",
        confidence: Math.max(0, Math.min(1, Number(j.confidence || 0.6))),
        reason: j.reason || ""
      };
    }
  } catch {}
  return null;
}

// ---------- main ----------
async function classifyHSNandGST(item) {
  const key = keyFrom(item);
  const nameForDisplay = clean(`${item?.name || ""} ${item?.brand || ""} ${item?.form || item?.category || ""}`);

  // 0) explicit on item
  if (item?.hsn && typeof item?.gstRate === "number" && ALLOWED_RATES.has(item.gstRate)) {
    return { hsn: String(item.hsn), gstRate: item.gstRate, source: "item", confidence: 1, approved: true };
  }

  // 1) cache
  const cached = await TaxMap.findOne({ key }).lean();
  if (cached) {
    return {
      hsn: cached.hsn,
      gstRate: cached.gstRate,
      source: cached.source,
      confidence: cached.confidence,
      approved: cached.approved
    };
  }

  // 2) static
  const s = staticGuess(nameForDisplay);
  if (s) {
    await TaxMap.updateOne(
      { key },
      { $set: {
          key,
          displayName: nameForDisplay,
          hsn: s.hsn, gstRate: s.gstRate,
          source: s.source, confidence: s.confidence,
          approved: true, updatedAt: new Date()
        }},
      { upsert: true }
    );
    return { ...s, approved: true };
  }

  // 3) web consensus (Bing + Google CSE)
  const w = await webLookup(nameForDisplay);
  if (w && (w.hsn || Number.isFinite(w.gstRate))) {
    const rate = Number.isFinite(w.gstRate) ? w.gstRate : DEFAULT_RATE;
    const conf = Number.isFinite(w.confidence) ? w.confidence : 0.75;
    const approved = approveByConfidence(conf) && ALLOWED_RATES.has(rate);

    await TaxMap.updateOne(
      { key },
      { $set: {
          key,
          displayName: nameForDisplay,
          hsn: w.hsn || "3004",
          gstRate: ALLOWED_RATES.has(rate) ? rate : DEFAULT_RATE,
          source: w.source || "web",
          confidence: conf,
          approved,
          evidenceUrl: w.evidence?.url || "",
          evidenceTitle: w.evidence?.title || "",
          evidenceSnippet: w.evidence?.snippet || "",
          updatedAt: new Date()
        }},
      { upsert: true }
    );

    return {
      hsn: w.hsn || "3004",
      gstRate: ALLOWED_RATES.has(rate) ? rate : DEFAULT_RATE,
      source: w.source || "web",
      confidence: conf,
      approved
    };
  }

  // 4) GPT fallback (optional)
  if (USE_GPT) {
    const g = await gptGuess(nameForDisplay, {
      brand: item?.brand,
      form: item?.form || item?.category,
      composition: item?.composition || item?.ingredients || ""
    });

    if (g) {
      const approved = approveByConfidence(g.confidence);
      await TaxMap.updateOne(
        { key },
        { $set: {
            key,
            displayName: nameForDisplay,
            hsn: g.hsn, gstRate: g.gstRate,
            source: g.source, confidence: g.confidence,
            approved, updatedAt: new Date()
          }},
        { upsert: true }
      );
      return { ...g, approved };
    }
  }

  // 5) conservative default
  const out = { hsn: "3004", gstRate: DEFAULT_RATE, source: "default", confidence: 0.4, approved: false };
  await TaxMap.updateOne(
    { key },
    { $set: {
        key, displayName: nameForDisplay,
        hsn: out.hsn, gstRate: out.gstRate,
        source: out.source, confidence: out.confidence,
        approved: out.approved, updatedAt: new Date()
      }},
    { upsert: true }
  );
  return out;
}

module.exports = { classifyHSNandGST, keyFrom, staticGuess };
