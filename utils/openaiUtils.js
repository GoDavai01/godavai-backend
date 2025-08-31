const { Configuration, OpenAIApi } = require("openai");
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

// LLM Prompt: Parse OCR text to structured format
async function callLLMForPrescription(ocrText) {
  const prompt = `
Extract the following details from the prescription text below:
- Patient Name
- Age/Gender
- List of Medicines (name, dosage, duration, notes if any)
- Any instructions

Return JSON format like:
{
  "name": "...",
  "age": "...",
  "medicines": [
    {"name": "...", "dosage": "...", "duration": "...", "notes": "..."},
    ...
  ]
}

Prescription text:
"""${ocrText}"""
  `;
  const response = await openai.createChatCompletion({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
    max_tokens: 500,
  });
  const text = response.data.choices[0].message.content.trim();
  // Parse JSON from LLM
  try {
    return JSON.parse(text);
  } catch {
    // fallback: try to extract JSON using regex
    const json = text.match(/\{[\s\S]*\}/);
    return json ? JSON.parse(json[0]) : {};
  }
}

module.exports = { callLLMForPrescription };
