const mongoose = require("mongoose");
const StepTrackerSession = require("../models/StepTrackerSession");

/* ───── Constants ───── */
const MAX_ACCURACY_METERS = 50;   // backend is more lenient than frontend (30m)
const MIN_DISTANCE_DELTA = 1.5;
const MAX_DISTANCE_DELTA = 200;

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
  let lastGoodPoint = points[0];

  for (let i = 1; i < points.length; i += 1) {
    const curr = points[i];

    // FIX: Skip points with poor accuracy
    if (curr.accuracy && curr.accuracy > MAX_ACCURACY_METERS) continue;

    const d = haversineMeters(lastGoodPoint, curr);

    // FIX: Use smarter min delta based on combined accuracy
    const combinedAccuracy = ((lastGoodPoint.accuracy || 0) + (curr.accuracy || 0)) / 2;
    const effectiveMin = Math.max(MIN_DISTANCE_DELTA, combinedAccuracy * 0.5);

    if (d > effectiveMin && d < MAX_DISTANCE_DELTA) {
      total += d;
    }

    // Always update lastGoodPoint if this point has acceptable accuracy
    lastGoodPoint = curr;
  }

  return Math.round(total);
}

function getUserStrideMeters(req) {
  const heightCm = Number(req.user?.heightCm || 0);
  if (heightCm > 0) {
    return Math.max(0.5, heightCm * 0.00415);
  }
  return 0.78;
}

function calculateSteps(distanceMeters = 0, providedSteps = 0, strideMeters = 0.78) {
  const safeStride = Number(strideMeters || 0.78) > 0 ? Number(strideMeters || 0.78) : 0.78;
  const distanceBased = Math.round(Number(distanceMeters || 0) / safeStride);
  return Math.max(Number(providedSteps || 0), distanceBased, 0);
}

function calculateCalories(distanceMeters = 0, steps = 0, weightKg = null) {
  const safeWeight = Number(weightKg || 0);
  if (!safeWeight || safeWeight <= 0) return null;

  const km = Number(distanceMeters || 0) / 1000;
  const byDistance = km * safeWeight * 0.75;
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
  const weight = Number(req.user?.weightKg || 0);
  if (weight > 0) return weight;
  return null;
}

function buildStats(session, req, incoming = {}) {
  const existingPoints = Array.isArray(session.points) ? session.points : [];
  const strideMeters = getUserStrideMeters(req);

  const computedDistance = computeDistance(existingPoints);
  const totalDistance = Math.max(
    computedDistance,
    Number(incoming.distanceMeters || 0),
    Number(session.stats?.distanceMeters || 0)
  );

  const totalSteps = calculateSteps(
    totalDistance,
    Math.max(Number(incoming.steps || 0), Number(session.stats?.steps || 0)),
    strideMeters
  );

  const finalDuration = Math.max(Number(incoming.durationSec || 0), computeDurationSec(session));

  const weightKg = getUserWeightFromReq(req);
  const computedCalories = calculateCalories(totalDistance, totalSteps, weightKg);

  let finalCalories = null;
  if (computedCalories != null) {
    finalCalories = Math.max(
      Number(incoming.caloriesKcal || 0),
      Number(session.stats?.caloriesKcal || 0),
      computedCalories
    );
  }

  let maxSpeedKmh = Number(session.stats?.maxSpeedKmh || 0);
  for (const p of existingPoints) {
    const kmh = Number(p.speed || 0) * 3.6;
    if (kmh > maxSpeedKmh && kmh < 50) maxSpeedKmh = kmh;  // FIX: cap at 50 km/h to filter GPS noise
  }

  return {
    steps: totalSteps,
    distanceMeters: Math.round(totalDistance),
    caloriesKcal: finalCalories,
    durationSec: finalDuration,
    avgPaceMinPerKm: avgPaceMinPerKm(finalDuration, totalDistance),
    maxSpeedKmh: Number(maxSpeedKmh.toFixed(2)),
  };
}

function normalizePoint(point) {
  if (!point || typeof point !== "object") return null;

  const lat = Number(point.lat);
  const lng = Number(point.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // FIX: Validate lat/lng ranges
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return {
    lat,
    lng,
    accuracy: Number(point.accuracy || 0),
    speed: Number(point.speed || 0),
    heading:
      point.heading === null || point.heading === undefined || point.heading === ""
        ? null
        : Number(point.heading),
    source: point.source || "gps",
    recordedAt: point.recordedAt ? new Date(point.recordedAt) : new Date(),
  };
}

exports.startSession = async (req, res) => {
  try {
    const { startLocation, device } = req.body || {};

    const normalizedStart =
      startLocation &&
      Number.isFinite(Number(startLocation.lat)) &&
      Number.isFinite(Number(startLocation.lng))
        ? {
            lat: Number(startLocation.lat),
            lng: Number(startLocation.lng),
            accuracy: Number(startLocation.accuracy || 0),
          }
        : null;

    // FIX: Auto-end any previous active sessions for this user
    await StepTrackerSession.updateMany(
      { userId: req.user._id, status: { $in: ["active", "paused"] } },
      {
        $set: {
          status: "ended",
          endedAt: new Date(),
        },
      }
    );

    const session = await StepTrackerSession.create({
      userId: req.user._id,
      startLocation: normalizedStart,
      device: {
        platform: device?.platform || "",
        userAgent: device?.userAgent || "",
      },
      status: "active",
      startedAt: new Date(),
      points: normalizedStart
        ? [
            {
              lat: normalizedStart.lat,
              lng: normalizedStart.lng,
              accuracy: normalizedStart.accuracy,
              speed: 0,
              heading: null,
              source: "gps",
              recordedAt: new Date(),
            },
          ]
        : [],
      stats: {
        steps: 0,
        distanceMeters: 0,
        caloriesKcal: getUserWeightFromReq(req) ? 0 : null,
        durationSec: 0,
        avgPaceMinPerKm: 0,
        maxSpeedKmh: 0,
      },
    });

    return res.status(201).json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to start step session.",
      error: err.message,
    });
  }
};

exports.appendPoints = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      points = [],
      steps = 0,
      distanceMeters = 0,
      caloriesKcal = 0,
      durationSec = 0,
    } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "Invalid session id." });
    }

    const session = await StepTrackerSession.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!session) {
      return res.status(404).json({ ok: false, message: "Session not found." });
    }

    // FIX: Don't accept points for ended sessions
    if (session.status === "ended") {
      return res.status(400).json({ ok: false, message: "Session already ended." });
    }

    const normalizedPoints = Array.isArray(points)
      ? points.map(normalizePoint).filter(Boolean)
      : [];

    if (normalizedPoints.length) {
      // FIX: Limit total stored points to prevent unbounded growth
      const MAX_POINTS = 5000;
      const currentLen = session.points.length;
      if (currentLen + normalizedPoints.length > MAX_POINTS) {
        // Keep last N points to stay under limit
        const overflow = (currentLen + normalizedPoints.length) - MAX_POINTS;
        if (overflow > 0 && overflow < currentLen) {
          session.points = session.points.slice(overflow);
        }
      }

      session.points.push(...normalizedPoints);
    }

    session.stats = buildStats(session, req, {
      steps,
      distanceMeters,
      caloriesKcal,
      durationSec,
    });

    await session.save();

    return res.json({ ok: true, stats: session.stats });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to append route points.",
      error: err.message,
    });
  }
};

exports.pauseSession = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "Invalid session id." });
    }

    const session = await StepTrackerSession.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });

    if (session.status === "active") {
      session.status = "paused";
      session.pausedAt = new Date();
      await session.save();
    }

    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to pause session.",
      error: err.message,
    });
  }
};

exports.resumeSession = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "Invalid session id." });
    }

    const session = await StepTrackerSession.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });

    if (session.status === "paused" && session.pausedAt) {
      session.totalPausedMs += Date.now() - new Date(session.pausedAt).getTime();
      session.pausedAt = null;
      session.status = "active";
      await session.save();
    }

    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to resume session.",
      error: err.message,
    });
  }
};

exports.endSession = async (req, res) => {
  try {
    const {
      endLocation,
      steps = 0,
      distanceMeters = 0,
      caloriesKcal = 0,
      durationSec = 0,
    } = req.body || {};

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "Invalid session id." });
    }

    const session = await StepTrackerSession.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });

    // FIX: Allow ending already-ended sessions gracefully
    if (session.status === "ended") {
      return res.json({ ok: true, session, message: "Session was already ended." });
    }

    if (session.status === "paused" && session.pausedAt) {
      session.totalPausedMs += Date.now() - new Date(session.pausedAt).getTime();
      session.pausedAt = null;
    }

    session.status = "ended";
    session.endedAt = new Date();

    if (
      endLocation &&
      Number.isFinite(Number(endLocation.lat)) &&
      Number.isFinite(Number(endLocation.lng))
    ) {
      session.endLocation = {
        lat: Number(endLocation.lat),
        lng: Number(endLocation.lng),
        accuracy: Number(endLocation.accuracy || 0),
      };
    }

    session.stats = buildStats(session, req, {
      steps,
      distanceMeters,
      caloriesKcal,
      durationSec,
    });

    await session.save();

    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to end session.",
      error: err.message,
    });
  }
};

exports.getTodaySummary = async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const sessions = await StepTrackerSession.find({
      userId: req.user._id,
      startedAt: { $gte: start },
    })
      .select("stats status")    // FIX: Don't load all points for summary — saves memory
      .sort({ startedAt: -1 });

    const hasWeight = !!getUserWeightFromReq(req);

    const summary = sessions.reduce(
      (acc, s) => {
        acc.steps += Number(s.stats?.steps || 0);
        acc.distanceMeters += Number(s.stats?.distanceMeters || 0);
        acc.durationSec += Number(s.stats?.durationSec || 0);

        if (hasWeight) {
          acc.caloriesKcal += Number(s.stats?.caloriesKcal || 0);
        }

        return acc;
      },
      {
        steps: 0,
        distanceMeters: 0,
        caloriesKcal: hasWeight ? 0 : null,
        durationSec: 0,
        sessionsCount: sessions.length,
      }
    );

    return res.json(summary);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch today summary.",
      error: err.message,
    });
  }
};

exports.listSessions = async (req, res) => {
  try {
    const sessions = await StepTrackerSession.find({ userId: req.user._id })
      .sort({ startedAt: -1 })
      .limit(20);

    return res.json({ ok: true, sessions });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch sessions.",
      error: err.message,
    });
  }
};

exports.getSessionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "Invalid session id." });
    }

    const session = await StepTrackerSession.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });

    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch session.",
      error: err.message,
    });
  }
};