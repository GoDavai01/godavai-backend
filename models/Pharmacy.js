// models/Pharmacy.js
const mongoose = require('mongoose'); 

const PharmacySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  ownerName: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  area: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]  <-- changed from [0, 0]
    formatted: { type: String }
  },
  contact: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },

  // Regulatory
  qualification: { type: String, required: true, trim: true },
  stateCouncilReg: { type: String, required: true, trim: true },
  drugLicenseRetail: { type: String, required: true, trim: true },
  drugLicenseWholesale: { type: String, trim: true },
  gstin: { type: String, required: true, trim: true },
  shopEstablishmentCert: { type: String, trim: true },
  tradeLicense: { type: String, trim: true },

  // KYC/ID
  identityProof: { type: String, required: true, trim: true },
  addressProof: { type: String, required: true, trim: true },
  photo: { type: String, required: true, trim: true },

  // Document uploads
  qualificationCert: { type: String, required: true, trim: true },
  councilCert: { type: String, required: true, trim: true },
  retailLicense: { type: String, required: true, trim: true },
  wholesaleLicense: { type: String, trim: true },
  gstCert: { type: String, required: true, trim: true },

  // Bank
  bankAccount: { type: String, required: true, trim: true },
  ifsc: { type: String, required: true, trim: true },
  bankName: { type: String, trim: true },
  accountHolder: { type: String, trim: true },

  // Additional
  businessContact: { type: String, trim: true },
  businessContactName: { type: String, trim: true },
  pharmacyTimings: {
    type: {
      is24Hours: { type: Boolean, default: false },
      open: { type: String, trim: true },
      close: { type: String, trim: true },
    },
    required: true
  },
  digitalSignature: { type: String, trim: true },
  emergencyContact: { type: String, trim: true },

  declarationAccepted: { type: Boolean, required: true },

  medicines: [{ type: mongoose.Schema.Types.ObjectId, ref: "Medicine" }],
  active: { type: Boolean, default: true },
  status: { type: String, default: "pending" },
  pin: { type: String, required: true, unique: true, trim: true },
  otp: { type: String },
  otpExpiry: { type: Date }
}, { timestamps: true }); // <-- replaces manual createdAt

// Optional: store native push tokens (for Capacitor builds)
PharmacySchema.add({
  deviceTokens: [{
    token: { type: String, trim: true },
    platform: { type: String, trim: true } // "android" | "ios" | "web"
  }]
});

PharmacySchema.index({ location: "2dsphere" });

module.exports = mongoose.model('Pharmacy', PharmacySchema);
