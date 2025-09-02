// utils/generateDescription.js
const axios = require("axios");

// Do NOT call dotenv.config() here — it should only be done once in your main app entry file

async function generateMedicineDescription(name) {
  if (!name) return "No description available.";

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set in environment variables.");
    return "No description available.";
  }

  // Pick model from env (default = gpt-4o-mini)
  const model = process.env.GPT_MED_MODEL || "gpt-4o-mini";

  // Rich, customer-friendly description
  const prompt = `Write a clear, customer-friendly description for the medicine "${name}" 
similar to descriptions shown on pharmacy apps like 1mg or NetMeds. 
Include:
- What it is and why prescribed
- How it works and benefits
- General usage guidance (not dosage)
- Important safety notes (precautions, avoid self-medication)

Keep it around 120–160 words, professional but simple, avoiding medical jargon.`;

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300, // enough for ~200 words
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "User-Agent": "GoDavaii/1.0 (medicine-description)", // optional
        },
        timeout: 20000, // 20s timeout for longer text
      }
    );

    const desc = res.data.choices?.[0]?.message?.content?.trim();
    if (!desc) throw new Error("No valid response from OpenAI");
    return desc;
  } catch (err) {
    console.error("🔴 OpenAI Error:", err.response?.data || err.message, err);
    return "No description available.";
  }
}

module.exports = generateMedicineDescription;
