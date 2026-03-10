const mongoose = require("mongoose");

const labPackageSchema = new mongoose.Schema(
  {
    packageId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    category: { type: String, default: "Full Body", trim: true, index: true },
    tests: [{ type: String, trim: true }],
    reportTime: { type: String, default: "24 hrs", trim: true },
    price: { type: Number, default: 0 },
    oldPrice: { type: Number, default: 0 },
    homeCollection: { type: Boolean, default: true, index: true },
    tag: { type: String, default: "", trim: true },
    desc: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

labPackageSchema.index({ name: "text", desc: "text", category: "text" });

module.exports = mongoose.models.LabPackage || mongoose.model("LabPackage", labPackageSchema);
