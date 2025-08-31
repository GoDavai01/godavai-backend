// routes/chat.js
const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");
const Order = require("../models/Order");
const auth = require("../middleware/auth");
const mongoose = require("mongoose");

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

router.use((req, res, next) => {
  console.log("CHAT ROUTE HIT:", req.method, req.originalUrl);
  next();
});

// Customer: unread count for delivery messages
router.get("/:orderId/delivery-unread-count", auth, async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.userId;
  if (!userId || !isValidId(orderId)) return res.json({ unreadCount: 0 });
  try {
    const order = await Order.findById(orderId);
    const lastSeen = order?.chatLastSeenByUser || new Date(0);

    const unreadCount = await ChatMessage.countDocuments({
      orderId,
      senderType: "delivery",
      createdAt: { $gt: lastSeen }
    });

    res.json({ unreadCount });
  } catch (err) {
    console.error("delivery-unread-count error:", err);
    res.status(500).json({ unreadCount: 0 });
  }
});

// Customer: mark as seen
router.patch("/:orderId/delivery-chat-seen", auth, async (req, res) => {
  const { orderId } = req.params;
  if (!req.user.userId || !isValidId(orderId)) return res.json({ ok: false });
  try {
    await Order.findByIdAndUpdate(orderId, { chatLastSeenByUser: new Date() });
    res.json({ ok: true });
  } catch (err) {
    console.error("delivery-chat-seen error:", err);
    res.status(500).json({ ok: false });
  }
});

// Delivery Partner: unread count for user messages
router.get("/:orderId/user-unread-count", auth, async (req, res) => {
  const { orderId } = req.params;
  const deliveryPartnerId = req.user.deliveryPartnerId;
  if (!deliveryPartnerId || !isValidId(orderId)) return res.json({ unreadCount: 0 });
  try {
    const order = await Order.findById(orderId);
    const lastSeen = order?.chatLastSeenByDelivery || new Date(0);

    const unreadCount = await ChatMessage.countDocuments({
      orderId,
      senderType: "user",
      createdAt: { $gt: lastSeen }
    });

    res.json({ unreadCount });
  } catch (err) {
    console.error("user-unread-count error:", err);
    res.status(500).json({ unreadCount: 0 });
  }
});

// Delivery Partner: mark as seen
router.patch("/:orderId/user-chat-seen", auth, async (req, res) => {
  const { orderId } = req.params;
  if (!req.user.deliveryPartnerId || !isValidId(orderId)) return res.json({ ok: false });
  try {
    await Order.findByIdAndUpdate(orderId, { chatLastSeenByDelivery: new Date() });
    res.json({ ok: true });
  } catch (err) {
    console.error("user-chat-seen error:", err);
    res.status(500).json({ ok: false });
  }
});

// Chat history
router.get("/:orderId/:thread", auth, async (req, res) => {
  const { orderId, thread } = req.params;
  if (!isValidId(orderId)) return res.status(400).json({ error: "Invalid orderId" });
  try {
    let participants = ["user", thread];
    const messages = await ChatMessage.find({
      orderId,
      senderType: { $in: participants },
      to: { $in: participants }
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.error("Fetch chat history error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Send message
router.post("/:orderId/:thread", auth, async (req, res) => {
  const { orderId, thread } = req.params;
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "Message required" });
  if (!isValidId(orderId)) return res.status(400).json({ error: "Invalid orderId" });

  let senderType, senderId, to;
  if (req.user.userId) {
    senderType = "user";
    senderId = req.user.userId;
    to = thread;
  } else if (req.user.pharmacyId) {
    senderType = "pharmacy";
    senderId = req.user.pharmacyId;
    to = "user";
  } else if (req.user.deliveryPartnerId) {
    senderType = "delivery";
    senderId = req.user.deliveryPartnerId;
    to = "user";
  } else {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status === "delivered") return res.status(403).json({ error: "Cannot chat after order delivered" });

    const chatMsg = new ChatMessage({ orderId, senderType, senderId, message, to });
    await chatMsg.save();
    res.status(201).json(chatMsg);
  } catch (err) {
    console.error("Send chat message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

module.exports = router;
