const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const aiController = require("../controllers/aiController");

const router = express.Router();

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return next();

  const token = authHeader.slice("Bearer ".length).trim();
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    // Proceed without auth for fallback use-cases.
  }
  next();
}

router.use(optionalAuth);

router.post("/assistant/chat", aiController.chat);
router.post("/chat", aiController.chat);
router.post("/assistant", aiController.chat);

router.post("/assistant/analyze-file", fileUpload.single("file"), aiController.analyzeFile);
router.post("/analyze-file", fileUpload.single("file"), aiController.analyzeFile);

router.post("/stt", audioUpload.single("audio"), aiController.stt);
router.post("/tts", aiController.tts);

module.exports = router;

