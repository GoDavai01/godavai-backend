const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const stepTrackerController = require("../controllers/stepTrackerController");
const User = require("../models/User");

const router = express.Router();

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (!header || typeof header !== "string") return null;
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

function pickUserIdFromDecoded(decoded) {
  if (!decoded || typeof decoded !== "object") return null;

  const candidates = [
    decoded.id,
    decoded._id,
    decoded.userId,
    decoded.user?._id,
    decoded.user?.id,
    decoded.user?.userId,
  ];

  for (const value of candidates) {
    if (value && mongoose.Types.ObjectId.isValid(String(value))) {
      return String(value);
    }
  }

  return null;
}

async function authRequired(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, message: "Missing bearer token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = pickUserIdFromDecoded(decoded);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Invalid token payload: user id missing",
      });
    }

    const user = await User.findById(userId)
      .select("_id name email mobile weight weightKg height heightCm")
      .lean();

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "User not found for token",
      });
    }

    req.user = {
      _id: user._id,
      userId: String(user._id),
      name: user.name || "",
      email: user.email || "",
      mobile: user.mobile || "",
      weightKg:
        user.weightKg != null && Number(user.weightKg) > 0
          ? Number(user.weightKg)
          : user.weight != null && Number(user.weight) > 0
          ? Number(user.weight)
          : null,
      heightCm:
        user.heightCm != null && Number(user.heightCm) > 0
          ? Number(user.heightCm)
          : user.height != null && Number(user.height) > 0
          ? Number(user.height)
          : null,
      rawToken: token,
      jwt: decoded,
    };

    return next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      message: "Invalid or expired token",
      error: err.message,
    });
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