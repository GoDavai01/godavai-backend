const mongoose = require("mongoose");

const medicationSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    name: { type: String, default: "" },
    dose: { type: String, default: "" },
    timing: { type: String, default: "" },
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    title: { type: String, default: "" },
    type: { type: String, default: "" },
    date: { type: String, default: "" },
    category: { type: String, default: "Lab Report" },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    fileUrl: { type: String, default: "" },
    fileKey: { type: String, default: "" },
  },
  { _id: false }
);

const memberSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    relation: { type: String, default: "Self" },
    profile: {
      name: { type: String, default: "" },
      dob: { type: String, default: "" },
      gender: { type: String, default: "" },
      bloodGroup: { type: String, default: "" },
      heightCm: { type: String, default: "" },
      weightKg: { type: String, default: "" },
    },
    emergency: {
      name: { type: String, default: "" },
      relation: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    conditions: { type: [String], default: [] },
    allergies: { type: [String], default: [] },
    medications: { type: [medicationSchema], default: [] },
    reports: { type: [reportSchema], default: [] },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const healthVaultSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    members: { type: [memberSchema], default: [] },
    activeMemberId: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.HealthVault || mongoose.model("HealthVault", healthVaultSchema);

