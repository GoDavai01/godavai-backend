const mongoose = require("mongoose");

const healthProfileSchema = new mongoose.Schema(
  {
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    label: { type: String, required: true, trim: true },
    relation: { type: String, default: "" },
    gender: { type: String, default: "" },
    dob: { type: String, default: "" },
    conditions: { type: [String], default: [] },
    medications: { type: [String], default: [] },
    allergies: { type: [String], default: [] },
    vaultConsent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

healthProfileSchema.index({ ownerUserId: 1, label: 1 }, { unique: true });

module.exports = mongoose.models.HealthProfile || mongoose.model("HealthProfile", healthProfileSchema);

