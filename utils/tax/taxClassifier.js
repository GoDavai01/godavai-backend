// utils/tax/taxClassifier.js
// Classifies an item into { hsn, gstRate } with caching in MongoDB.
// Decision order:
//   0) explicit on item
//   1) cache (TaxMap)  ← policy override applied on read
//   2a) explicit ZERO-GST whitelist (data/gst-zero-33.json via utils/tax/zeroList.js)
//   2) pragmatic static rules
//   3) web consensus (Google CSE, gov.in weighted)  ← see utils/tax/webLookup.js
//   4) optional GPT fallback (off by default)
//   5) conservative default (HSN 3004, DEFAULT_RATE)
//
// ENV:
//  TAX_AUTO_APPROVE_MIN=0.88
//  TAX_DEFAULT_MEDICINE_GST=12
//  TAX_USE_GPT_FALLBACK=0|1  (default 0)
//  (web lookup env lives in utils/tax/webLookup.js)
//  NOTE: Post-22-Sep slab override is enforced below (overrideRatePostChange)

"use strict";

const TaxMap = require("../../models/TaxMap");
const { webLookup } = require("./webLookup");
const { matchZeroGst } = require("./zeroList");

// ---------- config ----------
const ALLOWED_RATES = new Set([0, 5, 12, 18, 28]);
const AUTO_APPROVE_MIN = Number(process.env.TAX_AUTO_APPROVE_MIN || 0.88);
const DEFAULT_RATE = ALLOWED_RATES.has(Number(process.env.TAX_DEFAULT_MEDICINE_GST))
  ? Number(process.env.TAX_DEFAULT_MEDICINE_GST)
  : 12;
const USE_GPT = process.env.TAX_USE_GPT_FALLBACK === "1";

// ---- GST policy flip from 22-Sep (IST) ----
const EFFECTIVE_CHANGE = new Date("2025-09-22T00:00:00+05:30");
function isLifeSavingKeyword(name) {
  return /(insulin|vaccine|bcg|opv|rabies|anti[- ]?rabies|dialysis|anti[- ]?cancer|oncology)/i.test(
    name
  );
}
/**
 * From 22-Sep (IST):
 *   - Life-saving set → 0%
 *   - Medicaments & diagnostic reagents (3003/3004/3822) → 5%
 *   - Common devices (9018/9025/9027) → 12%
 * Otherwise keep the proposed rate.
 */
function overrideRatePostChange(hsn, name, proposedRate) {
  if (Date.now() < EFFECTIVE_CHANGE.getTime()) return proposedRate;
  const h = String(hsn || "");
  if (isLifeSavingKeyword(name)) return 0;
  if (/^(3003|3004|3822)/.test(h)) return 5;
  if (/^(9018|9025|9027)/.test(h)) return 12;
  return proposedRate;
}

// ---------- helpers ----------
function clean(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}
function keyFrom(item) {
  const form = Array.isArray(item?.category)
    ? item.category.join(" ")
    : item?.form || item?.category || "";
  return clean(`${item?.name || ""} ${item?.brand || ""} ${form || ""}`).toLowerCase();
}
function approveByConfidence(conf) {
  return conf >= AUTO_APPROVE_MIN;
}

// ---------- pragmatic static patterns ----------
const STATIC = [
  {
    rx: /(insulin|vaccine|bcg|opv|rabies|anti[- ]?rabies|dialysis|anti[- ]?cancer|oncology)/i,
    hsn: "3004",
    gst: 5,
    why: "essential / life-saving",
  },
  {
    rx: /(tablet|tab\.?|capsule|cap\.?|syrup|susp(?:ension)?|ointment|cream|gel|drop|drops|injection|paracetamol|ibuprofen|metformin|omeprazole|pantoprazole|azithromycin|cetirizine|antibiotic)/i,
    hsn: "3004",
    gst: 12,
    why: "finished medicament retail sale",
  },
  { rx: /(bandage|gauze|wadding|plaster)/i, hsn: "3005", gst: 12, why: "dressings" },
  {
    rx: /(syringe|needle|cannula|catheter|iv set|bp monitor|stethoscope|nebulizer|oximeter)/i,
    hsn: "9018",
    gst: 12,
    why: "medical devices",
  },
  { rx: /(thermometer)/i, hsn: "9025", gst: 18, why: "thermometer" },
  { rx: /(glucometer|test strip|ketone strip)/i, hsn: "9027", gst: 18, why: "measuring instruments" },
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
    {
      role: "system",
      content:
        "You are an Indian GST classifier. Output probable HSN (4–8 digits) and GST slab (0/5/12/18/28). Be conservative and lower confidence if unsure.",
    },
    {
      role: "user",
      content: `Item: ${name}\nExtra: ${JSON.stringify(
        ctx || {}
      )}\nReturn STRICT JSON: {hsn:string,gstRate:number,confidence:number,reason:string}`,
    },
  ];

  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages,
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
        reason: j.reason || "",
      };
    }
  } catch {}
  return null;
}

// ---------- main ----------
async function classifyHSNandGST(item) {
  const key = keyFrom(item);
  const nameForDisplay = clean(
    `${item?.name || ""} ${item?.brand || ""} ${item?.form || item?.category || ""}`
  );

  // 0) explicit on item
  if (item?.hsn && typeof item?.gstRate === "number" && ALLOWED_RATES.has(item.gstRate)) {
    const finalExplicitRate = overrideRatePostChange(item.hsn, nameForDisplay, item.gstRate);
    return {
      hsn: String(item.hsn),
      gstRate: finalExplicitRate,
      source: "item",
      confidence: 1,
      approved: true,
    };
  }

  // 1) cache (with policy override on read)
  const cached = await TaxMap.findOne({ key }).lean();
  if (cached) {
    const patchedRate = overrideRatePostChange(cached.hsn, nameForDisplay, cached.gstRate);
    if (patchedRate !== cached.gstRate) {
      await TaxMap.updateOne({ key }, { $set: { gstRate: patchedRate, updatedAt: new Date() } });
    }
    return {
      hsn: cached.hsn,
      gstRate: patchedRate,
      source: cached.source,
      confidence: cached.confidence,
      approved: cached.approved,
    };
  }

  // 2a) explicit ZERO-GST whitelist (authoritative, highest priority among static)
  {
    const hit = matchZeroGst(nameForDisplay);
    if (hit) {
      const decided = {
        hsn: hit.hsn || "3004",
        gstRate: 0,
        source: "static.zero",
        confidence: 0.99,
      };
      await TaxMap.updateOne(
        { key },
        {
          $set: {
            key,
            displayName: nameForDisplay,
            hsn: decided.hsn,
            gstRate: decided.gstRate,
            source: decided.source,
            confidence: decided.confidence,
            approved: true,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      return { ...decided, approved: true };
    }
  }

  // 2) pragmatic static patterns
  const s = staticGuess(nameForDisplay);
  if (s) {
    const finalRate = overrideRatePostChange(s.hsn, nameForDisplay, s.gstRate);
    await TaxMap.updateOne(
      { key },
      {
        $set: {
          key,
          displayName: nameForDisplay,
          hsn: s.hsn,
          gstRate: finalRate,
          source: s.source,
          confidence: s.confidence,
          approved: true,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return { ...s, gstRate: finalRate, approved: true };
  }

  // 3) web consensus (Google CSE)
  const w = await webLookup(nameForDisplay);
  if (w && (w.hsn || Number.isFinite(w.gstRate))) {
    const rateFromWeb = Number.isFinite(w.gstRate) ? w.gstRate : DEFAULT_RATE;
    const normalizedRate = overrideRatePostChange(w.hsn || "3004", nameForDisplay, rateFromWeb);
    const conf = Number.isFinite(w.confidence) ? w.confidence : 0.75;
    const approved = approveByConfidence(conf) && ALLOWED_RATES.has(normalizedRate);

    await TaxMap.updateOne(
      { key },
      {
        $set: {
          key,
          displayName: nameForDisplay,
          hsn: w.hsn || "3004",
          gstRate: normalizedRate,
          source: w.source || "web",
          confidence: conf,
          approved,
          evidenceUrl: w.evidence?.url || "",
          evidenceTitle: w.evidence?.title || "",
          evidenceSnippet: w.evidence?.snippet || "",
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return {
      hsn: w.hsn || "3004",
      gstRate: normalizedRate,
      source: w.source || "web",
      confidence: conf,
      approved,
    };
  }

  // 4) GPT fallback (optional)
  if (USE_GPT) {
    const g = await gptGuess(nameForDisplay, {
      brand: item?.brand,
      form: item?.form || item?.category,
      composition: item?.composition || item?.ingredients || "",
    });

    if (g) {
      const finalRate = overrideRatePostChange(g.hsn, nameForDisplay, g.gstRate);
      const approved = approveByConfidence(g.confidence) && ALLOWED_RATES.has(finalRate);

      await TaxMap.updateOne(
        { key },
        {
          $set: {
            key,
            displayName: nameForDisplay,
            hsn: g.hsn,
            gstRate: finalRate,
            source: g.source,
            confidence: g.confidence,
            approved,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      return { ...g, gstRate: finalRate, approved };
    }
  }

  // 5) conservative default
  const outRate = overrideRatePostChange("3004", nameForDisplay, DEFAULT_RATE);
  const out = {
    hsn: "3004",
    gstRate: outRate,
    source: "default",
    confidence: 0.4,
    approved: false,
  };

  await TaxMap.updateOne(
    { key },
    {
      $set: {
        key,
        displayName: nameForDisplay,
        hsn: out.hsn,
        gstRate: out.gstRate,
        source: out.source,
        confidence: out.confidence,
        approved: out.approved,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  return out;
}

module.exports = { classifyHSNandGST, keyFrom, staticGuess };
