// routes/deliveryRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const fs = require("fs");
const axios = require("axios"); // for FCM push

const DeliveryPartner = require("../models/DeliveryPartner");
const Order = require("../models/Order");
const Payment = require("../models/Payment");

const upload = require("../utils/upload"); // replaces multer config
const { markOrderDelivered } = require("../controllers/orderController");
const { sendSmsMSG91 } = require("../utils/sms");
const { sendPush } = require("../utils/fcm");

const otpMap = new Map();

// Multer config for document uploads
const isS3 = !!process.env.AWS_BUCKET_NAME;
if (!isS3) {
  fs.mkdirSync("uploads/delivery-docs", { recursive: true });
}

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/* -----------------------------------------------------------------------------
   keep-alive cron (every 2 min) to nudge stale active riders
----------------------------------------------------------------------------- */
let cronRegistered = global.__GD_DELIVERY_CRON__;
if (!cronRegistered) {
  const cron = require("node-cron");
  const axiosCron = require("axios");
  const SERVER_BASE = process.env.SERVER_BASE_URL || "http://localhost:5000";
  cron.schedule("*/2 * * * *", async () => {
    try {
      await axiosCron.post(`${SERVER_BASE}/api/delivery/cron/nudge-stale-loc`);
    } catch (e) {
      console.error("[CRON] nudge-stale-loc failed:", e?.message || e);
    }
  });
  global.__GD_DELIVERY_CRON__ = true;
}

/* ============================================================================
   1) Register Delivery Partner (pending)
============================================================================ */
router.post(
  "/register",
  upload.fields([
    { name: "aadhaarDoc", maxCount: 1 },
    { name: "panDoc", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        name,
        mobile,
        email,
        password,
        vehicle,
        city,
        area,
        aadhaarNumber,
        panNumber,
        bankAccount,
        ifsc,
        accountHolder,
      } = req.body;

      const aadhaarDocUrl = req.files?.aadhaarDoc?.[0]?.location || "";
      const panDocUrl = req.files?.panDoc?.[0]?.location || "";

      // Block registration if either doc is missing
      if (!req.files?.aadhaarDoc || !req.files?.aadhaarDoc[0]) {
        return res.status(400).json({ error: "Aadhaar document is required" });
      }
      if (!req.files?.panDoc || !req.files?.panDoc[0]) {
        return res.status(400).json({ error: "PAN document is required" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const delivery = await DeliveryPartner.create({
        name,
        mobile,
        email,
        password: hashedPassword,
        vehicle,
        city,
        area,
        aadhaarNumber,
        panNumber,
        bankDetails: { bankAccount, ifsc, accountHolder },
        aadhaarDocUrl,
        panDocUrl,
        status: "pending",
      });

      // --- SEND WELCOME + REGISTRATION RECEIVED EMAIL ---
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host: "smtp.hostinger.com",
        port: 465,
        secure: true,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const mailOptions = {
        from: `"GoDavaii" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Thanks for Joining GoDavaii Delivery Partner Program!",
        html: `
          <div style="font-family:sans-serif;background:#F9FAFB;padding:24px 20px;border-radius:10px">
            <h2 style="color:#13C0A2;">Welcome to GoDavaii Delivery!</h2>
            <p>Hi <b>${name}</b>,</p>
            <p>
              Thank you for your interest in joining <b>GoDavaii</b> as a Delivery Partner!
              <br><br>
              GoDavaii is India’s fastest-growing medicine delivery platform, and our partners are the heartbeat of our mission to deliver better health to every doorstep.
            </p>
            <ul>
              <li><b>What’s next?</b> Our admin team will verify your details and documents shortly.</li>
              <li>You’ll get an approval email/SMS as soon as your profile is verified.</li>
              <li>Once approved, you can log in and start accepting orders instantly!</li>
            </ul>
            <p>
              <b>Why GoDavaii?</b><br>
              - Fastest payouts in the industry<br>
              - Transparent order system<br>
              - Supportive & responsive partner team<br>
              - Be a part of something meaningful: delivering medicines, saving lives.
            </p>
            <p style="margin-top:14px;">
              If you have any questions, our team is here to help—just reply to this email.<br>
              <b>Thank you for applying to GoDavaii Delivery. We look forward to welcoming you onboard!</b>
            </p>
            <br>
            <p style="color:#13C0A2;">Team GoDavaii<br>
            <small>Together, let's deliver better health.</small></p>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log("✅ Delivery partner registration email sent to:", email);
      } catch (emailErr) {
        console.error("❌ Failed to send registration email:", emailErr);
      }

      res.status(201).json({ msg: "Submitted for approval", id: delivery._id });
    } catch (err) {
      console.error("Register delivery partner error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  }
);

/* ============================================================================
   2) List all pending delivery partners (for admin approval)
============================================================================ */
router.get("/pending", async (req, res) => {
  try {
    const pending = await DeliveryPartner.find({ status: "pending" });
    res.json(pending);
  } catch (err) {
    console.error("List pending delivery partners error:", err);
    res.status(500).json({ error: "Failed to fetch" });
  }
});

/* ============================================================================
   3) Approve a delivery partner (admin) + send approval email
============================================================================ */
router.post("/approve", async (req, res) => {
  try {
    const { id } = req.body;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid ID" });

    const deliveryPartner = await DeliveryPartner.findByIdAndUpdate(
      id,
      { status: "approved" },
      { new: true }
    );
    if (!deliveryPartner) return res.status(404).json({ error: "Partner not found" });

    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"GoDavaii" <${process.env.EMAIL_USER}>`,
      to: deliveryPartner.email,
      subject: "GoDavaii Delivery Partner Approval 🚀",
      html: `
        <div style="font-family:sans-serif;background:#F9FAFB;padding:25px 18px;border-radius:8px">
          <h2 style="color:#13C0A2;">Welcome to GoDavaii Delivery!</h2>
          <p>Hi <b>${deliveryPartner.name}</b>,</p>
          <p>Your application as a <b>Delivery Partner</b> on GoDavaii has been <span style="color:#13C0A2;"><b>approved</b></span>!</p>
          <p>You can now <a href="https://www.godavaii.com/delivery/login" style="color:#FFD43B;text-decoration:underline">login</a>, accept delivery jobs, and start earning.</p>
          <ul>
            <li><b>Name:</b> ${deliveryPartner.name}</li>
            <li><b>Mobile:</b> ${deliveryPartner.mobile}</li>
            <li><b>City/Area:</b> ${deliveryPartner.city}, ${deliveryPartner.area}</li>
          </ul>
          <p>If you have any questions, reach out to our support team any time.</p>
          <br>
          <p>Thank you for joining GoDavaii Delivery!<br/>Let’s deliver smiles together.</p>
          <p style="color:#13C0A2;">Team GoDavaii</p>
        </div>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Delivery partner approval email sent to:", deliveryPartner.email);
    } catch (emailErr) {
      console.error("❌ Failed to send delivery partner approval email:", emailErr);
    }

    res.json({ msg: "Approved" });
  } catch (err) {
    console.error("Approve delivery partner error:", err);
    res.status(500).json({ error: "Approval failed" });
  }
});

/* ============================================================================
   4) Delete/reject a delivery partner (admin)
============================================================================ */
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

/* ============================================================================
   5) Get all approved delivery partners
============================================================================ */
router.get("/partners", async (req, res) => {
  try {
    const all = await DeliveryPartner.find({ status: "approved" });
    res.json(all);
  } catch (err) {
    console.error("Get all partners error:", err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

/* ============================================================================
   6) Set delivery partner active/inactive
   - When going active with lat/lng, seed BOTH timestamps:
     location.lastUpdated AND root lastSeenAt
============================================================================ */
router.patch("/partner/:id/active", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid ID" });

    const { active, lat, lng, autoAccept } = req.body; // desired state + optional location + autoAccept
    const partner = await DeliveryPartner.findById(id);
    if (!partner) return res.status(404).json({ error: "Not found" });

    if (typeof active === "boolean") partner.active = active;
    if (typeof autoAccept === "boolean") partner.autoAccept = autoAccept;

    // Seed/refresh location when switching to active, and set freshness on both fields
    const la = Number(lat);
    const lo = Number(lng);
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      partner.location = {
        type: "Point",
        coordinates: [lo, la],
        lastUpdated: new Date(), // <-- nested freshness
      };
      partner.lastSeenAt = new Date(); // <-- root freshness
    } else if (typeof active === "boolean" && active) {
      // partner turned ON but we didn't get GPS; keep them "fresh" so waves can try them.
      partner.lastSeenAt = new Date();
    }

    await partner.save();
    res.json({ ok: true, active: partner.active, autoAccept: partner.autoAccept });
  } catch (err) {
    console.error("Set partner active error:", err);
    res.status(500).json({ error: "Failed to update active status" });
  }
});

/* ============================================================================
   7) Get one delivery partner's info, current and past orders
============================================================================ */
router.get("/partner/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid ID" });
    const partner = await DeliveryPartner.findById(req.params.id).lean();
    if (!partner) return res.status(404).json({ error: "Not found" });

    const activeOrder = await Order.findOne({
      deliveryPartner: req.params.id,
      status: { $in: ["processing", "out_for_delivery"] },
    }).populate("pharmacy");

    const pastOrders = await Order.find({
      deliveryPartner: req.params.id,
      status: "delivered",
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ partner, activeOrder, pastOrders });
  } catch (err) {
    console.error("Get delivery partner info error:", err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

/* ============================================================================
   8) Assign delivery partner to an order (after pharmacy accepts)
   - Now also: publish SSE offer + send push to device tokens
============================================================================ */
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

    // Publish instant SSE offer
    publishOffer(req.app, deliveryPartnerId, {
      type: "assigned",
      partnerId: deliveryPartnerId,
      orderId: order._id,
      pharmacy: order.pharmacy,
      total: order.total,
      createdAt: order.createdAt,
    });

    // Push notification to device tokens (HTTP v1 or legacy fallback via utils/fcm)
try {
  const partner = await DeliveryPartner.findById(deliveryPartnerId).lean();
  const tokens = (partner?.deviceTokens || []).map(t => t.token).filter(Boolean);
  await sendPush({
    tokens,
    title: "New delivery offer",
    body: `Order ₹${order.total} from ${order.pharmacy?.name || "pharmacy"}`,
    data: { type: "offer", orderId: String(order._id) },
  });
} catch (_) {}

    res.json({ msg: "Delivery partner assigned" });
  } catch (err) {
    console.error("Assign delivery partner error:", err);
    res.status(500).json({ error: "Assignment failed" });
  }
});

/* ============================================================================
   9) Forgot password (request OTP)
============================================================================ */
router.post("/forgot-password", async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ error: "Mobile is required" });

    const delivery = await DeliveryPartner.findOne({ mobile });
    if (!delivery) return res.status(404).json({ error: "Mobile not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // store with expiry (10 minutes)
    const expires = Date.now() + 10 * 60 * 1000;
    otpMap.set(mobile, { otp, expires });

    // IMPORTANT: Must match your DLT template
    try {
  await sendSmsMSG91(mobile, otp);   // FIXED — ONLY OTP ALLOWED
} catch (err) {
  console.error("MSG91 send failed:", err?.response?.data || err.message);
  return res.status(500).json({ error: "Failed to send OTP SMS" });
}

    res.json({ msg: "OTP sent!" });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "OTP send failed" });
  }
});

/* ============================================================================
   10) Reset password
============================================================================ */
router.post("/reset-password", async (req, res) => {
  try {
    const { mobile, otp, newPassword } = req.body;
    const entry = otpMap.get(mobile);

    if (!entry) return res.status(400).json({ error: "OTP not requested" });
    if (entry.expires < Date.now()) {
      otpMap.delete(mobile);
      return res.status(400).json({ error: "OTP expired" });
    }
    if (entry.otp !== otp) return res.status(400).json({ error: "Invalid OTP" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await DeliveryPartner.findOneAndUpdate({ mobile }, { password: hashedPassword });
    otpMap.delete(mobile);
    res.json({ msg: "Password reset successful" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Reset password failed" });
  }
});

/* ============================================================================
   11) Update current location (called by delivery dashboard)
   - Write BOTH: location.lastUpdated + root lastSeenAt
============================================================================ */
router.post("/update-location", async (req, res) => {
  try {
    const { partnerId, orderId, lat, lng } = req.body;
    if (partnerId && !isValidId(partnerId))
      return res.status(400).json({ error: "Invalid partnerId" });
    if (orderId && !isValidId(orderId))
      return res.status(400).json({ error: "Invalid orderId" });

    const la = Number(lat);
    const lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
      return res.status(400).json({ error: "lat/lng must be numbers" });
    }

    await DeliveryPartner.findByIdAndUpdate(partnerId, {
      location: {
        type: "Point",
        coordinates: [lo, la],
        lastUpdated: new Date(), // keep nested freshness
      },
      lastSeenAt: new Date(), // <-- root freshness for easy queries
    });

    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        driverLocation: { lat: la, lng: lo, lastUpdated: new Date() },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Update location error:", err);
    res.status(500).json({ error: "Failed to update location" });
  }
});

/* ============================================================================
   12) Delivery Partner Login (with bcrypt and JWT)
============================================================================ */
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
        mobile: partner.mobile,
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
        active: partner.active,
      },
    });
  } catch (err) {
    console.error("Delivery login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ============================================================================
   13) Accept / Reject / Status for orders (delivery side)
============================================================================ */
router.patch("/orders/:orderId/accept", async (req, res) => {
  try {
    if (!isValidId(req.params.orderId))
      return res.status(400).json({ error: "Invalid orderId" });
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
      at: new Date(),
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
    if (!isValidId(req.params.orderId))
      return res.status(400).json({ error: "Invalid orderId" });
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
      at: new Date(),
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
    if (!isValidId(req.params.orderId))
      return res.status(400).json({ error: "Invalid orderId" });
    const { orderId } = req.params;
    const { status } = req.body;
    const order = await Order.findById(orderId).populate("pharmacy").populate("userId");
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.deliveryPartner) return res.status(400).json({ error: "No delivery partner assigned" });

    order.status = status;
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      deliveryPartner: order.deliveryPartner,
      status: status,
      at: new Date(),
    });
    await order.save();

    // Mark Payment as PAID for COD orders when delivered
    if (status === "delivered" && (order.paymentMethod === "cod" || order.paymentMethod === "cash")) {
      await Payment.updateOne({ orderId: order._id }, { status: "paid" });
    }

    // On delivered: fire-and-forget invoice + email
    if (status === "delivered") {
      try {
        require("../controllers/orderController").markOrderDelivered(
          { params: { id: orderId } },
          { json: () => {}, status: () => ({ json: () => {} }) }
        );
        console.log("🧾 Invoice generation/upload triggered for order", orderId);
      } catch (invErr) {
        console.error("❌ Failed to trigger invoice generation/upload:", invErr);
      }

      // Email to customer
      try {
        const user = order.userId;
        const orderItems = order.items
          .map(
            (item) => `
              <tr>
                <td style="padding: 8px 0;">${item.name} <span style="color:#777;font-size:13px">x${item.quantity}</span></td>
                <td style="text-align:right;padding: 8px 0;">₹${item.price * item.quantity}</td>
              </tr>`
          )
          .join("");

        const transporter = require("nodemailer").createTransport({
          host: "smtp.hostinger.com",
          port: 465,
          secure: true,
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

        await transporter.sendMail({
          from: `"GoDavaii" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: `Your GoDavaii Order #${order._id} Delivered!`,
          html: `
            <div style="font-family:Roboto,sans-serif;background:#F9FAFB;padding:26px 16px 18px 16px;border-radius:11px;max-width:480px;margin:auto;">
              <div style="text-align:center">
                <img src="https://www.godavaii.com/logo192.png" alt="GoDavaii" width="60" style="margin-bottom:10px"/>
                <h2 style="color:#13C0A2;margin:0 0 10px 0;">Order Delivered 🏍️</h2>
              </div>
              <p>Hi <b>${user.name || "Customer"}</b>,</p>
              <p>Your GoDavaii order <b>#${order._id}</b> has been <span style="color:#13C0A2">delivered</span> successfully! Thank you for trusting us with your health needs.</p>
              <div style="background:#fff;border-radius:6px;padding:15px 18px;margin:20px 0 12px 0;box-shadow:0 2px 8px rgba(0,0,0,0.03);">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:16px;">
                  <thead>
                    <tr><th align="left" style="color:#13C0A2;font-size:16px;padding-bottom:10px">Medicine</th>
                    <th align="right" style="color:#13C0A2;font-size:16px;padding-bottom:10px">Price</th></tr>
                  </thead>
                  <tbody>
                    ${orderItems}
                    <tr><td style="border-top:1px solid #eaeaea;padding-top:8px;font-weight:700">Total</td>
                    <td style="border-top:1px solid #eaeaea;padding-top:8px;text-align:right;font-weight:700">₹${order.total}</td></tr>
                  </tbody>
                </table>
              </div>
              <p style="margin:16px 0 6px 0;">We hope you’re satisfied with your purchase.<br>
              <b>Feeling better already? Place your next order on GoDavaii for more savings and a seamless experience!</b></p>
              <a href="https://www.godavaii.com/" style="display:inline-block;margin-top:10px;background:#13C0A2;color:#fff;font-weight:700;text-decoration:none;padding:10px 24px;border-radius:6px;letter-spacing:0.5px;">Order Again &rarr;</a>
              <p style="margin-top:22px;font-size:14px;color:#777;text-align:center">
                For queries or feedback, reply to this email.<br>Wishing you good health!<br>
                <span style="color:#13C0A2;">GoDavaii Customer Support</span>
              </p>
            </div>
          `,
        });
        console.log("✅ Order delivered email sent to:", user.email);
      } catch (emailErr) {
        console.error("❌ Failed to send delivered email:", emailErr);
      }
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error("Update order status error:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

/* ============================================================================
   14) Get assigned orders for logged-in delivery partner
============================================================================ */
router.get("/orders", async (req, res) => {
  const deliveryPartnerId =
    req.headers["deliverypartnerid"] || req.query.deliveryPartnerId;
  if (!deliveryPartnerId || !isValidId(deliveryPartnerId))
    return res.status(400).json({ error: "Invalid deliveryPartnerId" });
  try {
    const orders = await Order.find({
      deliveryPartner: deliveryPartnerId,
      status: { $in: ["assigned", "accepted", "out_for_delivery"] },
    }).populate("pharmacy");

    // PATCH: Add .lat/.lng for pharmacy.location (for dashboard/frontend)
    const patchedOrders = orders.map((order) => {
      if (
        order.pharmacy &&
        order.pharmacy.location &&
        Array.isArray(order.pharmacy.location.coordinates) &&
        order.pharmacy.location.coordinates.length === 2
      ) {
        const [lng, lat] = order.pharmacy.location.coordinates;
        order.pharmacy.location.lat = lat;
        order.pharmacy.location.lng = lng;
      }
      return order;
    });

    res.json(patchedOrders);
  } catch (err) {
    console.error("Get assigned orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

/* ============================================================================
   15) Check if at least one delivery partner is active in city
   - Freshness via OR on lastSeenAt OR location.lastUpdated
============================================================================ */
router.get("/active-partner-in-city", async (req, res) => {
  try {
    const city = req.query.city;
    if (!city) return res.status(400).json({ error: "city required" });

    const freshSince = new Date(Date.now() - 15 * 60 * 1000);
    const active = await DeliveryPartner.findOne({
      city: new RegExp(city, "i"),
      active: true,
      status: "approved",
      $or: [
        { lastSeenAt: { $gte: freshSince } },
        { "location.lastUpdated": { $gte: freshSince } },
      ],
    });

    res.json({ activePartnerExists: !!active });
  } catch (err) {
    console.error("active-partner-in-city error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================================
   16) Find an active partner nearby a given lat/lng
   - Freshness via OR on lastSeenAt OR location.lastUpdated
   - Radius up to 8km (tunable)
============================================================================ */
router.get("/active-partner-nearby", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.json({ activePartnerExists: false });
  }

  try {
    const MAX_DISTANCE_M = 8000; // 8 km
    const freshSince = new Date(Date.now() - 15 * 60 * 1000);

    const partner = await DeliveryPartner.findOne({
      status: "approved",
      active: true,
      $or: [
        { lastSeenAt: { $gte: freshSince } },
        { "location.lastUpdated": { $gte: freshSince } },
      ],
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          $maxDistance: MAX_DISTANCE_M,
        },
      },
    }).lean();

    res.json({ activePartnerExists: !!partner });
  } catch (err) {
    console.error("active-partner-nearby error:", err);
    res.json({ activePartnerExists: false });
  }
});

/* -------------------------- Cron endpoint (nudge) --------------------------- */
// POST /api/delivery/cron/nudge-stale-loc
router.post("/cron/nudge-stale-loc", async (req, res) => {
  try {
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000); // 2 min
    const partners = await DeliveryPartner.find({
      status: "approved",
      active: true,
      $or: [
        { lastSeenAt: { $lt: staleBefore } },
        { lastSeenAt: { $exists: false } },
        { "location.lastUpdated": { $lt: staleBefore } },
        { "location.lastUpdated": { $exists: false } },
      ],
    }).lean();

    let notified = 0;
    for (const p of partners) {
      const tokens = (p.deviceTokens || []).map(t => t.token).filter(Boolean);
      if (!tokens.length) continue;
      try {
        await sendPush({
          tokens,
          title: "Location paused",
          body: "Open GoDavaii to resume live location.",
          data: { type: "open_for_location", partnerId: String(p._id) },
        });
        notified++;
      } catch {}
    }
    res.json({ ok: true, notified });
  } catch (e) {
    console.error("nudge-stale-loc error:", e);
    res.status(500).json({ error: "cron failed" });
  }
});

/* ===================== 17) Server-Sent Events for instant offers ===================== */
router.get("/stream/:partnerId", async (req, res) => {
  const { partnerId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(partnerId)) return res.sendStatus(400);

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const ping = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 15000);

  // naive in-memory pubsub (replace with Redis in prod)
  const bus = req.app.get("gd_bus") || new Map();
  req.app.set("gd_bus", bus);

  function onOffer(payload) {
    if (payload.partnerId?.toString() === partnerId) {
      res.write(`event: offer\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  }
  const key = `offer:${partnerId}`;
  const subs = bus.get(key) || new Set();
  subs.add(onOffer);
  bus.set(key, subs);

  req.on("close", () => {
    clearInterval(ping);
    const s = bus.get(key);
    if (s) {
      s.delete(onOffer);
      if (!s.size) bus.delete(key);
    }
  });
});

/* helper to publish offers into SSE stream */
function publishOffer(app, partnerId, payload) {
  const bus = app.get("gd_bus");
  if (!bus) return;
  const subs = bus.get(`offer:${partnerId}`);
  if (subs) subs.forEach((fn) => fn(payload));
}

/* ===================== 18) Save device token for push ===================== */
router.post("/register-device-token", async (req, res) => {
  try {
    const { partnerId, token, platform } = req.body;
    if (!isValidId(partnerId) || !token) return res.status(400).json({ error: "Bad payload" });
    await DeliveryPartner.updateOne(
      { _id: partnerId },
      { $addToSet: { deviceTokens: { token, platform: platform || "android" } } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("register-device-token error:", err);
    res.status(500).json({ error: "Failed to register device token" });
  }
});

module.exports = router;
