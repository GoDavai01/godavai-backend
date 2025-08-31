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
  // GeoJSON live location
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number], // [lng, lat]
      default: [0, 0]
    },
    formatted: { type: String }, // Optional: store pretty address if needed
    lastUpdated: { type: Date }
  },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  active: { type: Boolean, default: false },
  autoAccept: { type: Boolean, default: false }  // <-- partner opt-in for instant auto-accept
}, { timestamps: true });

DeliveryPartnerSchema.index({ location: "2dsphere" });
DeliveryPartnerSchema.index({ active: 1, status: 1, autoAccept: 1 });

module.exports = mongoose.model("DeliveryPartner", DeliveryPartnerSchema);
