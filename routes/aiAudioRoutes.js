const express = require("express");
const multer = require("multer");
const { transcribeAudio } = require("../services/audioService");
const auth = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/assistant/transcribe", auth, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required." });
    }

    const text = await transcribeAudio(req.file);
    return res.json({ text: String(text || "").trim() });
  } catch (err) {
    console.error("Transcribe route failed:", err);
    return res.status(500).json({ error: "Audio transcription failed." });
  }
});

module.exports = router;