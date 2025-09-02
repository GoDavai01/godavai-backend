// utils/generateDescription.js
const axios = require("axios");

// --- helper: normalize to max 5 short bullets, plain text ---
function toBullets(s, max = 5) {
  if (!s) return "";
  const lines = String(s)
    .split(/\r?\n/)
    .map(l => l.replace(/^[•*\-\d\.\)\s]+/, "").trim())  // strip any leading markers
    .filter(Boolean)
    .slice(0, max)
    .map(l => (l.length > 160 ? l.slice(0,157) + "…" : l)) // hard cap per line
    .map(l => "• " + l);
  return lines.join("\n");
}

/**
 * Generate a compact, customer-friendly description.
 * Returns plain-text bullets separated by newlines.
 */
async function generateMedicineDescription(input) {
  const meta = typeof input === "string" ? { name: input } : (input || {});
  const { name = "", brand = "", composition = "", company = "", type = "" } = meta;

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY is not set.");
    return "No description available.";
  }

  const model = process.env.GPT_MED_MODEL || "gpt-4o-mini";
  const displayName =
    (brand && brand.trim()) ||
    (name && name.trim()) ||
    [composition, type].filter(Boolean).join(" ").trim() ||
    "this medicine";

  // >>> NEW COMPACT PROMPT <<<
  const prompt =
`Write a VERY SHORT, plain-text blurb for "${displayName}"${composition ? ` (composition: ${composition})` : ""}${company ? ` by ${company}` : ""}, like top Indian pharmacy apps.

Output exactly 5 bullet lines. No headings. No markdown. No emojis.
Each line 8–14 words, clear and simple. Indian context English.

Bullets, in order:
1) What it is / common use
2) Key benefits (layman words)
3) How it works (one line)
4) Usage guidance: say "Use as advised by a doctor." (no numbers)
5) Safety notes: when to avoid + consult a doctor

Absolutely do NOT include dosage numbers, long warnings, or extra lines.
Return ONLY the 5 lines (no extra text).`;

  try {
    console.log("🟢 generateMedicineDescription using", model, "for", displayName);

    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.4,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "User-Agent": "GoDavaii/1.0 (medicine-description)",
        },
        timeout: 20000,
      }
    );

    const raw = res?.data?.choices?.[0]?.message?.content?.trim();
    const compact = toBullets(raw, 5);
    return compact || "No description available.";
  } catch (err) {
    console.error("🔴 OpenAI generateMedicineDescription error:", err.response?.data || err.message);
    return "No description available.";
  }
}

module.exports = generateMedicineDescription;
