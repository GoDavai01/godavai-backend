const mongoose = require("mongoose");

const labPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    organization: { type: String, default: "", trim: true },
    city: { type: String, default: "Noida", trim: true, index: true },
    pincode: { type: String, default: "", trim: true },
    labAddress: { type: String, default: "", trim: true },
    areas: [{ type: String, trim: true }],
    licenseNumber: { type: String, default: "", trim: true, index: true },
    licenseAuthority: { type: String, default: "", trim: true },
    licenseValidUpto: { type: String, default: "", trim: true },
    gstNumber: { type: String, default: "", trim: true },
    panNumber: { type: String, default: "", trim: true },
    documents: {
      type: [{
        docType: { type: String, default: "", trim: true },
        fileName: { type: String, default: "", trim: true },
        mimeType: { type: String, default: "", trim: true },
        fileSize: { type: Number, default: 0 },
        fileKey: { type: String, default: "", trim: true },
        fileUrl: { type: String, default: "", trim: true },
      }],
      default: [],
    },
    kycStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "suspended"],
      default: "pending",
      index: true,
    },
    kycNotes: { type: String, default: "", trim: true },
    approvedAt: { type: Date, default: null },
    approvedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    passwordHash: { type: String, required: true },
    active: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.LabPartner || mongoose.model("LabPartner", labPartnerSchema);
