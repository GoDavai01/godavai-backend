// server/models/MasterComposition.js
const mongoose = require("mongoose");

const MasterCompositionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true, index: true },
    dosageForms: { type: [String], default: [] },     // e.g., ["Tablet","Syrup"]
    commonStrengths: { type: [String], default: [] }, // e.g., ["650 mg","0.5%"]
    packUnits: { type: [String], default: [] },       // e.g., ["tablets","ml"]
    popularity: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

MasterCompositionSchema.index({ nameKey: 1 });
MasterCompositionSchema.index({ popularity: -1 });

module.exports = mongoose.model("MasterComposition", MasterCompositionSchema);
