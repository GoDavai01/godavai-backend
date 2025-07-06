// models/DeliveryPartner.js
const mongoose = require("mongoose");

const DeliveryPartnerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  mobile: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }, // Hashed, never plain
  vehicle: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  area: { type: String, required: true, trim: true },
  aadhaarNumber: { type: String, required: true, trim: true },
  aadhaarDocUrl: { type: String, trim: true },
  panNumber: { type: String, required: true, trim: true },
  panDocUrl: { type: String, trim: true },
  bankDetails: {
    bankAccount: { type: String, required: true, trim: true },
    ifsc: { type: String, required: true, trim: true },
    accountHolder: { type: String, required: true, trim: true }
  },
  // Live GPS location tracking
  location: {
    lat: { type: Number },
    lng: { type: Number },
    lastUpdated: { type: Date }
  },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  active: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model("DeliveryPartner", DeliveryPartnerSchema);
