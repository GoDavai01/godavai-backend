// utils/generateDescription.js
const axios = require("axios");

// Do NOT call dotenv.config() here. Do it only ONCE in your main app entry file!

async function generateMedicineDescription(name) {
  if (!name) return "No description available.";

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set in environment variables.");
    return "No description available.";
  }

  const prompt = `In 35 words, explain what the medicine "${name}" is used for, how it helps, and what condition it treats. Only give medically helpful description.`;

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 80,
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "User-Agent": "GoDavai/1.0 (medicine-description)" // optional
        },
        timeout: 10000 // 10 seconds timeout (optional but recommended)
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
