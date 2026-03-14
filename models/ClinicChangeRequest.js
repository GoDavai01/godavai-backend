const mongoose = require("mongoose");

const clinicSnapshotSchema = new mongoose.Schema(
  {
    verified: { type: Boolean, default: false },
    name: { type: String, default: "", trim: true },
    fullAddress: { type: String, default: "", trim: true },
    locality: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true },
    mapLabel: { type: String, default: "", trim: true },
    coordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    consultationDays: { type: [String], default: [] },
    startTime: { type: String, default: "", trim: true },
    endTime: { type: String, default: "", trim: true },
    slotDuration: { type: Number, default: 15 },
    arrivalWindow: { type: Number, default: 15 },
    maxPatientsPerDay: { type: Number, default: 24 },
  },
  { _id: false }
);

const clinicChangeRequestSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    previousClinic: { type: clinicSnapshotSchema, default: () => ({}) },
    requestedClinic: { type: clinicSnapshotSchema, default: () => ({}) },
    proofDocument: {
      url: { type: String, default: "", trim: true },
      fileName: { type: String, default: "", trim: true },
      mimeType: { type: String, default: "", trim: true },
      size: { type: Number, default: 0 },
    },
    locationCaptureSource: {
      type: String,
      enum: ["manual_pin", "current_location", ""],
      default: "",
    },
    locationCapturedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["pending_verification", "approved", "rejected", "needs_more_info"],
      default: "pending_verification",
      index: true,
    },
    adminComment: { type: String, default: "", trim: true },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ClinicChangeRequest || mongoose.model("ClinicChangeRequest", clinicChangeRequestSchema);
