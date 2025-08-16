// routes/admin.js
const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const User = require("../models/User");
const DeliveryPartner = require("../models/DeliveryPartner");
const ChatMessage = require("../models/ChatMessage");

// ========== DELIVERY PARTNER - CUSTOMER CHATS FOR ADMIN DASHBOARD ==========
router.get("/delivery-chats", async (req, res) => {
  try {
    // Fetch all messages where user & delivery partner chat
    const messages = await ChatMessage.find({
      $or: [
        { senderType: "user", to: "delivery" },
        { senderType: "delivery", to: "user" }
      ]
    }).sort({ createdAt: 1 });

    // Group messages by orderId
    const grouped = {};
    for (const msg of messages) {
      const oid = msg.orderId.toString();
      if (!grouped[oid]) grouped[oid] = [];
      grouped[oid].push(msg);
    }

    // For each orderId, get order info, customer name, delivery partner name
    const orderIds = Object.keys(grouped);
    const orders = await Order.find({ _id: { $in: orderIds } })
      .populate([
        { path: "userId", select: "name" },
        { path: "deliveryPartner", select: "name" }
      ]);
    const orderMap = {};
    for (const order of orders) {
      orderMap[order._id.toString()] = order;
    }

    // Compose final result array
    const chats = orderIds.map(orderId => {
      const order = orderMap[orderId] || {};
      return {
        orderId: orderId,
        orderDate: order?.createdAt || "",
        customer: order?.userId?.name || "",
        deliveryPartner: order?.deliveryPartner?.name || "",
        messages: grouped[orderId].map(msg => ({
          senderType: msg.senderType,
          message: msg.message,
          createdAt: msg.createdAt
        }))
      };
    });

    res.json(chats);
  } catch (err) {
    console.error("Failed to fetch delivery chats:", err);
    res.status(500).json({ error: "Failed to fetch delivery chats" });
  }
});

module.exports = router;
