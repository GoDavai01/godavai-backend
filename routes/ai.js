const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const aiController = require("../controllers/aiController");

const router = express.Router();

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function withUpload(singleUpload) {
  return (req, res, next) => {
    singleUpload(req, res, (err) => {
      if (!err) return next();
      const msg = err?.message || "Upload failed";
      return res.status(400).json({ error: msg });
    });
  };
}

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

function requireAuth(req, res, next) {
  if (!req?.user?.userId) return res.status(401).json({ error: "Unauthorized" });
  return next();
}

router.use(optionalAuth);

router.post("/assistant/chat", aiController.chat);
router.post("/chat", aiController.chat);
router.post("/assistant", aiController.chat);

router.post("/assistant/analyze-file", withUpload(fileUpload.single("file")), aiController.analyzeFile);
router.post("/analyze-file", withUpload(fileUpload.single("file")), aiController.analyzeFile);

router.post("/stt", withUpload(audioUpload.single("audio")), aiController.stt);
router.post("/tts", aiController.tts);
router.post("/assistant/tts", aiController.tts);

router.get("/sessions", requireAuth, aiController.listSessions);
router.get("/sessions/:sessionId", requireAuth, aiController.getSession);
router.get("/assistant/sessions", requireAuth, aiController.listSessions);
router.get("/assistant/sessions/:sessionId", requireAuth, aiController.getSession);

module.exports = router;