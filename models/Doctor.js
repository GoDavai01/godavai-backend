const mongoose = require("mongoose");

const daySchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    start: { type: String, default: "09:00" },
    end: { type: String, default: "13:00" },
  },
  { _id: false }
);

const availabilitySchema = new mongoose.Schema(
  {
    mon: { type: daySchema, default: () => ({}) },
    tue: { type: daySchema, default: () => ({}) },
    wed: { type: daySchema, default: () => ({}) },
    thu: { type: daySchema, default: () => ({}) },
    fri: { type: daySchema, default: () => ({}) },
    sat: { type: daySchema, default: () => ({ enabled: false }) },
    sun: { type: daySchema, default: () => ({ enabled: false }) },
  },
  { _id: false }
);

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true, index: true },
    phone: { type: String, trim: true, default: "" },
    passwordHash: { type: String, default: "" },
    clinicName: { type: String, default: "" },
    experience: { type: Number, default: 0 },
    licenseNumber: { type: String, trim: true, default: "" },
    specialty: { type: String, required: true, trim: true, index: true },
    rating: { type: Number, default: 4.5 },
    exp: { type: Number, default: 5 },
    languages: { type: [String], default: ["English"] },
    city: { type: String, default: "Delhi", index: true },
    feeVideo: { type: Number, default: 499 },
    feeInPerson: { type: Number, default: 799 },
    feeCall: { type: Number, default: 399 },
    clinic: { type: String, default: "" },
    tags: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    availability: { type: availabilitySchema, default: () => ({}) },
    isPortalDoctor: { type: Boolean, default: false, index: true },
    // Optional per-day slot override { "2026-03-08": { video: [...], inperson: [...], call: [...] } }
    slotOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

doctorSchema.index({ name: "text", specialty: "text", tags: "text" });

module.exports = mongoose.models.Doctor || mongoose.model("Doctor", doctorSchema);
