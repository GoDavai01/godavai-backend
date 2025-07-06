// routes/deliveryRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const DeliveryPartner = require("../models/DeliveryPartner");
const Order = require("../models/Order");
const otpMap = new Map();
const Payment = require("../models/Payment");

// Multer config for document uploads
const upload = multer({
  dest: "uploads/delivery-docs/",
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.test(ext));
  }
});

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// 1. Register Delivery Partner (pending)
router.post(
  "/register",
  upload.fields([
    { name: "aadhaarDoc", maxCount: 1 },
    { name: "panDoc", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const {
        name, mobile, email, password, vehicle, city, area,
        aadhaarNumber, panNumber, bankAccount, ifsc, accountHolder
      } = req.body;
      const aadhaarDocUrl = req.files?.aadhaarDoc?.[0]?.path || "";
      const panDocUrl = req.files?.panDoc?.[0]?.path || "";

      const hashedPassword = await bcrypt.hash(password, 10);

      const delivery = await DeliveryPartner.create({
        name, mobile, email,
        password: hashedPassword,
        vehicle, city, area,
        aadhaarNumber, panNumber,
        bankDetails: { bankAccount, ifsc, accountHolder },
        aadhaarDocUrl, panDocUrl,
        status: "pending"
      });
      res.status(201).json({ msg: "Submitted for approval", id: delivery._id });
    } catch (err) {
      console.error("Register delivery partner error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  }
);

// 2. List all pending delivery partners (for admin approval)
router.get("/pending", async (req, res) => {
  try {
    const pending = await DeliveryPartner.find({ status: "pending" });
    res.json(pending);
  } catch (err) {
    console.error("List pending delivery partners error:", err);
    res.status(500).json({ error: "Failed to fetch" });
  }
});

// 3. Approve a delivery partner (admin)
router.post("/approve", async (req, res) => {
  try {
    const { id } = req.body;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid ID" });
    await DeliveryPartner.findByIdAndUpdate(id, { status: "approved" });
    res.json({ msg: "Approved" });
  } catch (err) {
    console.error("Approve delivery partner error:", err);
    res.status(500).json({ error: "Approval failed" });
  }
});

// 4. Delete/reject a delivery partner (admin)
router.delete("/delete/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
    await DeliveryPartner.findByIdAndDelete(req.params.id);
    res.json({ msg: "Deleted" });
  } catch (err) {
    console.error("Delete delivery partner error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// 5. Get all approved delivery partners
router.get("/partners", async (req, res) => {
  try {
    const all = await DeliveryPartner.find({ status: "approved" });
    res.json(all);
  } catch (err) {
    console.error("Get all partners error:", err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// PATCH: Set delivery partner active/inactive
router.patch('/partner/:id/active', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
    const partner = await DeliveryPartner.findById(req.params.id);
    if (!partner) return res.status(404).json({ error: 'Not found' });
    partner.active = !partner.active;
    await partner.save();
    res.json({ ok: true, active: partner.active });
  } catch (err) {
    console.error("Set partner active error:", err);
    res.status(500).json({ error: "Failed to update active status" });
  }
});

// 6. Get one delivery partner's info, current and past orders
router.get("/partner/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
    const partner = await DeliveryPartner.findById(req.params.id).lean();
    if (!partner) return res.status(404).json({ error: "Not found" });

    const activeOrder = await Order.findOne({
      deliveryPartner: req.params.id,
      status: { $in: ["processing", "out_for_delivery"] }
    }).populate("pharmacy");
    const pastOrders = await Order.find({
      deliveryPartner: req.params.id,
      status: "delivered"
    }).sort({ createdAt: -1 }).limit(20);

    res.json({ partner, activeOrder, pastOrders });
  } catch (err) {
    console.error("Get delivery partner info error:", err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// 7. Assign delivery partner to an order (after pharmacy accepts)
router.post("/assign", async (req, res) => {
  try {
    const { orderId, deliveryPartnerId } = req.body;
    if (!isValidId(orderId) || !isValidId(deliveryPartnerId)) {
      return res.status(400).json({ error: "Invalid orderId or deliveryPartnerId" });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "processing" || !order.pharmacyAccepted) {
      return res.status(400).json({ error: "Order not ready for assignment" });
    }
    order.deliveryPartner = deliveryPartnerId;
    await order.save();
    res.json({ msg: "Delivery partner assigned" });
  } catch (err) {
    console.error("Assign delivery partner error:", err);
    res.status(500).json({ error: "Assignment failed" });
  }
});

// 8. Forgot password (request OTP)
router.post("/forgot-password", async (req, res) => {
  try {
    const { mobile } = req.body;
    const delivery = await DeliveryPartner.findOne({ mobile });
    if (!delivery) return res.status(404).json({ error: "Mobile not found" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpMap.set(mobile, otp);
    // In production: send SMS here!
    // console.log(`OTP for ${mobile}: ${otp}`); // REMOVE/disable in production
    res.json({ msg: "OTP sent!" });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "OTP send failed" });
  }
});

// 9. Reset password
router.post("/reset-password", async (req, res) => {
  try {
    const { mobile, otp, newPassword } = req.body;
    if (!otpMap.has(mobile) || otpMap.get(mobile) !== otp)
      return res.status(400).json({ error: "Invalid OTP" });
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await DeliveryPartner.findOneAndUpdate({ mobile }, { password: hashedPassword });
    otpMap.delete(mobile);
    res.json({ msg: "Password reset successful" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Reset password failed" });
  }
});

// 10. Update current location (called by delivery dashboard)
router.post("/update-location", async (req, res) => {
  try {
    const { partnerId, orderId, lat, lng } = req.body;
    if (partnerId && !isValidId(partnerId)) return res.status(400).json({ error: "Invalid partnerId" });
    if (orderId && !isValidId(orderId)) return res.status(400).json({ error: "Invalid orderId" });
    await DeliveryPartner.findByIdAndUpdate(partnerId, { location: { lat, lng, lastUpdated: new Date() } });
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, { driverLocation: { lat, lng, lastUpdated: new Date() } });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Update location error:", err);
    res.status(500).json({ error: "Failed to update location" });
  }
});

// 11. Delivery Partner Login (with bcrypt and JWT!)
router.post("/login", async (req, res) => {
  const { mobile, password } = req.body;
  try {
    const partner = await DeliveryPartner.findOne({ mobile, status: "approved" });
    if (!partner) return res.status(401).json({ error: "Invalid credentials or not approved" });

    const ok = await bcrypt.compare(password, partner.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      {
        deliveryPartnerId: partner._id,
        type: "delivery",
        name: partner.name,
        mobile: partner.mobile
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      partner: {
        _id: partner._id,
        name: partner.name,
        mobile: partner.mobile,
        city: partner.city,
        area: partner.area,
        active: partner.active
      }
    });
  } catch (err) {
    console.error("Delivery login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ...rest of your unchanged routes (accept/reject/status update/get assigned orders)...
router.patch("/orders/:orderId/accept", async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ error: "Invalid orderId" });
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.deliveryPartner) return res.status(400).json({ error: "No delivery partner assigned" });

    order.deliveryAssignmentStatus = "accepted";
    order.status = "accepted";
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      deliveryPartner: order.deliveryPartner,
      status: "accepted",
      at: new Date()
    });
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    console.error("Accept order error:", err);
    res.status(500).json({ error: "Failed to accept order" });
  }
});

router.patch("/orders/:orderId/reject", async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ error: "Invalid orderId" });
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.deliveryPartner) return res.status(400).json({ error: "No delivery partner assigned" });

    order.deliveryAssignmentStatus = "rejected";
    order.status = "processing";
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      deliveryPartner: order.deliveryPartner,
      status: "rejected",
      at: new Date()
    });
    order.deliveryPartner = null;
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    console.error("Reject order error:", err);
    res.status(500).json({ error: "Failed to reject order" });
  }
});

router.patch("/orders/:orderId/status", async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ error: "Invalid orderId" });
    const { orderId } = req.params;
    const { status } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.deliveryPartner) return res.status(400).json({ error: "No delivery partner assigned" });

    order.status = status;
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      deliveryPartner: order.deliveryPartner,
      status: status,
      at: new Date()
    });
    await order.save();

    // --- Mark Payment as PAID for COD orders when delivered ---
    if (
      status === "delivered" &&
      (order.paymentMethod === "cod" || order.paymentMethod === "cash")
    ) {
      await Payment.updateOne({ orderId: order._id }, { status: "paid" });
    }
    res.json({ success: true, order });
  } catch (err) {
    console.error("Update order status error:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

// 12. Get assigned orders for logged-in delivery partner
router.get("/orders", async (req, res) => {
  const deliveryPartnerId = req.headers['deliverypartnerid'] || req.query.deliveryPartnerId;
  if (!deliveryPartnerId || !isValidId(deliveryPartnerId)) return res.status(400).json({ error: "Invalid deliveryPartnerId" });
  try {
    const orders = await Order.find({
      deliveryPartner: deliveryPartnerId,
      status: { $in: ["assigned", "accepted", "out_for_delivery"] }
    }).populate("pharmacy");
    res.json(orders);
  } catch (err) {
    console.error("Get assigned orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

module.exports = router;
