// utils/ai/gptMeds.js
// Post-filter OCR text with GPT-4o-mini to keep ONLY medicines.
// Safe to skip if OPENAI_API_KEY missing or GPT_MED_STAGE disabled.

const { hasDrug, bestMatch } = require("../pharma/spellfix");
const OPENAI_MODEL = process.env.GPT_MED_MODEL || "gpt-4o-mini";

function buildPrompt(ocrBodyText) {
  return [
    {
      role: "system",
      content:
        "You convert noisy OCR’d prescription text into ONLY medicines as JSON.\n" +
        "Discard patient/doctor/headers/directions/durations (e.g., 1-0-1, x5 days, morning/night).\n" +
        "Correct obvious brand/generic spellings when unambiguous; do NOT invent drugs.\n" +
        "Names must NOT be just form words (tab, tablet, cap, capsule, syrup, vial, drop, solution, injection, gel, cream, ointment, lotion, spray) " +
        "and must not be bullets like '1' or 'x'."
    },
    {
      role: "user",
      content:
        "Return STRICT JSON with key 'items' (array). Each item has:\n" +
        "- name: corrected brand OR generic (string, NOT starting with 'Tab ' or 'Cap ', and not a form word)\n" +
        "- strength: e.g., '650 mg', '5 ml', '' if missing\n" +
        "- form: one of tablet/capsule/syrup/drop/solution/injection/gel/cream/ointment/lotion/spray or ''\n" +
        "- qty: integer >= 1 (default 1)\n" +
        "Do not include directions like 1-0-1 / x5 days / after meals.\n\n" +
        "TEXT:\n" + ocrBodyText
    }
  ];
}

async function gptFilterMedicines(ocrBodyText) {
  if (!process.env.OPENAI_API_KEY) {
    return null; // let caller fallback
  }

  // Lazy import to avoid hard dependency if not used
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // json_object forces well-formed JSON
  const messages = buildPrompt(ocrBodyText);
  const res = await client.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: "json_object" },
    messages,
    temperature: 0.0,
    top_p: 0.1,
  });

  let parsed;
  try {
    parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
  } catch {
    return null;
  }
  // Expect { items: [...] }
  if (!parsed || !Array.isArray(parsed.items)) return null;

  // Sanitize & coerce
  const FORM_WORD = /^(tab(?:let)?|cap(?:sule)?|syrup|susp(?:ension)?|drop|solution|soln|injection|gel|cream|ointment|lotion|spray|vial)$/i;

  const items = parsed.items
    .map(it => ({
      name: String(it.name || "").trim().replace(/^\s*(tab(?:let)?|cap(?:sule)?)\b[.\s:-]*/i, ""),
      strength: String(it.strength || "").trim(),
      form: String(it.form || "").trim(),
      qty: Math.max(1, parseInt(it.qty || 1, 10) || 1),
    }))
    .filter(it =>
      it.name &&
      !FORM_WORD.test(it.name) &&
      /[A-Za-z]{3,}/.test(it.name)
    );

  // ——— Validate against dictionary (DROP unknowns) ———
  const items2 = items.map(i => {
    if (hasDrug(i.name)) return i;
    const bm = bestMatch(i.name, 0.93);  // strict for GPT outputs
    return (bm && bm.word) ? { ...i, name: bm.word } : null;
  }).filter(Boolean);

  if (!items2.length) return null;

  return { items: items2 };
}

module.exports = { gptFilterMedicines };
