// routes/payments.js
const express = require("express");
const Razorpay = require("razorpay");
const router = express.Router();
const Payment = require("../models/Payment");
const Pharmacy = require("../models/Pharmacy");
const DeliveryPartner = require("../models/DeliveryPartner");
const DoctorAppointment = require("../models/DoctorAppointment");
const DoctorNotification = require("../models/DoctorNotification");

const razorpayEnabled = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const razorpay = razorpayEnabled
  ? new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })
  : null;

// Create Razorpay Order
router.post("/razorpay/order", async (req, res) => {
  try {
    if (!razorpayEnabled || !razorpay) {
      return res.status(503).json({ error: "Razorpay is not configured on server" });
    }
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

// Verify doctor consult payment and confirm booking
router.post("/verify", async (req, res) => {
  try {
    const consultId = String(req.body?.consultId || "").trim();
    const paymentRef = String(req.body?.paymentRef || "").trim();
    const paymentMethod = String(req.body?.paymentMethod || "").trim().toLowerCase();
    const transactionId = String(req.body?.transactionId || "").trim();

    if (!consultId) return res.status(400).json({ error: "consultId is required" });
    const consult = await DoctorAppointment.findById(consultId);
    if (!consult) return res.status(404).json({ error: "Consult not found" });

    if (consult.status !== "pending_payment") {
      return res.status(409).json({ error: "Consult is not in pending payment state" });
    }

    const now = new Date();
    if (consult.holdExpiresAt && new Date(consult.holdExpiresAt) <= now) {
      consult.status = "cancelled";
      consult.cancelReason = "Payment hold expired";
      consult.cancelledAt = now;
      consult.paymentStatus = "failed";
      await consult.save();
      return res.status(409).json({ error: "Payment hold expired. Please book again." });
    }

    if (!paymentMethod || !["upi", "card", "netbanking", "cash"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Valid paymentMethod is required" });
    }
    if (!transactionId) return res.status(400).json({ error: "transactionId is required" });

    if (paymentRef && consult.paymentRef && paymentRef !== consult.paymentRef) {
      return res.status(400).json({ error: "paymentRef mismatch" });
    }

    consult.paymentMethod = paymentMethod;
    consult.transactionId = transactionId;
    consult.paymentStatus = "paid";
    consult.amountPaid = consult.fee || 0;
    consult.status = "confirmed";
    consult.holdExpiresAt = null;
    consult.locationUnlockedForPatient = consult.mode === "inperson";
    await consult.save();

    DoctorNotification.create({
      doctorId: consult.doctorId,
      type: "booking_confirmed",
      title: `New ${consult.mode === "inperson" ? "In-person" : consult.mode === "video" ? "Video" : "Audio"} booking confirmed`,
      message: `${consult.patientName || "Patient"} | ${consult.date} | ${consult.slot} | Booking ${consult._id.toString().slice(-6)}`,
      bookingId: consult._id,
      meta: { mode: consult.mode, date: consult.date, slot: consult.slot },
    }).catch(() => {});

    res.json({
      ok: true,
      consultId: consult._id,
      status: consult.status,
      paymentStatus: consult.paymentStatus,
    });
  } catch (err) {
    console.error("POST /api/payments/verify error:", err?.message || err);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

module.exports = router;
