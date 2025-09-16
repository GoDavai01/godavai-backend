const mongoose = require("mongoose");

const TaxMapSchema = new mongoose.Schema({
  key: { type: String, index: true, unique: true },
  displayName: String,
  hsn: String,
  gstRate: Number,
  source: String,           // "static" | "web:<host>" | "gpt" | "default" | "item"
  confidence: Number,
  approved: { type: Boolean, default: false },
  evidenceUrl: String,      // NEW
  evidenceTitle: String,    // NEW
  evidenceSnippet: String,  // NEW
}, { timestamps: true });

module.exports = mongoose.model("TaxMap", TaxMapSchema);
