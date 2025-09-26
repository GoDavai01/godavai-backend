// models/DeliveryPartner.js
const mongoose = require("mongoose");

const DeliveryPartnerSchema = new mongoose.Schema(
  {
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
      accountHolder: { type: String, required: true, trim: true },
    },

    // GeoJSON live location (with nested freshness timestamp)
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: [0, 0],
      },
      formatted: { type: String },
      lastUpdated: { type: Date }, // when we last got a GPS ping
    },

    // Freshness (root-level) to simplify queries (NEW)
    lastSeenAt: { type: Date }, // mirror of lastUpdated for easy $gte filters

    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    active: { type: Boolean, default: false },
    autoAccept: { type: Boolean, default: false }, // partner opt-in for instant auto-accept

    // NEW: push device tokens + simple prefs
    deviceTokens: [
      {
        token: { type: String },
        platform: { type: String, enum: ["android", "ios", "web"], default: "android" },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    notificationPrefs: {
      offers: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// Indexes
DeliveryPartnerSchema.index({ location: "2dsphere" });
DeliveryPartnerSchema.index({ active: 1, status: 1, autoAccept: 1 });
DeliveryPartnerSchema.index({ lastSeenAt: 1 }); // NEW: lets us quickly filter "fresh" partners

module.exports = mongoose.model("DeliveryPartner", DeliveryPartnerSchema);
