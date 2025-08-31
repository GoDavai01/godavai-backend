// routes/auth.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { sendSmsMSG91 } = require("../utils/sms"); // <-- IMPORT your real MSG91 sender
const nodemailer = require("nodemailer"); // <--- Added for email OTP

const isEmail = (str) => /\S+@\S+\.\S+/.test(str);
const OTP_EXPIRY = 10 * 60 * 1000; // 10 minutes

// --- SEND OTP VIA MSG91 (production) or log (dev) ---
async function sendOtpMsg91(mobile, otp) {
  const message = `Your GoDavaii OTP is ${otp}.`;
  await sendSmsMSG91(mobile, message);
  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV] OTP for ${mobile}: ${otp}`);
  }
}

async function sendOtpEmail(email, otp) {
  // Nodemailer production-ready implementation
  const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465, // or 587 if TLS
  secure: true, // true for 465, false for 587
  auth: {
    user: process.env.EMAIL_USER, // info@godavaii.com
    pass: process.env.EMAIL_PASS, // actual password for that mailbox
  },
});

  const mailOptions = {
    from: `"GoDavaii" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "GoDavaii Login OTP",
    html: `
      <div style="font-family:sans-serif">
        <h2>Your GoDavaii OTP</h2>
        <p style="font-size:22px;letter-spacing:4px"><b>${otp}</b></p>
        <p>This OTP is valid for 10 minutes.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);

  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV] OTP for ${email}: ${otp}`);
  }
}

// ===== SEND OTP =====
router.post("/send-otp", async (req, res) => {
  try {
    let { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: "Mobile or Email is required." });
    identifier = (identifier + "").trim();

    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    let user;
    if (isEmail(identifier)) {
      user = await User.findOne({ email: identifier.toLowerCase() });
      if (!user) user = new User({ email: identifier, name: "New User" });
    } else {
      user = await User.findOne({ mobile: identifier });
      if (!user) user = new User({ mobile: identifier, name: "New User" });
    }
    user.otp = otpHash;
    user.otpExpiry = new Date(Date.now() + OTP_EXPIRY);
    await user.save();

    if (isEmail(identifier)) {
      await sendOtpEmail(identifier, otp);
    } else {
      await sendOtpMsg91(identifier, otp);
    }
    // Do not send OTP in response in production!
    res.json({ success: true, message: "OTP sent!" });
  } catch (err) {
    console.error("Send OTP error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ===== VERIFY OTP (SINGLE ROUTE ONLY) =====
router.post("/verify-otp", async (req, res) => {
  try {
    let { identifier, otp } = req.body;
    if (!identifier || !otp)
      return res.status(400).json({ error: "All fields required." });
    identifier = (identifier + "").trim();

    let user = await User.findOne({
      $or: [{ mobile: identifier }, { email: identifier.toLowerCase() }],
    });
    if (!user || !user.otp || !user.otpExpiry)
      return res.status(400).json({ error: "OTP not found." });

    if (user.otpExpiry < new Date())
      return res.status(400).json({ error: "OTP expired. Please request again." });

    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpHash !== user.otp)
      return res.status(400).json({ error: "Invalid OTP." });

    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    const token = jwt.sign(
      { userId: user._id, mobile: user.mobile, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        mobile: user.mobile,
        email: user.email,
        name: user.name,
        dob: user.dob,
        avatar: user.avatar
      },
    });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

module.exports = router;
