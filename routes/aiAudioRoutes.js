const express = require("express");
const multer = require("multer");
const { transcribeAudio, synthesizeSpeech } = require("../services/audioService");
const auth = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/assistant/transcribe", auth, upload.single("audio"), async (req, res) => {
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
    console.error("Transcribe route failed:", err);
    return res.status(500).json({ error: "Audio transcription failed." });
  }
});

router.post("/assistant/tts", auth, async (req, res) => {
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
    console.error("TTS route failed:", err);
    return res.status(500).json({ error: "Audio generation failed." });
  }
});

module.exports = router;