// models/DeliveryChat.js

const mongoose = require("mongoose");

const DeliveryChatSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    required: true,
    index: true,
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  deliveryPartnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DeliveryPartner",
    required: true,
  },
  messages: [
    {
      senderType: {
        type: String,
        enum: ["user", "delivery"],
        required: true,
      },
      senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
      message: { type: String, required: true, trim: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model("DeliveryChat", DeliveryChatSchema);
