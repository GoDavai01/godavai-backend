const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
  address: { type: Object, required: true },
  items: [
    {
      name: { type: String, trim: true },
      quantity: Number,
      price: Number,
      _id: false
    },
  ],
  total: Number,
  status: { type: String, default: "placed", trim: true },
  dosage: { type: String, trim: true },
  note: { type: String, trim: true },
  prescription: { type: String, trim: true },
  quote: {
    items: [
      {
        medicineName: { type: String, trim: true },
        brand: { type: String, trim: true },
        price: Number,
        quantity: Number,
        available: Boolean,
        _id: false
      }
    ],
    unavailable: Array,
    price: Number,
    message: { type: String, trim: true },
    quotedAt: Date,
    rejectedAt: Date
  },
  paymentStatus: { type: String, default: "NOT_PAID", trim: true },
  paymentMethod: { type: String, trim: true },
  paymentDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  deliveryInstructions: { type: String, trim: true },
  // Timestamps below are left as is for domain logic:
  createdAt: { type: Date, default: Date.now },
  confirmedAt: Date,
  pharmacyAcceptedAt: Date,
  assignedAt: Date,
  partnerAcceptedAt: Date,
  pickedUpAt: Date,
  deliveredAt: Date,
  coupon: { type: String, trim: true },
  tip: Number,
  donate: Number,
  chatLastSeenByUser: { type: Date, default: new Date(0) },
  pharmacyRating: { type: Number },
  deliveryRating: { type: Number },
  deliveryBehavior: [{ type: String, trim: true }],
  deliveryPartner: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryPartner" },
  deliveryAssignmentStatus: { 
    type: String, 
    enum: ["unassigned", "assigned", "accepted", "rejected"], 
    default: "unassigned",
    trim: true
  },
  assignmentHistory: [
    {
      deliveryPartner: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryPartner" },
      status: { type: String, trim: true },
      at: { type: Date, default: Date.now }
    }
  ],
  driverLocation: {
    lat: { type: Number },
    lng: { type: Number },
    lastUpdated: { type: Date },
  },
}, { timestamps: true }); // Adds updatedAt, keeps your createdAt

module.exports = mongoose.model("Order", orderSchema);
