// routes/supportChat.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const SupportChat = require("../models/SupportChat");
const User = require("../models/User");
const auth = require("../middleware/auth");

// --- FAQ Bot Logic ---
const faqAnswers = [
  { q: /refund|money|return/i, a: "Refunds are processed within 3-5 days of order cancellation. Still stuck? Type 'human' for support." },
  { q: /cancel|cancelled/i, a: "To cancel your order, go to 'My Orders' and select the order to cancel. Still need help? Type 'human'." },
  { q: /not delivered|late|delay/i, a: "We're sorry for the delay! Your order is on the way. If urgent, type 'human'." },
  { q: /wrong item|wrong medicine|incorrect/i, a: "Sorry! Please type 'human' and our team will resolve this." },
  { q: /contact|call|phone/i, a: "You can reach us via this chat or type 'human' for a support agent." },
  { q: /hello|hi|hey/i, a: "Hi there! How can I help you today? Type your issue below." }
];
function botReply(userMsg) {
  for (let f of faqAnswers) {
    if (f.q.test(userMsg)) return f.a;
  }
  if (/human|support|agent|help/i.test(userMsg)) return null;
  return "I'm a GoDavai Support Bot! Type your issue, or type 'human' to connect with our support team.";
}

// Utility to validate MongoDB ObjectId
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// --- Start/Fetch Chat Thread ---
router.get("/thread", auth, async (req, res) => {
  try {
    let { orderId } = req.query;
    let chat = await SupportChat.findOne({ userId: req.user._id, orderId }).sort({ createdAt: -1 });
    if (!chat) {
      chat = await SupportChat.create({
        userId: req.user._id,
        orderId,
        messages: [
          { sender: "bot", text: "Hi! I am GoDavai Support Bot. Tell me your issue, or type 'human' for a support agent." }
        ]
      });
    }
    res.json(chat);
  } catch (err) {
    console.error("Error fetching/creating thread:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- User sends a message ---
router.post("/message", auth, async (req, res) => {
  try {
    const { orderId, text } = req.body;

    let chat = await SupportChat.findOne({ userId: req.user._id, orderId }).sort({ createdAt: -1 });

    if (chat && chat.status === "closed") {
      chat = await SupportChat.create({
        userId: req.user._id,
        orderId,
        messages: [
          { sender: "bot", text: "Hi! I am GoDavai Support Bot. Tell me your issue, or type 'human' for a support agent." },
          { sender: "user", text }
        ],
        status: "bot"
      });
      const botAns = botReply(text);
      if (botAns) {
        chat.messages.push({ sender: "bot", text: botAns });
      } else {
        chat.messages.push({ sender: "bot", text: "Connecting you to a support agent, please wait..." });
        chat.status = "pending_admin";
      }
      await chat.save();
      return res.json(chat);
    }

    if (!chat) {
      chat = await SupportChat.create({
        userId: req.user._id,
        orderId,
        messages: [
          { sender: "bot", text: "Hi! I am GoDavai Support Bot. Tell me your issue, or type 'human' for a support agent." },
          { sender: "user", text }
        ],
        status: "bot"
      });
      const botAns = botReply(text);
      if (botAns) {
        chat.messages.push({ sender: "bot", text: botAns });
      } else {
        chat.messages.push({ sender: "bot", text: "Connecting you to a support agent, please wait..." });
        chat.status = "pending_admin";
      }
      await chat.save();
      return res.json(chat);
    }

    chat.messages.push({ sender: "user", text });
    if (chat.status === "bot") {
      const botAns = botReply(text);
      if (botAns) {
        chat.messages.push({ sender: "bot", text: botAns });
      } else {
        chat.messages.push({ sender: "bot", text: "Connecting you to a support agent, please wait..." });
        chat.status = "pending_admin";
      }
    }
    await chat.save();
    res.json(chat);
  } catch (err) {
    console.error("Error processing user message:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Admin sends message (admin panel) ---
router.post("/admin-reply", async (req, res) => {
  try {
    const { chatId, text } = req.body;
    if (!isValidObjectId(chatId)) return res.status(400).json({ error: "Invalid chatId" });
    const chat = await SupportChat.findById(chatId);
    if (!chat) return res.status(404).send("Chat not found");
    chat.messages.push({ sender: "admin", text });
    await chat.save();
    res.json(chat);
  } catch (err) {
    console.error("Error in admin-reply:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Admin fetch all pending chats ---
router.get("/pending", async (req, res) => {
  try {
    const chats = await SupportChat.find({ status: "pending_admin" })
      .populate("userId", "name email mobile")
      .populate("orderId", "id total");
    res.json(chats);
  } catch (err) {
    console.error("Error fetching pending chats:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Admin: fetch all chats, with optional status filter ---
router.get("/all", async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const chats = await SupportChat.find(query)
      .populate("userId", "name email mobile")
      .populate("orderId", "id total");
    res.json(chats);
  } catch (err) {
    console.error("Error fetching all chats:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Admin closes a chat ---
router.post("/close", async (req, res) => {
  try {
    const { chatId } = req.body;
    if (!isValidObjectId(chatId)) return res.status(400).json({ error: "Invalid chatId" });
    const chat = await SupportChat.findById(chatId);
    if (!chat) return res.status(404).send("Chat not found");
    chat.status = "closed";
    await chat.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Error closing chat:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
