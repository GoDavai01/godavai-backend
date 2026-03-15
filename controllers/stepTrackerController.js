const StepTrackerSession = require("../models/StepTrackerSession");

function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function computeDistance(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = haversineMeters(points[i - 1], points[i]);
    if (d > 1 && d < 120) total += d;
  }
  return Math.round(total);
}

function calculateSteps(distanceMeters = 0, providedSteps = 0) {
  const distanceBased = Math.round(Number(distanceMeters || 0) / 0.78);
  return Math.max(Number(providedSteps || 0), distanceBased);
}

function calculateCalories(distanceMeters = 0, steps = 0, weightKg = 70) {
  const km = Number(distanceMeters || 0) / 1000;
  const byDistance = km * Number(weightKg || 70) * 0.75;
  const bySteps = Number(steps || 0) * 0.04;
  return Math.round(Math.max(byDistance, bySteps, 0));
}

function computeDurationSec(session) {
  const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const start = new Date(session.startedAt).getTime();
  const paused = Number(session.totalPausedMs || 0);
  return Math.max(0, Math.round((end - start - paused) / 1000));
}

function avgPaceMinPerKm(durationSec = 0, distanceMeters = 0) {
  const km = Number(distanceMeters || 0) / 1000;
  if (!km) return 0;
  return Number((durationSec / 60 / km).toFixed(2));
}

function getUserWeightFromReq(req) {
  return Number(req.user?.weightKg || req.user?.weight || 70);
}

exports.startSession = async (req, res) => {
  try {
    const { startLocation, device } = req.body || {};

    const session = await StepTrackerSession.create({
      userId: req.user._id,
      startLocation: startLocation || null,
      device: device || {},
      status: "active",
      startedAt: new Date(),
    });

    return res.status(201).json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to start step session.", error: err.message });
  }
};

exports.appendPoints = async (req, res) => {
  try {
    const { id } = req.params;
    const { points = [], steps = 0, distanceMeters = 0, caloriesKcal = 0, durationSec = 0 } = req.body || {};

    const session = await StepTrackerSession.findOne({ _id: id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });

    if (Array.isArray(points) && points.length) {
      session.points.push(...points);
    }

    const totalDistance = Math.max(computeDistance(session.points), Number(distanceMeters || 0), Number(session.stats?.distanceMeters || 0));
    const totalSteps = calculateSteps(totalDistance, Math.max(Number(steps || 0), Number(session.stats?.steps || 0)));
    const finalDuration = Math.max(Number(durationSec || 0), computeDurationSec(session));
    const finalCalories = Math.max(Number(caloriesKcal || 0), calculateCalories(totalDistance, totalSteps, getUserWeightFromReq(req)));

    let maxSpeedKmh = Number(session.stats?.maxSpeedKmh || 0);
    for (const p of session.points) {
      const kmh = Number(p.speed || 0) * 3.6;
      if (kmh > maxSpeedKmh) maxSpeedKmh = kmh;
    }

    session.stats = {
      ...session.stats,
      distanceMeters: Math.round(totalDistance),
      steps: totalSteps,
      caloriesKcal: finalCalories,
      durationSec: finalDuration,
      avgPaceMinPerKm: avgPaceMinPerKm(finalDuration, totalDistance),
      maxSpeedKmh: Number(maxSpeedKmh.toFixed(2)),
    };

    await session.save();

    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to append route points.", error: err.message });
  }
};

exports.pauseSession = async (req, res) => {
  try {
    const session = await StepTrackerSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });

    if (session.status === "active") {
      session.status = "paused";
      session.pausedAt = new Date();
      await session.save();
    }

    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to pause session.", error: err.message });
  }
};

exports.resumeSession = async (req, res) => {
  try {
    const session = await StepTrackerSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });

    if (session.status === "paused" && session.pausedAt) {
      session.totalPausedMs += Date.now() - new Date(session.pausedAt).getTime();
      session.pausedAt = null;
      session.status = "active";
      await session.save();
    }

    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to resume session.", error: err.message });
  }
};

exports.endSession = async (req, res) => {
  try {
    const { endLocation, steps = 0, distanceMeters = 0, caloriesKcal = 0, durationSec = 0 } = req.body || {};

    const session = await StepTrackerSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });

    if (session.status === "paused" && session.pausedAt) {
      session.totalPausedMs += Date.now() - new Date(session.pausedAt).getTime();
      session.pausedAt = null;
    }

    session.status = "ended";
    session.endedAt = new Date();
    session.endLocation = endLocation || session.endLocation || null;

    const totalDistance = Math.max(computeDistance(session.points), Number(distanceMeters || 0), Number(session.stats?.distanceMeters || 0));
    const totalSteps = calculateSteps(totalDistance, Math.max(Number(steps || 0), Number(session.stats?.steps || 0)));
    const finalDuration = Math.max(Number(durationSec || 0), computeDurationSec(session));
    const finalCalories = Math.max(Number(caloriesKcal || 0), calculateCalories(totalDistance, totalSteps, getUserWeightFromReq(req)));

    let maxSpeedKmh = Number(session.stats?.maxSpeedKmh || 0);
    for (const p of session.points) {
      const kmh = Number(p.speed || 0) * 3.6;
      if (kmh > maxSpeedKmh) maxSpeedKmh = kmh;
    }

    session.stats = {
      steps: totalSteps,
      distanceMeters: Math.round(totalDistance),
      caloriesKcal: finalCalories,
      durationSec: finalDuration,
      avgPaceMinPerKm: avgPaceMinPerKm(finalDuration, totalDistance),
      maxSpeedKmh: Number(maxSpeedKmh.toFixed(2)),
    };

    await session.save();

    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to end session.", error: err.message });
  }
};

exports.getTodaySummary = async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const sessions = await StepTrackerSession.find({
      userId: req.user._id,
      startedAt: { $gte: start },
    }).sort({ startedAt: -1 });

    const summary = sessions.reduce(
      (acc, s) => {
        acc.steps += Number(s.stats?.steps || 0);
        acc.distanceMeters += Number(s.stats?.distanceMeters || 0);
        acc.caloriesKcal += Number(s.stats?.caloriesKcal || 0);
        acc.durationSec += Number(s.stats?.durationSec || 0);
        return acc;
      },
      { steps: 0, distanceMeters: 0, caloriesKcal: 0, durationSec: 0, sessionsCount: sessions.length }
    );

    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to fetch today summary.", error: err.message });
  }
};

exports.listSessions = async (req, res) => {
  try {
    const sessions = await StepTrackerSession.find({ userId: req.user._id })
      .sort({ startedAt: -1 })
      .limit(20);

    return res.json({ ok: true, sessions });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to fetch sessions.", error: err.message });
  }
};

exports.getSessionById = async (req, res) => {
  try {
    const session = await StepTrackerSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });
    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to fetch session.", error: err.message });
  }
};