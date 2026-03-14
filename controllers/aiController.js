const { generateAssistantReply, listSessions, getSessionById } = require("../services/aiService");
const { analyzeFileForAssistant } = require("../services/fileAiService");
const { transcribeAudio, synthesizeSpeech } = require("../services/audioService");

async function chat(req, res) {
  try {
    const { message, history, context } = req.body || {};
    const userId = req?.user?.userId || req?.user?._id || null;

    const out = await generateAssistantReply({
      message,
      history,
      context,
      userId,
      attachment: null,
    });

    return res.json({
      reply: out.reply,
      sessionId: out.sessionId || null,
      context: out.context || {},
    });
  } catch (err) {
    console.error("AI chat failed:", err);
    return res.status(500).json({ error: "AI chat failed." });
  }
}

async function analyzeFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File is required." });
    }

    const { message, history, context } = req.body || {};
    const parsedHistory =
      typeof history === "string" ? JSON.parse(history || "[]") : history || [];
    const parsedContext =
      typeof context === "string" ? JSON.parse(context || "{}") : context || {};

    const userId = req?.user?.userId || req?.user?._id || null;

    const out = await analyzeFileForAssistant({
      file: req.file,
      message,
      history: parsedHistory,
      context: parsedContext,
      userId,
    });

    return res.json({
      reply: out.reply,
      sessionId: out.sessionId || null,
      parsed: out.parsed || {},
    });
  } catch (err) {
    console.error("AI analyze file failed:", err);
    return res.status(500).json({ error: "AI file analysis failed." });
  }
}

async function stt(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required." });
    }

    const text = await transcribeAudio(req.file, {
      replyLanguagePreference: req.body?.replyLanguagePreference || "auto",
      transcriptMode: req.body?.transcriptMode || "native",
    });

    return res.json({ text: String(text || "").trim() });
  } catch (err) {
    console.error("STT failed:", err);
    return res.status(500).json({ error: "Audio transcription failed." });
  }
}

async function tts(req, res) {
  try {
    const text = String(req.body?.text || "").trim();
    const language = String(req.body?.language || "english").trim();
    const replyLanguagePreference = String(
      req.body?.replyLanguagePreference || language || "english"
    ).trim();

    if (!text) {
      return res.status(400).json({ error: "Text is required." });
    }

    const out = await synthesizeSpeech({
      text,
      language,
      replyLanguagePreference,
    });

    return res.json({ audioBase64: String(out?.audioBase64 || "") });
  } catch (err) {
    console.error("TTS failed:", err);
    return res.status(500).json({ error: "Audio generation failed." });
  }
}

async function listSessionsHandler(req, res) {
  try {
    const userId = req?.user?.userId || req?.user?._id;
    const limit = req.query?.limit || 20;
    const rows = await listSessions({ userId, limit });
    return res.json(rows || []);
  } catch (err) {
    console.error("List sessions failed:", err);
    return res.status(500).json({ error: "Could not load sessions." });
  }
}

async function getSession(req, res) {
  try {
    const userId = req?.user?.userId || req?.user?._id;
    const sessionId = req.params?.sessionId;
    const row = await getSessionById({ userId, sessionId });
    if (!row) return res.status(404).json({ error: "Session not found." });
    return res.json(row);
  } catch (err) {
    console.error("Get session failed:", err);
    return res.status(500).json({ error: "Could not load session." });
  }
}

module.exports = {
  chat,
  analyzeFile,
  stt,
  tts,
  listSessions: listSessionsHandler,
  getSession,
};