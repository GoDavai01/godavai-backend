const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DIR = path.join(process.cwd(), "uploads", "ai-audio-temp");
let cachedClient = null;

function ensureDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function getOpenAIClient() {
  if (cachedClient) return cachedClient;
  if (!process.env.OPENAI_API_KEY) return null;

  let OpenAI = require("openai");
  OpenAI = OpenAI?.default || OpenAI;
  cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cachedClient;
}

async function withTempFile(file, fallbackExt, fn) {
  ensureDir();
  const ext = path.extname(file?.originalname || "") || fallbackExt || ".bin";
  const name = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`;
  const p = path.join(TMP_DIR, name);
  await fs.promises.writeFile(p, file.buffer);
  try {
    return await fn(p);
  } finally {
    fs.promises.unlink(p).catch(() => {});
  }
}

async function transcribeAudio(file) {
  const client = getOpenAIClient();
  if (!client) return "";

  try {
    return await withTempFile(file, ".webm", async (p) => {
      const out = await client.audio.transcriptions.create({
        file: fs.createReadStream(p),
        model: process.env.AI_STT_MODEL || "gpt-4o-mini-transcribe",
      });
      return String(out?.text || "").trim();
    });
  } catch (err) {
    console.error("AI STT failed:", err?.message || err);
    return "";
  }
}

async function synthesizeSpeech({ text, language }) {
  const clean = String(text || "").trim();
  if (!clean) return { audioBase64: "" };

  const client = getOpenAIClient();
  if (!client) return { audioBase64: "" };

  const voice = String(process.env.AI_TTS_VOICE || "ash");

  // ✅ FIX: Much better Hinglish TTS instructions
  // Previous issue: voice was pronouncing Hindi words in English accent
  // and English words in Hindi accent randomly
  const hindiInstructions = [
    "Speak clearly in Hindi (Devanagari pronunciation).",
    "Use a warm, caring, professional doctor-like tone.",
    "Pronounce medical terms (like hemoglobin, creatinine, paracetamol) in their standard English pronunciation.",
    "Speak at a natural conversational pace, not too fast.",
  ].join(" ");

  const hinglishInstructions = [
    "You are speaking in Hinglish — a natural mix of Hindi and English as spoken in urban India.",
    "CRITICAL PRONUNCIATION RULES:",
    "- Hindi words must be pronounced with proper Hindi/Devanagari pronunciation (e.g., 'dawai' = दवाई, 'doodh' = दूध, 'haldi' = हल्दी).",
    "- English medical terms must be pronounced in standard English (e.g., 'hemoglobin', 'vitamin D', 'creatinine', 'paracetamol').",
    "- Common Hinglish fillers like 'basically', 'actually', 'so' should be in English pronunciation.",
    "- Numbers can be in English.",
    "- DO NOT pronounce Hindi words with an English accent.",
    "- DO NOT pronounce English words with a Hindi accent.",
    "Tone: warm, caring, like a friendly Indian doctor explaining to a patient. Natural conversational pace.",
  ].join(" ");

  const englishInstructions = [
    "Speak clearly in English with a warm, professional medical tone.",
    "Pronounce all medical terms clearly and correctly.",
    "Use a caring, doctor-like conversational pace.",
  ].join(" ");

  const instructions = language === "hi"
    ? hindiInstructions
    : language === "hinglish"
      ? hinglishInstructions
      : englishInstructions;

  try {
    const out = await client.audio.speech.create({
      model: process.env.AI_TTS_MODEL || "gpt-4o-mini-tts",
      voice,
      input: clean.slice(0, 4000),
      instructions,
      format: "mp3",
    });

    const ab = await out.arrayBuffer();
    return { audioBase64: Buffer.from(ab).toString("base64") };
  } catch (err) {
    console.error("AI TTS failed:", err?.message || err);
    return { audioBase64: "" };
  }
}

module.exports = {
  transcribeAudio,
  synthesizeSpeech,
};