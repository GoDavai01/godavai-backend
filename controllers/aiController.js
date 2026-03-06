const { generateAssistantReply, listSessions, getSessionById } = require("../services/aiService");
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
    return res.status(500).json({
      error: "Failed to analyze file",
      details: String(err?.message || "unknown"),
    });
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
  listSessions: async (req, res) => {
    try {
      const userId = req?.user?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const sessions = await listSessions({ userId, limit: req.query?.limit });
      return res.json({ sessions });
    } catch (err) {
      console.error("AI list sessions error:", err?.message || err);
      return res.status(500).json({ error: "Failed to list sessions" });
    }
  },
  getSession: async (req, res) => {
    try {
      const userId = req?.user?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const session = await getSessionById({ userId, sessionId: req.params?.sessionId });
      if (!session) return res.status(404).json({ error: "Session not found" });
      return res.json({ session });
    } catch (err) {
      console.error("AI get session error:", err?.message || err);
      return res.status(500).json({ error: "Failed to get session" });
    }
  },
};
