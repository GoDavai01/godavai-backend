const mongoose = require("mongoose");

const labTestSchema = new mongoose.Schema(
  {
    testId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    short: { type: String, default: "", trim: true },
    category: { type: String, default: "Popular", trim: true, index: true },
    reportTime: { type: String, default: "24 hrs", trim: true },
    prep: { type: String, default: "No fasting", trim: true },
    price: { type: Number, default: 0 },
    oldPrice: { type: Number, default: 0 },
    homeCollection: { type: Boolean, default: true, index: true },
    trending: { type: Boolean, default: false, index: true },
    desc: { type: String, default: "", trim: true },
    idealFor: [{ type: String, trim: true }],
    badges: [{ type: String, trim: true }],
    sampleType: { type: String, default: "Blood", trim: true },
    fastingRequired: { type: Boolean, default: false },
    why: { type: String, default: "", trim: true },
    includes: [{ type: String, trim: true }],
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

labTestSchema.index({ name: "text", short: "text", desc: "text", category: "text" });

module.exports = mongoose.models.LabTest || mongoose.model("LabTest", labTestSchema);
