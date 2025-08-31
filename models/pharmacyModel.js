const mongoose = require('mongoose');

const pharmacySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true }
}, { timestamps: true }); // Adds createdAt, updatedAt

module.exports = mongoose.model('Pharmacy', pharmacySchema);
