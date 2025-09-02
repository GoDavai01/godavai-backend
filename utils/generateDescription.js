// utils/generateDescription.js
const axios = require("axios");

// NOTE: Do NOT call dotenv.config() here — load env once in server.js/app.js

/**
 * Generate a rich, customer-friendly description using GPT.
 * @param {Object|string} input  Either the medicine name string, or an object:
 *   { name, brand, composition, company, type }
 * @returns {Promise<string>}
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

  const prompt =
`Write a clear, customer-friendly description for "${displayName}"${composition ? ` (composition: ${composition})` : ""}${company ? ` by ${company}` : ""}, similar to good Indian pharmacy apps (e.g., 1mg, NetMeds).
Cover briefly:
1) What it is & why prescribed
2) How it works & key benefits (plain words)
3) General usage guidance (NO specific dosage numbers; say “as advised by a doctor”)
4) Safety notes (precautions, when to avoid, consult doctor, not a substitute for a prescription)

Tone: simple, trustworthy, and non-alarming. Avoid medical jargon, avoid dosage instructions or exhaustive contraindication lists. Keep to ~130–170 words.`;

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 360,
        temperature: 0.6,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "User-Agent": "GoDavaii/1.0 (medicine-description)"
        },
        timeout: 20000
      }
    );

    const text = res?.data?.choices?.[0]?.message?.content?.trim();
    return text || "No description available.";
  } catch (err) {
    // Show API error body if present to help you debug on Render logs
    console.error("🔴 OpenAI generateMedicineDescription error:", err.response?.data || err.message);
    return "No description available.";
  }
}

module.exports = generateMedicineDescription;
