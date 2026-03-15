const mongoose = require("mongoose");

const StepPointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    heading: { type: Number, default: null },
    source: { type: String, default: "gps" },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const LocationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: 0 },
  },
  { _id: false }
);

const StepTrackerSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "paused", "ended"],
      default: "active",
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    pausedAt: {
      type: Date,
      default: null,
    },
    totalPausedMs: {
      type: Number,
      default: 0,
    },
    startLocation: {
      type: LocationSchema,
      default: null,
    },
    endLocation: {
      type: LocationSchema,
      default: null,
    },
    points: {
      type: [StepPointSchema],
      default: [],
    },
    stats: {
      steps: { type: Number, default: 0 },
      distanceMeters: { type: Number, default: 0 },
      caloriesKcal: { type: Number, default: 0 },
      durationSec: { type: Number, default: 0 },
      avgPaceMinPerKm: { type: Number, default: 0 },
      maxSpeedKmh: { type: Number, default: 0 },
    },
    device: {
      platform: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StepTrackerSession", StepTrackerSessionSchema);