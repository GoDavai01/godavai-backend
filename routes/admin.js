// routes/admin.js
const express = require("express");
const router = express.Router();

const Order = require("../models/Order");
const User = require("../models/User");
const DeliveryPartner = require("../models/DeliveryPartner");
const ChatMessage = require("../models/ChatMessage");

// ✅ use same auth pattern as your other admin-protected routes
const auth = require("../middleware/auth");

// ------------------------
// ✅ Admin-only middleware
// ------------------------
const isAdmin = (req, res, next) => {
  return auth(req, res, () => {
    const ok = !!req.user?.adminId || req.user?.type === "admin";
    if (!ok) return res.status(403).json({ error: "Admin only" });
    next();
  });
};

// ========== DELIVERY PARTNER - CUSTOMER CHATS FOR ADMIN DASHBOARD ==========
router.get("/delivery-chats", isAdmin, async (req, res) => {
  try {
    // Fetch all messages where user & delivery partner chat
    const messages = await ChatMessage.find({
      $or: [
        { senderType: "user", to: "delivery" },
        { senderType: "delivery", to: "user" },
      ],
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
    const orders = await Order.find({ _id: { $in: orderIds } }).populate([
      { path: "userId", select: "name" },
      { path: "deliveryPartner", select: "name" },
    ]);

    const orderMap = {};
    for (const order of orders) {
      orderMap[order._id.toString()] = order;
    }

    // Compose final result array
    const chats = orderIds.map((orderId) => {
      const order = orderMap[orderId] || {};
      return {
        orderId: orderId,
        orderDate: order?.createdAt || "",
        customer: order?.userId?.name || "",
        deliveryPartner: order?.deliveryPartner?.name || "",
        messages: grouped[orderId].map((msg) => ({
          senderType: msg.senderType,
          message: msg.message,
          createdAt: msg.createdAt,
        })),
      };
    });

    res.json(chats);
  } catch (err) {
    console.error("Failed to fetch delivery chats:", err);
    res.status(500).json({ error: "Failed to fetch delivery chats" });
  }
});

// ==============================
// ✅ ADMIN: Block / Unblock user
// PATCH /api/admin/users/:id/block
// body: { blocked: true/false }
// ==============================
router.patch("/users/:id/block", isAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const blocked = !!req.body?.blocked;

    // ✅ We set multiple flags to be compatible with whichever field your User schema actually has
    const updated = await User.findByIdAndUpdate(
      id,
      {
        $set: {
          isBlocked: blocked,
          blocked: blocked,
          active: blocked ? false : true,
        },
      },
      { new: true }
    ).select("name email mobile isBlocked blocked active createdAt");

    if (!updated) return res.status(404).json({ error: "User not found" });

    return res.json({ success: true, user: updated });
  } catch (err) {
    console.error("Block/unblock user failed:", err);
    return res.status(500).json({ error: "Failed to update user status" });
  }
});

// ==============================
// ✅ ADMIN: Delete user
// DELETE /api/admin/users/:id
// ==============================
router.delete("/users/:id", isAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const user = await User.findById(id).select("_id name email mobile");
    if (!user) return res.status(404).json({ error: "User not found" });

    await User.deleteOne({ _id: id });

    return res.json({ success: true, message: "User deleted", user });
  } catch (err) {
    console.error("Delete user failed:", err);
    return res.status(500).json({ error: "Failed to delete user" });
  }
});

module.exports = router;
