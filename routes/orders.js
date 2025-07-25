// routes/orders.js
const express = require("express");
const axios = require('axios');
const router = express.Router();
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Pharmacy = require("../models/Pharmacy");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { notifyUser, saveInAppNotification } = require("../utils/notify");
const { createPaymentRecord } = require('../controllers/paymentsController');
const Payment = require("../models/Payment");

// 1. Create a new order
router.post("/", auth, async (req, res) => {
  try {
    const {
      items, address, dosage, paymentMethod, pharmacyId, total,
      prescription, instructions, coupon, tip, donate,
      deliveryInstructions, paymentStatus, paymentDetails,
    } = req.body;

    if (!items || !address || !pharmacyId || !total) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const order = await Order.create({
      items,
      address,
      dosage,
      paymentMethod,
      pharmacy: pharmacyId,
      total,
      prescription,
      instructions,
      coupon,
      tip,
      donate,
      deliveryInstructions,
      userId: req.user.userId || req.user._id,
      status: "pending",
      paymentStatus: paymentStatus || "NOT_PAID",
      paymentDetails: paymentDetails || {},
      quote: null,
      createdAt: new Date(),
    });

    try {
      await createPaymentRecord(order._id, { method: paymentMethod });
    } catch (err) {
      console.error("Failed to create payment record:", err);
    }

    const pharmacy = await Pharmacy.findById(pharmacyId);
    const orderUser = await User.findById(order.userId);

    if (pharmacy && pharmacy._id) {
      await notifyUser(
        pharmacy._id.toString(),
        "New Prescription Order",
        `New order #${order._id} has been placed and awaits your quote.`,
        `/pharmacy/orders`
      );
      await saveInAppNotification({
        userId: pharmacy._id,
        title: "New Prescription Order",
        message: `Order #${order._id} needs your quote.`,
      });
    }

    if (orderUser && orderUser._id) {
      await notifyUser(
        orderUser._id.toString(),
        "Prescription Uploaded",
        `Your order #${order._id} is waiting for a quote.`,
        `/orders/${order._id}`
      );
      await saveInAppNotification({
        userId: orderUser._id,
        title: "Order Placed",
        message: `Order #${order._id} has been created and is pending quote.`,
      });
    }

    res.status(201).json(order);

  } catch (err) {
    console.error("Error placing order:", err);
    res.status(500).json({ error: "Order creation failed" });
  }
});

// 2. Pharmacy submits quote
router.put("/:orderId/quote", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { quoteItems, unavailableItems, price, message } = req.body;

    const order = await Order.findByIdAndUpdate(orderId, {
      quote: {
        items: quoteItems,
        unavailable: unavailableItems,
        price,
        message,
        quotedAt: new Date(),
      },
      status: "quoted"
    }, { new: true });

    if (!order) return res.status(404).json({ error: "Order not found" });

    const user = await User.findById(order.userId);
    if (user && user._id) {
      await notifyUser(
        user._id.toString(),
        "Quote Ready for Your Order",
        `Quote for order #${order._id} is ready. Review and confirm!`,
        `/orders/${order._id}`
      );
      await saveInAppNotification({
        userId: user._id,
        title: "Quote Ready",
        message: `Order #${order._id} has a quote.`
      });
    }

    res.json(order);

  } catch (err) {
    console.error("Error quoting order:", err);
    res.status(500).json({ error: "Quote submission failed" });
  }
});

// 3. User accepts quote and pays
router.put("/:orderId/accept", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentStatus, paymentDetails } = req.body;

    let updateObj = {
      confirmedAt: new Date(),
    };

    if (paymentStatus === "PARTIAL_PAID") {
      updateObj.status = "processing";
      updateObj.paymentStatus = "PARTIAL_PAID";
      updateObj.paymentDetails = paymentDetails;
    } else if (paymentStatus === "PAID") {
      updateObj.status = "processing";
      updateObj.paymentStatus = "PAID";
      updateObj.paymentDetails = paymentDetails;
    } else {
      updateObj.status = "processing";
    }

    const orderBefore = await Order.findById(orderId);
    if (!orderBefore.pharmacyAcceptedAt) {
      updateObj.pharmacyAcceptedAt = new Date();
    }

    const order = await Order.findByIdAndUpdate(orderId, {
      ...updateObj,
    }, { new: true });

    if (!order) return res.status(404).json({ error: "Order not found" });

    const pharmacy = await Pharmacy.findById(order.pharmacy);
    const user = await User.findById(order.userId);

    if (pharmacy && pharmacy._id) {
      await notifyUser(
        pharmacy._id.toString(),
        "Order Confirmed",
        `Order #${order._id} is confirmed and payment received.`,
        `/pharmacy/orders`
      );
      await saveInAppNotification({
        userId: pharmacy._id,
        title: "Order Confirmed",
        message: `Order #${order._id} is now confirmed and ready to process.`
      });
    }

    if (user && user._id) {
      await notifyUser(
        user._id.toString(),
        "Order Confirmed",
        `Your order #${order._id} has been confirmed and is being processed.`,
        `/orders/${order._id}`
      );
      await saveInAppNotification({
        userId: user._id,
        title: "Order Confirmed",
        message: `Order #${order._id} has been confirmed and payment is successful.`
      });
    }

    res.json(order);

  } catch (err) {
    console.error("Error accepting order:", err);
    res.status(500).json({ error: "Order accept failed" });
  }
});

// 4. Update order status
router.put("/:orderId/status", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, statusText } = req.body;

    let updateObj = { status };
    const orderBefore = await Order.findById(orderId);

    // a. Pharmacy Accepts/Starts Processing
    if (status === "processing" && !orderBefore.pharmacyAcceptedAt) {
      updateObj.pharmacyAcceptedAt = new Date();
      orderBefore.assignmentHistory = orderBefore.assignmentHistory || [];
      orderBefore.assignmentHistory.push({
        status: "pharmacy_accepted",
        at: updateObj.pharmacyAcceptedAt
      });
      await orderBefore.save();
    }

    if (status === "assigned" && !orderBefore.assignedAt) {
      updateObj.assignedAt = new Date();
    }

    if (
      (status === "accepted" || status === "out_for_delivery") &&
      !orderBefore.partnerAcceptedAt
    ) {
      updateObj.partnerAcceptedAt = new Date();
    }

    if (status === "picked_up" && !orderBefore.pickedUpAt) {
      updateObj.pickedUpAt = new Date();
    }

    if (status === "delivered" && !orderBefore.deliveredAt) {
      updateObj.deliveredAt = new Date();
    }

    const order = await Order.findByIdAndUpdate(orderId, updateObj, { new: true });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const pharmacy = await Pharmacy.findById(order.pharmacy);
    const user = await User.findById(order.userId);

    if (user && user._id) {
      await notifyUser(
        user._id.toString(),
        "Order Status Updated",
        `Your order #${order._id} is now "${statusText || status}".`,
        `/orders/${order._id}`
      );
      await saveInAppNotification({
        userId: user._id,
        title: "Order Status Updated",
        message: `Order #${order._id} is now "${statusText || status}".`
      });
    }

    if (pharmacy && pharmacy._id) {
      await notifyUser(
        pharmacy._id.toString(),
        "Order Status Updated",
        `Order #${order._id} is now "${statusText || status}".`,
        `/pharmacy/orders`
      );
      await saveInAppNotification({
        userId: pharmacy._id,
        title: "Order Status Updated",
        message: `Order #${order._id} is now "${statusText || status}".`
      });
    }

    res.json(order);

  } catch (err) {
    console.error("Error updating order status:", err);
    res.status(500).json({ error: "Order status update failed" });
  }
});

// Get order by id
router.get("/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId).populate("pharmacy");
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Fetch order failed" });
  }
});

// User rejects quote
router.put("/:orderId/reject", async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findByIdAndUpdate(orderId, {
      status: "rejected",
      "quote.rejectedAt": new Date()
    }, { new: true });
    if (!order) return res.status(404).json({ error: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Quote rejection failed" });
  }
});

// Get all orders for logged-in user (JWT protected)
router.get("/myorders", auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user._id;
    if (!userId) return res.status(401).json({ error: "User ID missing from token" });
    const orders = await Order.find({ userId }).populate("pharmacy");
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Fetch order failed" });
  }
});

// Debug/status/utility routes
router.get('/debug', (req, res) => res.json({ ok: true }));
router.get('/test', (req, res) => res.json({ ok: true }));
router.get('/alive', (req, res) => res.json({ status: 'orders route alive' }));
router.get('/allorders', async (req, res) => {
  try {
    const orders = await Order.find().limit(5);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Fetch all orders failed" });
  }
});

// Order ETA using Google Maps Directions
router.get("/:orderId/eta", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order || !order.driverLocation || !order.address) {
      return res.status(400).json({ error: "Order/location info missing" });
    }
    const userLat = order.address.lat || 28.4595;
    const userLng = order.address.lng || 77.0266;
    const driverLat = order.driverLocation.lat;
    const driverLng = order.driverLocation.lng;
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${driverLat},${driverLng}&destination=${userLat},${userLng}&key=YOUR_GOOGLE_API_KEY`;
    const resp = await axios.get(url);
    const eta = resp.data.routes?.[0]?.legs?.[0]?.duration?.text || "N/A";
    res.json({ eta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADMIN: Assign delivery partner to order
router.patch("/:orderId/assign-delivery-partner", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { deliveryPartnerId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (
      (order.paymentStatus === "COD" || order.paymentStatus === "PAID" || order.paymentStatus === "PARTIAL_PAID") &&
      !order.pharmacyAcceptedAt
    ) {
      order.pharmacyAcceptedAt = order.confirmedAt || order.createdAt || new Date();
      order.assignmentHistory = order.assignmentHistory || [];
      if (!order.assignmentHistory.find(h => h.status === "pharmacy_accepted")) {
        order.assignmentHistory.push({ status: "pharmacy_accepted", at: order.pharmacyAcceptedAt });
      }
      if (order.status === "pending" || order.status === "quoted") {
        order.status = "processing";
      }
      await order.save();
    }

    order.deliveryPartner = deliveryPartnerId;
    order.deliveryAssignmentStatus = "assigned";
    order.status = "assigned";
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      deliveryPartner: deliveryPartnerId,
      status: "assigned",
      at: new Date()
    });
    if (!order.assignedAt) {
      order.assignedAt = new Date();
    }
    await order.save();

    await Payment.updateOne(
      { orderId: order._id },
      { $set: { deliveryPartnerId: deliveryPartnerId } }
    );
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: "Failed to assign delivery partner", details: err.message });
  }
});

// GET all orders (admin only)
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("userId", "name email mobile address")
      .populate("pharmacy", "name contact city area")
      .populate("deliveryPartner", "name mobile")
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Fetch all orders failed" });
  }
});

// Ratings submission route
router.post('/:orderId/ratings', async (req, res) => {
  try {
    const { pharmacyRating, deliveryRating, deliveryBehavior } = req.body;
    const orderId = req.params.orderId;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    order.pharmacyRating = pharmacyRating;
    order.deliveryRating = deliveryRating;
    order.deliveryBehavior = deliveryBehavior;

    await order.save();
    res.json({ message: "Ratings submitted successfully!" });
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit ratings.' });
  }
});

module.exports = router;
