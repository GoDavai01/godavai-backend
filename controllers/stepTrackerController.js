const mongoose = require("mongoose");
const StepTrackerSession = require("../models/StepTrackerSession");

const MAX_ACCURACY_METERS = 50;
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
    if (curr.accuracy && curr.accuracy > MAX_ACCURACY_METERS) continue;
    const d = haversineMeters(lastGoodPoint, curr);
    const combAcc = ((lastGoodPoint.accuracy || 0) + (curr.accuracy || 0)) / 2;
    const minD = Math.max(MIN_DISTANCE_DELTA, combAcc * 0.5);
    if (d > minD && d < MAX_DISTANCE_DELTA) total += d;
    lastGoodPoint = curr;
  }
  return Math.round(total);
}

function getUserStrideMeters(req) {
  const h = Number(req.user?.heightCm || 0);
  return h > 0 ? Math.max(0.5, h * 0.00415) : 0.78;
}

function calculateSteps(dist = 0, provided = 0, stride = 0.78) {
  const s = Number(stride || 0.78) > 0 ? Number(stride || 0.78) : 0.78;
  return Math.max(Number(provided || 0), Math.round(Number(dist || 0) / s), 0);
}

function calculateCalories(dist = 0, steps = 0, wt = null) {
  const w = Number(wt || 0);
  if (!w || w <= 0) return null;
  const km = Number(dist || 0) / 1000;
  return Math.round(Math.max(km * w * 0.75, Number(steps || 0) * 0.04, 0));
}

function computeDurationSec(session) {
  const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const start = new Date(session.startedAt).getTime();
  return Math.max(0, Math.round((end - start - Number(session.totalPausedMs || 0)) / 1000));
}

function avgPaceMinPerKm(dur = 0, dist = 0) {
  const km = Number(dist || 0) / 1000;
  return km ? Number((dur / 60 / km).toFixed(2)) : 0;
}

function getUserWeightFromReq(req) {
  const w = Number(req.user?.weightKg || 0);
  return w > 0 ? w : null;
}

function buildStats(session, req, incoming = {}) {
  const pts = Array.isArray(session.points) ? session.points : [];
  const stride = getUserStrideMeters(req);
  const compDist = computeDistance(pts);
  const totalDist = Math.max(compDist, Number(incoming.distanceMeters || 0), Number(session.stats?.distanceMeters || 0));
  const totalSteps = calculateSteps(totalDist, Math.max(Number(incoming.steps || 0), Number(session.stats?.steps || 0)), stride);
  const finalDur = Math.max(Number(incoming.durationSec || 0), computeDurationSec(session));
  const wt = getUserWeightFromReq(req);
  const compCal = calculateCalories(totalDist, totalSteps, wt);
  let finalCal = null;
  if (compCal != null) finalCal = Math.max(Number(incoming.caloriesKcal || 0), Number(session.stats?.caloriesKcal || 0), compCal);
  let maxSpd = Number(session.stats?.maxSpeedKmh || 0);
  for (const p of pts) { const kmh = Number(p.speed || 0) * 3.6; if (kmh > maxSpd && kmh < 50) maxSpd = kmh; }
  return { steps: totalSteps, distanceMeters: Math.round(totalDist), caloriesKcal: finalCal, durationSec: finalDur, avgPaceMinPerKm: avgPaceMinPerKm(finalDur, totalDist), maxSpeedKmh: Number(maxSpd.toFixed(2)) };
}

function normalizePoint(point) {
  if (!point || typeof point !== "object") return null;
  const lat = Number(point.lat), lng = Number(point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat, lng, accuracy: Number(point.accuracy || 0), speed: Number(point.speed || 0),
    heading: point.heading == null || point.heading === "" ? null : Number(point.heading),
    source: point.source || "gps",
    recordedAt: point.recordedAt ? new Date(point.recordedAt) : new Date(),
  };
}

exports.startSession = async (req, res) => {
  try {
    const { startLocation, device } = req.body || {};
    const ns = startLocation && Number.isFinite(Number(startLocation.lat)) && Number.isFinite(Number(startLocation.lng))
      ? { lat: Number(startLocation.lat), lng: Number(startLocation.lng), accuracy: Number(startLocation.accuracy || 0) } : null;

    // Auto-end previous active sessions
    await StepTrackerSession.updateMany(
      { userId: req.user._id, status: { $in: ["active", "paused"] } },
      { $set: { status: "ended", endedAt: new Date() } }
    );

    const session = await StepTrackerSession.create({
      userId: req.user._id, startLocation: ns,
      device: { platform: device?.platform || "", userAgent: device?.userAgent || "" },
      status: "active", startedAt: new Date(),
      points: ns ? [{ lat: ns.lat, lng: ns.lng, accuracy: ns.accuracy, speed: 0, heading: null, source: "gps", recordedAt: new Date() }] : [],
      stats: { steps: 0, distanceMeters: 0, caloriesKcal: getUserWeightFromReq(req) ? 0 : null, durationSec: 0, avgPaceMinPerKm: 0, maxSpeedKmh: 0 },
    });
    return res.status(201).json({ ok: true, session });
  } catch (err) { return res.status(500).json({ ok: false, message: "Failed to start.", error: err.message }); }
};

exports.appendPoints = async (req, res) => {
  try {
    const { id } = req.params;
    const { points = [], steps = 0, distanceMeters = 0, caloriesKcal = 0, durationSec = 0 } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, message: "Invalid session id." });
    const session = await StepTrackerSession.findOne({ _id: id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Session not found." });
    if (session.status === "ended") return res.status(400).json({ ok: false, message: "Session already ended." });

    const normalized = Array.isArray(points) ? points.map(normalizePoint).filter(Boolean) : [];
    if (normalized.length) {
      const MAX_POINTS = 5000;
      if (session.points.length + normalized.length > MAX_POINTS) {
        const overflow = session.points.length + normalized.length - MAX_POINTS;
        if (overflow > 0) session.points = session.points.slice(overflow);
      }
      session.points.push(...normalized);
    }
    session.stats = buildStats(session, req, { steps, distanceMeters, caloriesKcal, durationSec });
    await session.save();
    return res.json({ ok: true, stats: session.stats });
  } catch (err) { return res.status(500).json({ ok: false, message: "Failed to append.", error: err.message }); }
};

exports.pauseSession = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, message: "Invalid id." });
    const session = await StepTrackerSession.findOne({ _id: id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Not found." });
    if (session.status === "active") { session.status = "paused"; session.pausedAt = new Date(); await session.save(); }
    return res.json({ ok: true, session });
  } catch (err) { return res.status(500).json({ ok: false, message: "Failed.", error: err.message }); }
};

exports.resumeSession = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, message: "Invalid id." });
    const session = await StepTrackerSession.findOne({ _id: id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Not found." });
    if (session.status === "paused" && session.pausedAt) {
      session.totalPausedMs += Date.now() - new Date(session.pausedAt).getTime();
      session.pausedAt = null; session.status = "active"; await session.save();
    }
    return res.json({ ok: true, session });
  } catch (err) { return res.status(500).json({ ok: false, message: "Failed.", error: err.message }); }
};

exports.endSession = async (req, res) => {
  try {
    const { endLocation, steps = 0, distanceMeters = 0, caloriesKcal = 0, durationSec = 0 } = req.body || {};
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, message: "Invalid id." });
    const session = await StepTrackerSession.findOne({ _id: id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Not found." });
    if (session.status === "ended") return res.json({ ok: true, session });

    if (session.status === "paused" && session.pausedAt) {
      session.totalPausedMs += Date.now() - new Date(session.pausedAt).getTime();
      session.pausedAt = null;
    }
    session.status = "ended"; session.endedAt = new Date();
    if (endLocation && Number.isFinite(Number(endLocation.lat)) && Number.isFinite(Number(endLocation.lng)))
      session.endLocation = { lat: Number(endLocation.lat), lng: Number(endLocation.lng), accuracy: Number(endLocation.accuracy || 0) };
    session.stats = buildStats(session, req, { steps, distanceMeters, caloriesKcal, durationSec });
    await session.save();
    return res.json({ ok: true, session });
  } catch (err) { return res.status(500).json({ ok: false, message: "Failed.", error: err.message }); }
};

exports.getTodaySummary = async (req, res) => {
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const sessions = await StepTrackerSession.find({ userId: req.user._id, startedAt: { $gte: start } }).select("stats status").sort({ startedAt: -1 });
    const hasWt = !!getUserWeightFromReq(req);
    const summary = sessions.reduce((acc, s) => {
      acc.steps += Number(s.stats?.steps || 0);
      acc.distanceMeters += Number(s.stats?.distanceMeters || 0);
      acc.durationSec += Number(s.stats?.durationSec || 0);
      if (hasWt) acc.caloriesKcal += Number(s.stats?.caloriesKcal || 0);
      return acc;
    }, { steps: 0, distanceMeters: 0, caloriesKcal: hasWt ? 0 : null, durationSec: 0, sessionsCount: sessions.length });
    return res.json(summary);
  } catch (err) { return res.status(500).json({ ok: false, message: "Failed.", error: err.message }); }
};

exports.listSessions = async (req, res) => {
  try {
    const sessions = await StepTrackerSession.find({ userId: req.user._id }).sort({ startedAt: -1 }).limit(20);
    return res.json({ ok: true, sessions });
  } catch (err) { return res.status(500).json({ ok: false, message: "Failed.", error: err.message }); }
};

exports.getSessionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, message: "Invalid id." });
    const session = await StepTrackerSession.findOne({ _id: id, userId: req.user._id });
    if (!session) return res.status(404).json({ ok: false, message: "Not found." });
    return res.json({ ok: true, session });
  } catch (err) { return res.status(500).json({ ok: false, message: "Failed.", error: err.message }); }
};