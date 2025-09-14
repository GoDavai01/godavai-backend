// utils/tax/taxClassifier.js
// Classifies an item into {hsn, gstRate} with caching.
// Order: explicit on item -> cached -> static rules -> GPT-4o-mini -> safe default.

const TaxMap = require("../../models/TaxMap");

const STATIC = [
  { rx: /(insulin|vaccine|bcg|polio|rabies|dialysis|anti[- ]?cancer|oncology)/i, hsn: "3004", gst: 5, why: "essential/life-saving" },
  { rx: /(tablet|tab\.?|capsule|cap\.?|syrup|ointment|cream|gel|drops?|injection|antibiotic|paracetamol|ibuprofen|metformin|omeprazole|pantoprazole|cetirizine|azithromycin)/i,
    hsn: "3004", gst: 12, why: "finished medicament retail sale" },
  { rx: /(bandage|gauze|plaster|wadding)/i, hsn: "3005", gst: 12, why: "dressings" },
  { rx: /(syringe|needle|catheter|iv set|bp monitor|stethoscope)/i, hsn: "9018", gst: 12, why: "medical devices" },
  { rx: /(thermometer)/i, hsn: "9025", gst: 18, why: "thermometer" },
  { rx: /(glucometer|test strip|ketone strip)/i, hsn: "9027", gst: 18, why: "measuring instruments" },
];

const ALLOWED_RATES = new Set([0, 5, 12, 18, 28]);
const AUTO_APPROVE_MIN = Number(process.env.TAX_AUTO_APPROVE_MIN || 0.82);
const DEFAULT_RATE = ALLOWED_RATES.has(Number(process.env.TAX_DEFAULT_MEDICINE_GST))
  ? Number(process.env.TAX_DEFAULT_MEDICINE_GST) : 12;

function clean(s = "") { return s.replace(/\s+/g, " ").trim(); }
function keyFrom(item) {
  const form = Array.isArray(item.category) ? item.category.join(" ")
    : (item.form || item.category || "");
  return clean(`${item.name || ""} ${item.brand || ""} ${form || ""}`).toLowerCase();
}

function staticGuess(name) {
  for (const r of STATIC) {
    if (r.rx.test(name)) return {
      hsn: r.hsn, gstRate: r.gst, source: "static", confidence: 0.9, reason: r.why,
    };
  }
  return null;
}

async function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  const OpenAI = (await import("openai")).default; // ESM-safe dynamic import
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function gptGuess(name, ctx) {
  const client = await getOpenAI();
  if (!client) return null;

  const model = process.env.GPT_MED_MODEL || "gpt-4o-mini";
  const messages = [
    { role: "system", content: "You are an Indian GST classifier. For the given medicine/medical item, output PROBABLE HSN (4/6 digit) and GST slab (0/5/12/18/28). Be conservative; if unsure, pick the most typical option and lower confidence." },
    { role: "user", content: `Item: ${name}\nExtra: ${JSON.stringify(ctx || {})}\nReturn STRICT JSON: {hsn:string,gstRate:number,confidence:number,reason:string}` },
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
        reason: j.reason || "",
      };
    }
  } catch { /* ignore */ }
  return null;
}

async function classifyHSNandGST(item) {
  const key = keyFrom(item);
  const nameForDisplay = clean(`${item.name || ""} ${item.brand || ""} ${item.form || item.category || ""}`);

  // 0) explicit
  if (item.hsn && typeof item.gstRate === "number" && ALLOWED_RATES.has(item.gstRate)) {
    return { hsn: String(item.hsn), gstRate: item.gstRate, source: "item", confidence: 1, approved: true };
  }

  // 1) cache
  const cached = await TaxMap.findOne({ key }).lean();
  if (cached) {
    return { hsn: cached.hsn, gstRate: cached.gstRate, source: cached.source, confidence: cached.confidence, approved: cached.approved };
  }

  // 2) static
  const s = staticGuess(nameForDisplay);
  if (s) {
    await TaxMap.create({ key, displayName: nameForDisplay, hsn: s.hsn, gstRate: s.gstRate, source: s.source, confidence: s.confidence, approved: true });
    return { ...s, approved: true };
  }

  // 3) GPT
  const g = await gptGuess(nameForDisplay, {
    brand: item.brand, form: item.form || item.category, composition: item.composition || item.ingredients || "",
  });

  if (g) {
    const approved = g.confidence >= AUTO_APPROVE_MIN;
    await TaxMap.create({ key, displayName: nameForDisplay, hsn: g.hsn, gstRate: g.gstRate, source: g.source, confidence: g.confidence, approved });
    return { ...g, approved };
  }

  // 4) default conservative
  const out = { hsn: "3004", gstRate: DEFAULT_RATE, source: "default", confidence: 0.4, approved: false };
  await TaxMap.create({ key, displayName: nameForDisplay, hsn: out.hsn, gstRate: out.gstRate, source: out.source, confidence: out.confidence, approved: false });
  return out;
}

module.exports = { classifyHSNandGST };
