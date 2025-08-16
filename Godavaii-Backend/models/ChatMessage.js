const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    required: true,
  },
  senderType: {
    type: String,
    enum: ["user", "pharmacy", "delivery"],
    required: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true, // User/Pharmacy/DeliveryPartner
  },
  message: {
    type: String,
    required: true,
    trim: true,      // Removes accidental leading/trailing spaces
  },
  to: {
    type: String,
    enum: ["user", "pharmacy", "delivery"],
    required: true, // For frontend filtering
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
