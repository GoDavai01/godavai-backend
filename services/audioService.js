// services/audioService.js — GoDavaii 2035 Audio Service
// ✅ Multi-language TTS (10+ Indian languages)
// ✅ Better pronunciation instructions
// ✅ Hinglish transcription returns Roman Hindi
// ✅ Hindi transcription can stay in Devanagari
// ✅ TTS uses stronger language-specific instructions
// ✅ Proper error recovery

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

function buildTranscriptionPrompt(languagePreference, transcriptMode) {
  const lang = String(languagePreference || "auto").toLowerCase();
  const mode = String(transcriptMode || "native").toLowerCase();

  if (lang === "hinglish" || mode === "romanized") {
    return [
      "Transcribe spoken Hindi/Hinglish into natural Roman Hindi.",
      "IMPORTANT: Do NOT use Devanagari script.",
      "Return text like: mujhe bukhar hai, gale me dard hai.",
      "Keep English medical words in English.",
      "Keep it clean, natural, and user-typed looking.",
    ].join(" ");
  }

  if (lang === "hindi") {
    return [
      "Transcribe spoken Hindi in Devanagari script.",
      "Keep medical terms in English only if commonly spoken that way.",
      "Return natural readable Hindi.",
    ].join(" ");
  }

  if (lang === "english") {
    return [
      "Transcribe in English only.",
      "Do not convert English speech into Hindi.",
    ].join(" ");
  }

  return [
    "Transcribe naturally in the same language style the speaker is using.",
    "If the speaker is mixing Hindi and English in Roman style, prefer Roman Hindi over Devanagari.",
  ].join(" ");
}

async function maybeRomanizeHindiTranscript(text) {
  const clean = String(text || "").trim();
  if (!clean) return "";

  if (!/[\u0900-\u097F]/.test(clean)) return clean;

  const client = getOpenAIClient();
  if (!client) return clean;

  try {
    const out = await client.chat.completions.create({
      model: process.env.AI_CHAT_MODEL || "gpt-4o-mini",
      temperature: 0,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: [
            "Convert Hindi Devanagari text into natural everyday Roman Hindi.",
            "Do not translate meaning.",
            "Do not make it formal.",
            "Keep medical English words in English.",
            "Return only the converted text.",
          ].join(" "),
        },
        {
          role: "user",
          content: clean,
        },
      ],
    });

    return String(out?.choices?.[0]?.message?.content || clean).trim();
  } catch (err) {
    console.error("Romanization failed:", err?.message || err);
    return clean;
  }
}

async function transcribeAudio(file, opts = {}) {
  const client = getOpenAIClient();
  if (!client) return "";

  const languagePreference = String(opts?.replyLanguagePreference || "auto").toLowerCase();
  const transcriptMode = String(opts?.transcriptMode || "native").toLowerCase();
  const prompt = buildTranscriptionPrompt(languagePreference, transcriptMode);

  try {
    const text = await withTempFile(file, ".webm", async (p) => {
      const out = await client.audio.transcriptions.create({
        file: fs.createReadStream(p),
        model: process.env.AI_STT_MODEL || "gpt-4o-mini-transcribe",
        prompt,
      });
      return String(out?.text || "").trim();
    });

    if (!text) return "";

    if (languagePreference === "hinglish" || transcriptMode === "romanized") {
      return await maybeRomanizeHindiTranscript(text);
    }

    return text;
  } catch (err) {
    console.error("AI STT failed:", err?.message || err);
    return "";
  }
}

function pickTtsVoice(language) {
  const lang = String(language || "english").toLowerCase();

  const perLanguageVoice =
    process.env[`AI_TTS_VOICE_${lang.toUpperCase()}`] ||
    process.env.AI_TTS_VOICE;

  return String(perLanguageVoice || "ash");
}

function getTtsInstructions(language) {
  const lang = String(language || "auto").toLowerCase();

  const baseRules = [
    "Tone: warm, caring, calm, like a good Indian family doctor.",
    "Speak in very simple patient-friendly language.",
    "Do not sound robotic.",
    "Do not over-act.",
    "Pause naturally at commas and full stops.",
    "Keep pronunciation smooth and natural.",
    "Medical terms may be pronounced in clear Indian English.",
    "Numbers can be spoken in the most natural patient-friendly way.",
  ];

  switch (lang) {
    case "hindi":
      return [
        "Speak in natural Indian Hindi.",
        "Hindi words must sound like real spoken Hindi, not translated English.",
        "Use simple, everyday Hindi, not overly formal Hindi.",
        "Do not use an English accent for Hindi-origin words.",
        "Keep it warm, soft, clear, and doctor-like.",
        ...baseRules,
      ].join(" ");

    case "hinglish":
      return [
        "Speak in natural Indian Hinglish.",
        "IMPORTANT: Roman Hindi words must be pronounced as Hindi, not as English spellings.",
        "Example: 'rahe' should sound like 'rahe', not 'ray-hee'.",
        "Hindi-origin words should sound fully natural Hindi.",
        "English words should sound like normal Indian English.",
        "Use very simple everyday spoken style.",
        "Do not sound like a call-center voice.",
        "Do not sound Western.",
        "Keep it smooth, human, caring, and conversational.",
        ...baseRules,
      ].join(" ");

    case "bengali":
      return [
        "Speak in natural Bengali with native pronunciation.",
        "Keep medical terms in clear Indian English where needed.",
        ...baseRules,
      ].join(" ");

    case "tamil":
      return [
        "Speak in natural Tamil with native pronunciation.",
        "Keep medical terms in clear Indian English where needed.",
        ...baseRules,
      ].join(" ");

    case "telugu":
      return [
        "Speak in natural Telugu with native pronunciation.",
        "Keep medical terms in clear Indian English where needed.",
        ...baseRules,
      ].join(" ");

    case "kannada":
      return [
        "Speak in natural Kannada with native pronunciation.",
        "Keep medical terms in clear Indian English where needed.",
        ...baseRules,
      ].join(" ");

    case "malayalam":
      return [
        "Speak in natural Malayalam with native pronunciation.",
        "Keep medical terms in clear Indian English where needed.",
        ...baseRules,
      ].join(" ");

    case "gujarati":
      return [
        "Speak in natural Gujarati with native pronunciation.",
        "Keep medical terms in clear Indian English where needed.",
        ...baseRules,
      ].join(" ");

    case "punjabi":
      return [
        "Speak in natural Punjabi with native pronunciation.",
        "Keep medical terms in clear Indian English where needed.",
        ...baseRules,
      ].join(" ");

    case "marathi":
      return [
        "Speak in natural Marathi with native pronunciation.",
        "Keep medical terms in clear Indian English where needed.",
        ...baseRules,
      ].join(" ");

    case "english":
    default:
      return [
        "Speak clearly in simple Indian English.",
        "Use a warm, calm, professional doctor tone.",
        "Avoid heavy or dramatic narration style.",
        ...baseRules,
      ].join(" ");
  }
}

async function synthesizeSpeech({ text, language, replyLanguagePreference }) {
  const clean = String(text || "").trim();
  if (!clean) return { audioBase64: "" };

  const client = getOpenAIClient();
  if (!client) return { audioBase64: "" };

  const lang = String(replyLanguagePreference || language || "english").toLowerCase();
  const voice = pickTtsVoice(lang);
  const instructions = getTtsInstructions(lang);

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