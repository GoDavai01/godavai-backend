// models/TaxMap.js
const mongoose = require("mongoose");

const TaxMapSchema = new mongoose.Schema({
  key: { type: String, index: true, unique: true }, // normalized name+brand+form
  displayName: String,
  hsn: String,          // e.g., "3004", "30049099"
  gstRate: Number,      // 0 | 5 | 12 | 18 | 28
  source: String,       // "static" | "gpt" | "default" | "item"
  confidence: Number,   // 0..1
  approved: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("TaxMap", TaxMapSchema);
