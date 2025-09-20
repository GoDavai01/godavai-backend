// server/models/MasterBrand.js
const mongoose = require("mongoose");

const MasterBrandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true, index: true }, // normalized (uppercased, spaces collapsed)
    // optional parsed bits
    type: { type: String, trim: true },       // Tablet/Capsule/Syrup/…
    strength: { type: String, trim: true },   // e.g., "650 mg"
    packLabel: { type: String, trim: true },  // e.g., "10 tablets"
    popularity: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

MasterBrandSchema.index({ nameKey: 1 });
MasterBrandSchema.index({ popularity: -1 });

module.exports = mongoose.model("MasterBrand", MasterBrandSchema);
