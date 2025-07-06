// routes/pharmacyAuth.js
const express = require("express");
const router = express.Router();
const Pharmacy = require("../models/Pharmacy");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { sendSmsMSG91 } = require("../utils/sms");

const OTP_EXPIRY = 2 * 60 * 1000; // 2 minutes

// --- 1. SEND OTP (after PIN check) ---
router.post("/send-otp", async (req, res) => {
  try {
    const { contact, pin } = req.body;
    if (!contact || !pin) return res.status(400).json({ message: "Mobile and PIN required." });

    const pharmacy = await Pharmacy.findOne({ contact });
    if (!pharmacy)
      return res.status(404).json({ message: "Pharmacy not found for this number." });

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

    // === PRODUCTION: SEND OTP VIA SMS ONLY ===
    await sendSmsMSG91(contact, `Your GoDavai Pharmacy OTP is: ${otp}`);

    res.json({ success: true, message: "OTP sent to registered mobile number." });
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

    const pharmacy = await Pharmacy.findOne({ contact });
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
