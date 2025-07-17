// models/User.js
const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema({
  type: { type: String, default: "Home" }, // Home, Work, Other
  name: String,
  phone: String,
  addressLine: String,
  formatted: String,   // <-- Add this!
  city: String,        // <-- Add this!
  state: String,       // <-- Add this!
  country: String,     // <-- Add this!
  postal_code: String, // <-- Add this!
  lat: Number,         // <-- Add this!
  lng: Number,         // <-- Add this!
  place_id: String,    // <-- Add this!
  floor: String,
  landmark: String,
  isDefault: { type: Boolean, default: false },
  id: String, // unique client-side ID (for reference)
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  mobile: { type: String, trim: true, unique: true, sparse: true },
  password: { type: String },
  avatar: { type: String },
  dob: { type: String },
  address: { type: String },
  addresses: { type: [addressSchema], default: [] }, // <-- ADD THIS LINE

  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  resetOTP: { type: String },
  resetOTPExpires: { type: Date },
  otp: { type: String },
  otpExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
