const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const stepTrackerController = require("../controllers/stepTrackerController");

const router = express.Router();

function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, message: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      _id: new mongoose.Types.ObjectId(decoded.id || decoded._id || decoded.userId),
      userId: decoded.id || decoded._id || decoded.userId,
      weightKg: decoded.weightKg || decoded.weight || 70,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }
}

router.post("/start", authRequired, stepTrackerController.startSession);
router.get("/summary/today", authRequired, stepTrackerController.getTodaySummary);
router.get("/sessions", authRequired, stepTrackerController.listSessions);
router.get("/sessions/:id", authRequired, stepTrackerController.getSessionById);
router.post("/sessions/:id/points", authRequired, stepTrackerController.appendPoints);
router.patch("/sessions/:id/pause", authRequired, stepTrackerController.pauseSession);
router.patch("/sessions/:id/resume", authRequired, stepTrackerController.resumeSession);
router.patch("/sessions/:id/end", authRequired, stepTrackerController.endSession);

module.exports = router;