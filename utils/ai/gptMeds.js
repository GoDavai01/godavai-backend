// utils/ai/gptMeds.js
// Post-filter OCR text with GPT-4o-mini to keep ONLY medicines.
// Safe to skip if OPENAI_API_KEY missing or GPT_MED_STAGE disabled.

const OPENAI_MODEL = process.env.GPT_MED_MODEL || "gpt-4o-mini";

function buildPrompt(ocrBodyText) {
  return [
    {
      role: "system",
      content:
        "You convert noisy OCR’d prescription text to a JSON list of ONLY medicines. " +
        "Discard everything else (patient, doctor, dates, directions, doses schedules like 1-0-1, durations, meal instructions, clinic headers). " +
        "Extract medicine lines with the best possible normalized fields. Never hallucinate."
    },
    {
      role: "user",
      content:
        "From the text below, return ONLY a JSON object with key 'items' which is an array of medicines.\n" +
        "Each medicine has: name (string), strength (string or ''), form (string or ''), qty (integer >=1).\n" +
        "Rules:\n" +
        "- name: generic or brand as written; no doctor/clinic words; trim junk.\n" +
        "- strength: like '650 mg', '500mg', '5 ml', '' if truly absent.\n" +
        "- form: tablet/capsule/syrup/ointment/drop/solution/injection/gel/cream/etc., '' if absent.\n" +
        "- qty: integer count if present, else 1.\n" +
        "- DO NOT include directions (e.g., 1-0-1, x5 days, after meals) or diagnostics.\n\n" +
        "Text:\n" + ocrBodyText
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
    temperature: 0.1,
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
  const items = parsed.items
    .map(it => ({
      name: String(it.name || "").trim(),
      strength: String(it.strength || "").trim(),
      form: String(it.form || "").trim(),
      qty: Math.max(1, parseInt(it.qty || 1, 10) || 1),
    }))
    .filter(it => it.name && /[A-Za-z]{2,}/.test(it.name));

  return { items };
}

module.exports = { gptFilterMedicines };
