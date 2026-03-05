const { generateAssistantReply } = require("../services/aiService");
const { analyzeFileForAssistant } = require("../services/fileAiService");
const { transcribeAudio, synthesizeSpeech } = require("../services/audioService");

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function pickUserId(req, context) {
  return req?.user?.userId || context?.userSummary?.id || null;
}

async function chat(req, res) {
  try {
    const body = req.body || {};
    const message = String(body.message || "").trim();
    const history = parseMaybeJson(body.history, []);
    const context = parseMaybeJson(body.context, {});
    const userId = pickUserId(req, context);

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const out = await generateAssistantReply({
      message,
      history,
      context,
      userId,
    });

    return res.json({ reply: out.reply, sessionId: out.sessionId || null });
  } catch (err) {
    console.error("AI chat controller error:", err?.message || err);
    return res.status(500).json({ error: "Failed to process AI chat" });
  }
}

async function analyzeFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }

    const message = String(req.body?.message || "").trim();
    const history = parseMaybeJson(req.body?.history, []);
    const context = parseMaybeJson(req.body?.context, {});
    const userId = pickUserId(req, context);

    const out = await analyzeFileForAssistant({
      file: req.file,
      message,
      history,
      context,
      userId,
    });

    return res.json({
      reply: out.reply,
      parsed: out.parsed || {},
      sessionId: out.sessionId || null,
    });
  } catch (err) {
    console.error("AI analyze-file controller error:", err?.message || err);
    return res.status(500).json({ error: "Failed to analyze file" });
  }
}

async function stt(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "audio is required" });
    }
    const text = await transcribeAudio(req.file);
    return res.json({ text });
  } catch (err) {
    console.error("AI STT controller error:", err?.message || err);
    return res.status(500).json({ error: "Failed to transcribe audio" });
  }
}

async function tts(req, res) {
  try {
    const text = String(req.body?.text || "").trim();
    const language = String(req.body?.language || "en");
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }
    const out = await synthesizeSpeech({ text, language });
    return res.json(out);
  } catch (err) {
    console.error("AI TTS controller error:", err?.message || err);
    return res.status(500).json({ error: "Failed to generate speech audio" });
  }
}

module.exports = {
  chat,
  analyzeFile,
  stt,
  tts,
};

