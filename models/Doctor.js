const mongoose = require("mongoose");

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
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
    // Optional per-day slot override { "2026-03-08": { video: [...], inperson: [...], call: [...] } }
    slotOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

doctorSchema.index({ name: "text", specialty: "text", tags: "text" });

module.exports = mongoose.models.Doctor || mongoose.model("Doctor", doctorSchema);

