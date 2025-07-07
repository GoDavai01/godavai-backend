const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  image: { type: String, trim: true },
  code: { type: String, trim: true, unique: true, sparse: true }, // Offer code should be unique if used for redemption!
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true }); // Adds updatedAt for editing/auditing, keeps your createdAt

module.exports = mongoose.model("Offer", offerSchema);
