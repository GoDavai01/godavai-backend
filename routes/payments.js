// routes/payments.js
const express = require("express");
const Razorpay = require("razorpay");
const router = express.Router();
const Payment = require("../models/Payment");
const Pharmacy = require("../models/Pharmacy");
const DeliveryPartner = require("../models/DeliveryPartner");

// Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Razorpay Order
router.post("/razorpay/order", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Amount is required and must be a positive number" });
    }
    const options = {
      amount: Math.round(Number(amount) * 100),
      currency: "INR",
      receipt: "receipt_" + Date.now(),
      payment_capture: 1,
    };
    const order = await razorpay.orders.create(options);
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error("Razorpay order creation failed:", err);
    res.status(500).json({ error: "Failed to create Razorpay order", details: err.message });
  }
});

// Mark payment as "paid" after successful Razorpay/UPI/Card payment
router.post('/razorpay/success', async (req, res) => {
  try {
    const { orderId, razorpay_payment_id, razorpay_order_id, razorpay_signature, amount } = req.body;
    // (Signature verification can be added here for extra security)

    // Update Payment status to paid and save gateway details
    const payment = await Payment.findOneAndUpdate(
      { orderId },
      {
        status: "paid",
        paymentGatewayDetails: {
          razorpay_payment_id,
          razorpay_order_id,
          razorpay_signature,
          amount,
          paidAt: new Date(),
        }
      },
      { new: true }
    );
    if (!payment) {
      return res.status(404).json({ error: "Payment record not found" });
    }
    res.json({ message: "Payment updated to PAID", payment });
  } catch (err) {
    console.error("Razorpay success update failed:", err);
    res.status(500).json({ error: "Failed to update payment", details: err.message });
  }
});

// GET /api/payments?status=paid&pharmacyId=xxx&deliveryPartnerId=yyy
router.get("/", async (req, res) => {
  try {
    const { status, pharmacyId, deliveryPartnerId, orderId } = req.query;
    let query = {};
    if (status) query.status = status;
    if (pharmacyId) query.pharmacyId = pharmacyId;
    if (deliveryPartnerId) query.deliveryPartnerId = deliveryPartnerId;
    if (orderId) query.orderId = orderId;

    const payments = await Payment.find(query)
      .populate("userId", "name email mobile")
      .populate("pharmacyId", "name")
      .populate("deliveryPartnerId", "name")
      .populate("orderId", "total createdAt status")
      .sort({ createdAt: -1 });
    res.json(payments);
  } catch (err) {
    console.error("Error in GET /api/payments:", err);
    res.status(500).json({ error: "Failed to fetch payments", details: err.message });
  }
});

module.exports = router;
