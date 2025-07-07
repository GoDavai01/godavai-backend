// models/PrescriptionOrder.js
const mongoose = require("mongoose");

// Medicine item sub-schema
const MedicineItemSchema = new mongoose.Schema({
  medicineName: String,
  brand: String,
  quantity: Number,
  price: Number,
  available: { type: Boolean, default: true }
}, { _id: false });

const QuoteSchema = new mongoose.Schema({
  pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" },
  items: [MedicineItemSchema],
  price: Number,
  message: String,
  unavailableItems: [String],
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const TimelineSchema = new mongoose.Schema({
  status: String,
  date: { type: Date, default: Date.now }
}, { _id: false });

const PrescriptionOrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" }, // winning pharmacy (if any)
    pharmacyCandidates: [{ type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" }], // can quote

    // ---- Added for new assignment logic ----
    pharmaciesTried: [{ type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" }],
    // ---------------------------------------

    prescriptionUrl: { type: String, required: true },
    city: { type: String },
    area: { type: String },
    notes: { type: String },
    address: {
      // Universal address structure for delivery
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    uploadType: { type: String, enum: ["auto", "manual"] }, // "auto" (system assigns), "manual" (user selects)
    status: {
      type: String,
      enum: [
        "waiting_for_quotes",
        "pending_user_confirm",
        "confirmed",
        "cancelled",
        "processing",
        "dispatched",
        "delivered",
        "split",
        "converted_to_order" // <-- Now supported!
      ],
      default: "waiting_for_quotes"
    },
    quotes: [QuoteSchema],
    quoteExpiry: { type: Date },
    quote: {
      items: [MedicineItemSchema],
      price: Number,
      message: String
    },
    quoteTotal: Number,
    unavailableItems: [String],
    userResponse: { type: String, enum: ["accepted", "rejected", null], default: null },
    parentOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PrescriptionOrder" }, // for split orders
    timeline: [TimelineSchema],
    tempQuote: {
      items: [MedicineItemSchema],
      approxPrice: Number,
      brands: [String],
      message: String
    },
    alreadyFulfilledItems: [MedicineItemSchema],
    paymentStatus: { type: String, default: "PENDING" },
    paymentDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
    confirmedAt: { type: Date },
    convertedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PrescriptionOrder", PrescriptionOrderSchema);
