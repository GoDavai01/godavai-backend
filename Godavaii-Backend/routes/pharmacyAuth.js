// routes/pharmacyAuth.js
const express = require("express");
const router = express.Router();
const Pharmacy = require("../models/Pharmacy");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { sendSmsMSG91 } = require("../utils/sms");

const OTP_EXPIRY = 2 * 60 * 1000; // 2 minutes
const nodemailer = require("nodemailer"); // Add to top if not present

// --- 1. SEND OTP (after PIN check) ---
router.post("/send-otp", async (req, res) => {
  try {
    const { contact, pin } = req.body;
    if (!contact || !pin)
      return res.status(400).json({ message: "Mobile/email and PIN required." });

    // Determine if email or mobile
    const isEmail = contact.includes("@");
    let pharmacy;
    if (isEmail) {
      pharmacy = await Pharmacy.findOne({ email: new RegExp(`^${contact}$`, "i") });
    } else {
      pharmacy = await Pharmacy.findOne({ contact });
    }
    if (!pharmacy)
      return res.status(404).json({ message: "Pharmacy not found for this " + (isEmail ? "email." : "mobile.") });

    if (pharmacy.status !== "approved") {
      return res.status(403).json({ message: "Registration pending. Please wait for admin approval." });
    }

    // Hash the incoming PIN and check
    const pinHash = crypto.createHash("sha256").update(pin).digest("hex");
    if (pinHash !== pharmacy.pin) {
      return res.status(401).json({ message: "Invalid PIN." });
    }

    // Generate and store OTP
    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    pharmacy.otp = otpHash;
    pharmacy.otpExpiry = new Date(Date.now() + OTP_EXPIRY);
    await pharmacy.save();

    if (isEmail) {
      // Send OTP via email using nodemailer
      const transporter = nodemailer.createTransport({
        host: "smtp.hostinger.com", // update if needed
        port: 465,
        secure: true,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from: `"GoDavaii" <${process.env.EMAIL_USER}>`,
        to: pharmacy.email,
        subject: "GoDavaii Pharmacy OTP",
        html: `<div>
                <h3>Your GoDavaii Pharmacy OTP is:</h3>
                <div style="font-size:2rem;font-weight:bold;letter-spacing:5px;">${otp}</div>
                <p>This OTP will expire in 2 minutes.</p>
              </div>`,
      });

      return res.json({ success: true, message: "OTP sent to registered email address." });
    } else {
      // Send OTP via MSG91 SMS
      await sendSmsMSG91(contact, `Your GoDavaii Pharmacy OTP is: ${otp}`);
      return res.json({ success: true, message: "OTP sent to registered mobile number." });
    }
  } catch (err) {
    console.error("Pharmacy send-otp error:", err);
    res.status(500).json({ message: err.message || "Could not send OTP." });
  }
});

// --- 2. VERIFY OTP ---
router.post("/verify-otp", async (req, res) => {
  try {
    const { contact, otp } = req.body;
    if (!contact || !otp)
      return res.status(400).json({ message: "Contact and OTP required." });

    // Detect email or mobile
    const isEmail = contact.includes("@");
    let pharmacy;
    if (isEmail) {
      pharmacy = await Pharmacy.findOne({ email: new RegExp(`^${contact}$`, "i") });
    } else {
      pharmacy = await Pharmacy.findOne({ contact });
    }
    if (!pharmacy || !pharmacy.otp || !pharmacy.otpExpiry)
      return res.status(400).json({ message: "OTP not found. Please request again." });

    if (pharmacy.otpExpiry < new Date())
      return res.status(400).json({ message: "OTP expired. Please request again." });

    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpHash !== pharmacy.otp)
      return res.status(400).json({ message: "Invalid OTP." });

    // OTP correct: clear OTP fields
    pharmacy.otp = undefined;
    pharmacy.otpExpiry = undefined;
    await pharmacy.save();

    // JWT token
    const token = jwt.sign(
      { pharmacyId: pharmacy._id, type: "pharmacy" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    res.json({ token, pharmacy });
  } catch (err) {
    console.error("Pharmacy verify-otp error:", err);
    res.status(500).json({ message: err.message || "Could not verify OTP." });
  }
});

module.exports = router;
