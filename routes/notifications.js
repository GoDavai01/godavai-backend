// routes/notifications.js

const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const mongoose = require("mongoose");

// Helper to validate ObjectId
function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// GET all notifications for a user
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) return res.status(400).json({ error: "Invalid userId" });
    const notifications = await Notification.find({ userId }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// POST mark a notification as read
router.post("/read/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid notification id" });
    await Notification.findByIdAndUpdate(id, { read: true });
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating notification:", err);
    res.status(500).json({ error: "Failed to update notification" });
  }
});

// Optional: mark all as read for a user
router.post("/read-all/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) return res.status(400).json({ error: "Invalid userId" });
    await Notification.updateMany({ userId }, { read: true });
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating notifications:", err);
    res.status(500).json({ error: "Failed to update notifications" });
  }
});

module.exports = router;
