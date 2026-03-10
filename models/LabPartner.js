const mongoose = require("mongoose");

const labPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    organization: { type: String, default: "", trim: true },
    city: { type: String, default: "Noida", trim: true, index: true },
    areas: [{ type: String, trim: true }],
    passwordHash: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.LabPartner || mongoose.model("LabPartner", labPartnerSchema);
