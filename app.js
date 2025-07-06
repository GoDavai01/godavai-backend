// app.js
require('dotenv').config();

// REMOVE or COMMENT OUT debug logs in production
// console.log('SERVER STARTED, ENV:', process.env.NODE_ENV, 'PORT:', process.env.PORT);

const express = require("express");
const axios = require('axios');
const MSG91_AUTHKEY = process.env.MSG91_AUTHKEY;
const app = express();
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { createCanvas } = require("canvas");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
// const twilio = require("twilio"); // Uncomment for real SMS

// Models & Middleware
const auth = require("./middleware/auth");
const User = require("./models/User");
const Medicine = require("./models/Medicine");
const Pharmacy = require("./models/Pharmacy");
const Order = require("./models/Order");
const Offer = require("./models/Offer");
const Admin = require("./models/Admin");
const deliveryRoutes = require('./routes/deliveryRoutes');
const generateMedicineDescription = require("./utils/generateDescription");
const { notifyUser, saveInAppNotification } = require("./utils/notify");
const { sendSmsMSG91 } = require("./utils/sms");
const passwordResetTokens = {};
const userRoutes = require('./routes/users');
const ordersRouter = require('./routes/orders');
const { createPaymentRecord } = require('./controllers/paymentsController');

// --- For Password Reset ---
function randomOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Core config
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Upload folders
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
const PRESC_DIR = path.join(__dirname, "uploads", "prescriptions");
if (!fs.existsSync(PRESC_DIR)) fs.mkdirSync(PRESC_DIR, { recursive: true });

// Static assets (for serving uploaded files)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes (leave unchanged - already modular and clean)
app.use("/api/pharmacy", require("./routes/pharmacies"));
app.use("/api/pharmacies", require("./routes/pharmacies"));
app.use("/api/medicines", require("./routes/medicines"));
app.use("/api/orders", require("./routes/orders"));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use("/api/users", require("./routes/users"));
app.use("/api/delivery", require("./routes/deliveryRoutes"));
app.use("/api/prescriptions", require("./routes/prescriptions"));
app.use("/api", require("./routes/search"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/support-chat", require("./routes/supportChat"));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/orders', ordersRouter);
app.use("/api/allorders", require("./routes/allorders"));
app.use("/api/pharmacy", require("./routes/pharmacyAuth"));

// ============= GLOBAL LOGGER (DISABLE/REDUCE IN PRODUCTION) =============
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log("INCOMING REQUEST:", req.method, req.originalUrl);
    next();
  });
}

// -------- PHARMACY ORDERS FOR DASHBOARD --------
app.get("/api/pharmacy/orders", auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
    const pharmacy = await Pharmacy.findById(req.user.pharmacyId);
    if (!pharmacy) return res.status(403).json({ message: "Invalid pharmacy" });
    const orders = await Order.find({ pharmacy: pharmacy._id });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch pharmacy orders", error: err.message });
  }
});

// -------- Multer & File Upload for Pharmacy Registration --------
const pharmacyDocsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const key = req.body?.email || req.body?.contact || "unknown";
    const folder = path.join(UPLOADS_DIR, "pharmacies", key.replace(/[^a-zA-Z0-9@.]/g, "_"));
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const safeName = Date.now() + "-" + file.originalname.replace(/\s/g, "_");
    cb(null, safeName);
  }
});
const allowedMimeTypes = ["image/jpeg", "image/png", "application/pdf"];
const pharmacyDocsUpload = multer({
  storage: pharmacyDocsStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, and PDF files allowed!"));
    }
    cb(null, true);
  }
}).fields([
  { name: "qualificationCert", maxCount: 1 },
  { name: "councilCert", maxCount: 1 },
  { name: "retailLicense", maxCount: 1 },
  { name: "wholesaleLicense", maxCount: 1 },
  { name: "gstCert", maxCount: 1 },
  { name: "shopEstablishmentCert", maxCount: 1 },
  { name: "tradeLicense", maxCount: 1 },
  { name: "identityProof", maxCount: 1 },
  { name: "addressProof", maxCount: 1 },
  { name: "photo", maxCount: 1 },
  { name: "digitalSignature", maxCount: 1 }
]);
app.use("/uploads", express.static(UPLOADS_DIR));

// ========== PHARMACY REGISTRATION (Multer comes BEFORE body parser!) ==========
app.post("/api/pharmacy/register", (req, res) => {
  let raw = "";
  req.on("data", chunk => { raw += chunk });
  req.on("end", () => {});

  pharmacyDocsUpload(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: "Upload error: " + err.message });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    if (!req.body || !req.body.pharmacyTimings) {
      return res.status(400).json({ message: "pharmacyTimings is required in form-data" });
    }
    let timings;
    try {
      timings = JSON.parse(req.body.pharmacyTimings);
    } catch (e) {
      return res.status(400).json({ message: "pharmacyTimings must be a valid JSON string" });
    }
    const {
      name, ownerName, city, area, address, contact, email, password,
      qualification, stateCouncilReg, drugLicenseRetail, drugLicenseWholesale,
      gstin, bankAccount, ifsc, bankName, accountHolder,
      businessContact, businessContactName, emergencyContact, declarationAccepted
    } = req.body;

    if (!timings || typeof timings !== "object" ||
      (timings.is24Hours !== true && (!timings.open || !timings.close))
    ) {
      return res.status(400).json({ message: "Invalid or missing timings" });
    }
    if (!name || !ownerName || !city || !area || !address || !contact || !email || !password ||
      !qualification || !stateCouncilReg || !drugLicenseRetail || !gstin ||
      !bankAccount || !ifsc || !declarationAccepted
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const hashed = await bcrypt.hash(password, 10);
    function filePath(field) {
      return req.files && req.files[field] ? req.files[field][0].path.replace(/\\/g, "/") : undefined;
    }
    try {
      // --- PIN VALIDATION LOGIC ---
const { pin, contact } = req.body;
if (!/^\d{4}$/.test(pin)) {
  return res.status(400).json({ message: "PIN must be 4 digits." });
}
if (pin === contact.substring(0, 4)) {
  return res.status(400).json({ message: "PIN cannot be first 4 digits of mobile." });
}
const pinHash = crypto.createHash("sha256").update(pin).digest("hex");
const existingPin = await Pharmacy.findOne({ pin: pinHash });
if (existingPin) {
  return res.status(409).json({ message: "PIN already in use. Choose another." });
}

      const pharmacy = new Pharmacy({
        name, ownerName, city, area, address, contact, email, password: hashed,pin: pinHash,
        qualification, stateCouncilReg, drugLicenseRetail, drugLicenseWholesale,
        gstin, bankAccount, ifsc, bankName, accountHolder,
        businessContact, businessContactName, emergencyContact,
        declarationAccepted: declarationAccepted === "true" || declarationAccepted === true,
        pharmacyTimings: timings,
        qualificationCert: filePath("qualificationCert"),
        councilCert: filePath("councilCert"),
        retailLicense: filePath("retailLicense"),
        wholesaleLicense: filePath("wholesaleLicense"),
        gstCert: filePath("gstCert"),
        shopEstablishmentCert: filePath("shopEstablishmentCert"),
        tradeLicense: filePath("tradeLicense"),
        identityProof: filePath("identityProof"),
        addressProof: filePath("addressProof"),
        photo: filePath("photo"),
        digitalSignature: filePath("digitalSignature"),
      });
      await pharmacy.save();
      res.status(201).json({ message: "Pharmacy registration submitted! Await admin approval." });
    } catch (err) {
      res.status(500).json({ message: "Registration failed", error: err.message });
    }
  });
});

// ============ ADMIN REGISTRATION (SECURE) ============
app.post("/api/admin/register", async (req, res) => {
  // Accepts: { name, email, password, code }
  const { name, email, password, code } = req.body;
  // For debugging: log received body
  console.log('Admin register BODY:', req.body, 'ENV CODE:', process.env.ADMIN_REGISTER_CODE);

  if (!name || !email || !password || !code) {
    return res.status(400).json({ message: "All fields required" });
  }

  // Allow only one admin (first-time setup), OR comment this if you want to allow multiple admins
  // const already = await Admin.findOne({});
  // if (already) return res.status(403).json({ message: "Admin already exists" });

  if (code !== process.env.ADMIN_REGISTER_CODE && code !== "REMOVED_SECRET") {
    // Accept "REMOVED_SECRET" or the code in your .env
    return res.status(403).json({ message: "Invalid registration code" });
  }

  // Prevent duplicate admins by email
  const existing = await Admin.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: "Admin already exists" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const admin = new Admin({ name, email, password: hashed });
  await admin.save();
  res.status(201).json({ message: "Admin registered" });
});

// ============ ADMIN LOGIN ============
// POST /api/admin/login { email, password }
app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    const admin = await Admin.findOne({ email });
    if (!admin)
      return res.status(401).json({ message: "Admin not found" });

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok)
      return res.status(401).json({ message: "Invalid password" });

    // --- IMPORTANT: type: "admin" so dashboard works! ---
    const token = jwt.sign(
      { adminId: admin._id, type: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    res.json({ token });
  } catch (err) {
    res.status(500).json({ message: "Admin login failed", error: err.message });
  }
});
// ======= ADMIN DASHBOARD STATS =======
// GET /api/admin/stats (admin only)
app.get("/api/admin/stats", async (req, res) => {
  try {
    // Optionally: Add authentication middleware for security!
    const orders = await Order.countDocuments();
    const users = await User.countDocuments();
    const pharmacies = await Pharmacy.countDocuments();
    res.json({ orders, users, pharmacies });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});

// ======= ADMIN PENDING PHARMACIES =======
// GET /api/admin/pending-pharmacies (admin only)
app.get("/api/admin/pending-pharmacies", async (req, res) => {
  try {
    // Only show pharmacies that are not yet approved
    const pending = await Pharmacy.find({ status: { $ne: "approved" } });
    res.json(pending);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch pending pharmacies" });
  }
});
// ======= ADMIN APPROVE PHARMACY =======
// POST /api/admin/approve-pharmacy
app.post("/api/admin/approve-pharmacy", async (req, res) => {
  try {
    const { pharmacyId } = req.body;
    if (!pharmacyId) return res.status(400).json({ message: "pharmacyId required" });
    // Update the pharmacy to "approved"
    await Pharmacy.findByIdAndUpdate(pharmacyId, { status: "approved", approved: true });
    res.json({ message: "Pharmacy approved!" });
  } catch (err) {
    res.status(500).json({ message: "Could not approve pharmacy" });
  }
});

// --- Admin: Get all pharmacies ---
app.get("/api/admin/pharmacies", async (req, res) => {
  try {
    const list = await Pharmacy.find();
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch pharmacies" });
  }
});

// --- Admin: Remove pharmacy (with all its medicines) ---
app.delete("/api/admin/pharmacy/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await Medicine.deleteMany({ pharmacy: id });
    await Pharmacy.findByIdAndDelete(id);
    res.json({ message: "Pharmacy removed" });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove pharmacy" });
  }
});

// --- Admin: Get all medicines for a pharmacy ---
app.get("/api/admin/pharmacy/:id/medicines", async (req, res) => {
  try {
    const list = await Medicine.find({ pharmacy: req.params.id });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch medicines" });
  }
});

// --- Admin: Remove a medicine ---
app.delete("/api/admin/medicine/:id", async (req, res) => {
  try {
    await Medicine.findByIdAndDelete(req.params.id);
    res.json({ message: "Medicine removed" });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove medicine" });
  }
});

// --- Admin: Send notification to all users or all pharmacies ---
app.post("/api/admin/notify", async (req, res) => {
  try {
    // req.body: { title, message, to: "users"|"pharmacies" }
    const { title, message, to } = req.body;
    // Dummy implementation; integrate OneSignal if needed.
    // Send via notifyUser function or OneSignal API
    // e.g., notifyUser(userId, title, message, url)
    res.json({ message: "Notification sent (demo only, hook up OneSignal API here)" });
  } catch (err) {
    res.status(500).json({ message: "Failed to send notification" });
  }
});


// -------------- AI-STYLE IMAGE GENERATION ---------------
async function generateMedicineImage(medicineName) {
  const width = 256, height = 320;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = "#F3FAFF";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#007a8a";
  ctx.fillRect(76, 60, 100, 200);
  ctx.fillStyle = "#FFD43B";
  ctx.fillRect(76, 120, 100, 70);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = "#222";
  ctx.textAlign = "center";
  ctx.fillText(medicineName, width / 2, 160, 90);

  const fileName = medicineName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + "_" + Date.now() + ".png";
  const outPath = path.join(__dirname, "uploads", fileName);
  const out = fs.createWriteStream(outPath);
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  await new Promise(res => out.on('finish', res));
  return "/uploads/" + fileName;
}

// ========== PHARMACY MEDICINE IMAGE UPLOAD ENDPOINTS ==========

const medicineImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const folder = path.join(UPLOADS_DIR, "medicines");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = req.body.name ? req.body.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : "medicine";
    cb(null, name + "_" + Date.now() + ext);
  }
});
const medicineImageUpload = multer({
  storage: medicineImageStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, or WEBP allowed"));
    }
    cb(null, true);
  }
});

app.get("/api/pharmacy/medicines", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  const medicines = await Medicine.find({ pharmacy: req.user.pharmacyId });
  res.json(medicines);
});

app.post("/api/pharmacy/medicines", auth, medicineImageUpload.single("image"), async (req, res) => {
  try {
    let img;
    if (req.file) {
      img = "/uploads/medicines/" + req.file.filename;
    } else {
      try {
        img = await generateMedicineImage(req.body.name || "Medicine");
      } catch {
        img = "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg";
      }
    }

    const { name, price, mrp, stock, category, brand } = req.body;
    if (!name || !price || !mrp || !stock) {
      return res.status(400).json({ message: "Name, price, MRP, and stock are required" });
    }

    const discount = Math.max(0, Math.round(((mrp - price) / mrp) * 100));

    let description = "";
    try {
      description = await generateMedicineDescription(name);
      console.log("✅ OpenAI Description:", description);
    } catch (err) {
      console.error("❌ OpenAI Description Error:", err.message);
    }

    const medicine = new Medicine({
      name,
      brand,
      price,
      mrp,
      stock,
      discount,
      img,
      pharmacy: req.user.pharmacyId,
      category: category || "Miscellaneous",
      description: description || "No description available."
    });

    await medicine.save();
    res.status(201).json({ message: "Medicine added!", medicine });
  } catch (err) {
    console.error("❌ Add medicine error:", err.message);
    res.status(500).json({ message: "Failed to add medicine", error: err.message });
  }
});


app.patch("/api/pharmacy/medicines/:id", auth, async (req, res) => {
  if (!req.user.pharmacyId)
    return res.status(403).json({ message: "Not authorized" });

  const { name, price, stock, category, brand } = req.body;

  if (!name || !price || !stock) {
    return res.status(400).json({ message: "Name, price, stock required" });
  }

  // Optional fallback for missing description
  let description = req.body.description;
  if (!description && name) {
    description = await generateMedicineDescription(name);
  }

  const med = await Medicine.findOneAndUpdate(
    { _id: req.params.id, pharmacy: req.user.pharmacyId },
    {
      name,
      brand,
      price,
      stock,
      ...(category && { category }),
      ...(description && { description })
    },
    { new: true }
  );

  if (!med) return res.status(404).json({ message: "Medicine not found" });
  res.json(med);
});
app.delete("/api/pharmacy/medicines/:id", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  await Medicine.deleteOne({ _id: req.params.id, pharmacy: req.user.pharmacyId });
  res.json({ message: "Medicine deleted" });
});

// ================= USER AUTH APIs =================
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, mobile, password } = req.body;
    if (!name || !password || (!email && !mobile)) {
      return res.status(400).json({ message: "Name, password, and either email or mobile required" });
    }
    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) return res.status(409).json({ message: "Email already registered" });
    }
    if (mobile) {
      const existingMobile = await User.findOne({ mobile });
      if (existingMobile) return res.status(409).json({ message: "Mobile already registered" });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, mobile, password: hashed });
    await user.save();
    res.status(201).json({ message: "Registered" });
  } catch (err) {
    res.status(500).json({ message: "Registration failed", error: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { emailOrMobile, password } = req.body;
    console.log('Login attempt:', emailOrMobile, password); // <-- ADD THIS
    const user = await User.findOne({
      $or: [
        { email: emailOrMobile.toLowerCase() },
        { mobile: emailOrMobile }
      ]
    });
    console.log('User found:', user); // <-- ADD THIS
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.password);
    console.log('Password match:', ok); // <-- ADD THIS
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });
    const token = jwt.sign(
      { userId: user._id, name: user.name, email: user.email, mobile: user.mobile },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    res.json({
      token,
      user: { name: user.name, email: user.email, mobile: user.mobile, _id: user._id }
    });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

app.get("/api/profile", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

app.post("/api/pharmacy/login", async (req, res) => {
  const { email, password } = req.body;

  const pharmacy = await Pharmacy.findOne({
    $or: [
      { email: email },
      { contact: email }
    ]
  });
  if (!pharmacy) return res.status(401).json({ message: "Pharmacy not found" });

  if (pharmacy.status !== "approved") {
    return res.status(403).json({ message: "Pharmacy not approved" });
  }

  const ok = await bcrypt.compare(password, pharmacy.password);
  if (!ok) return res.status(401).json({ message: "Invalid password" });

  const token = jwt.sign(
    { pharmacyId: pharmacy._id, type: "pharmacy" },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
  res.json({ token, pharmacy });
});

app.get("/api/pharmacy/orders", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  const pharmacy = await Pharmacy.findById(req.user.pharmacyId);
  if (!pharmacy) return res.status(403).json({ message: "Invalid pharmacy" });
  const orders = await Order.find({ pharmacy: pharmacy._id });
  res.json(orders);
});

app.patch("/api/pharmacy/orders/:orderId", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  const order = await Order.findById(req.params.orderId);
  if (!order) return res.status(404).json({ message: "Order not found" });
  const { dosage, note, status } = req.body;

  if (dosage) order.dosage = dosage;
  if (note) order.note = note;
  if (typeof status !== "undefined") order.status = status;
  await order.save();

  // Notify user if QUOTED
  // Adjust this line as per your actual "quoted" status (could be string "quoted" or a number, eg. 2)
  if (
    (typeof status === "string" && status.toLowerCase() === "quoted") ||
    status === 2 // if you use a numeric code for quoted
  ) {
    await notifyUser(
      order.userId.toString(),
      "Prescription Quote Ready",
      "A pharmacy has submitted a quote for your prescription! Tap to view details.",
      `${process.env.FRONTEND_URL || "http://localhost:3000"}/my-prescriptions`
    );
    await saveInAppNotification({
      userId: order.userId.toString(),
      title: "Prescription Quote Ready",
      message: "A pharmacy has submitted a quote for your prescription."
    });
  } else if (dosage || note) {
    await notifyUser(
      order.userId.toString(),
      "Order Updated by Pharmacy",
      "Check your order for new dosage/note.",
      `${process.env.FRONTEND_URL || "http://localhost:3000"}/order/${order._id}`
    );
  }
  res.json(order);
});


app.post("/api/admin/pharmacy/approve", auth, async (req, res) => {
  if (!req.user.type || req.user.type !== "admin") return res.status(403).json({ message: "Not authorized" });
  const { pharmacyId } = req.body;
  await Pharmacy.findByIdAndUpdate(pharmacyId, { approved: true });
  res.json({ message: "Pharmacy approved" });
});

app.post("/api/admin/offer", auth, async (req, res) => {
  if (!req.user.type || req.user.type !== "admin") return res.status(403).json({ message: "Not authorized" });
  const offer = new Offer(req.body);
  await offer.save();
  res.json(offer);
});

app.get("/api/pharmacies", async (req, res) => {
  try {
    const { city, area, location, trending } = req.query;
    let filter = { active: true }; // <<-- Add this!
    if (city) filter.city = new RegExp(city, "i");
    if (area) filter.area = new RegExp(area, "i");
    if (location) {
      filter.$or = [
        { city: new RegExp(location, "i") },
        { area: new RegExp(location, "i") }
      ];
    }
    if (trending === "1" || trending === "true") filter.trending = true;
    const pharmacies = await Pharmacy.find(filter);
    res.json(pharmacies);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch pharmacies" });
  }
});

app.get("/api/medicines", async (req, res) => {
  try {
    const { pharmacyId, trending, city, area, location } = req.query;
    let pharmacyFilter = {};

    // If a pharmacyId is given, just filter by it (used on pharmacy page)
    if (pharmacyId) {
      pharmacyFilter._id = pharmacyId;
    } else {
      // Otherwise filter by city/area if provided
      if (city) pharmacyFilter.city = new RegExp(city, "i");
      if (area) pharmacyFilter.area = new RegExp(area, "i");
      if (location) {
        pharmacyFilter.$or = [
          { city: new RegExp(location, "i") },
          { area: new RegExp(location, "i") }
        ];
      }
    }

    // Find pharmacies that match city/area (or all if none selected)
    const pharmacies = await Pharmacy.find(pharmacyFilter).select("_id");
    const pharmacyIds = pharmacies.map(p => p._id);

    // Now fetch medicines only from these pharmacies
    let medFilter = {};
    if (pharmacyIds.length > 0) medFilter.pharmacy = { $in: pharmacyIds };
    if (trending === "1" || trending === "true") medFilter.trending = true;
    // If searching for a city/area but no pharmacy matches, return []
    if ((city || area || location) && pharmacyIds.length === 0)
      return res.json([]);

    // Get medicines, also populate pharmacy so you can show name/city in frontend if needed
    const medicines = await Medicine.find(medFilter).populate("pharmacy");
    res.json(medicines);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch medicines" });
  }
});


app.get('/api/medicines/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json([]);
  try {
    const results = await Medicine.find({
      name: { $regex: q, $options: 'i' }
    }).limit(10);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Failed to search medicines" });
  }
});

app.post("/api/medicines", async (req, res) => {
  try {
    const { name, price, pharmacy, city, area, category, trending } = req.body;
    if (!name || !price) {
      return res.status(400).json({ message: "Name and price required" });
    }

    let img;
    try {
      img = await generateMedicineImage(name);
    } catch (e) {
      img = "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg";
    }

    // ⏬ Generate description if missing
    let description = req.body.description;
    if (!description && name) {
      description = await generateMedicineDescription(name);
    }

    const medicine = new Medicine({
      name,
      price,
      pharmacy,
      city,
      area,
      category: category || "Miscellaneous",
      trending,
      img,
      description
    });

    await medicine.save();

    await Pharmacy.findByIdAndUpdate(
      pharmacy,
      { $addToSet: { medicines: medicine._id } }
    );

    res.status(201).json(medicine);
  } catch (err) {
    res.status(500).json({ message: "Failed to add medicine", error: err.message });
  }
});

app.get("/api/offers", async (req, res) => {
  const offers = await Offer.find().sort({ createdAt: -1 });
  res.json(offers);
});

app.get("/api/trending", (req, res) => {
  res.json([
    { id: "med1", name: "Paracetamol 500mg", image: "/images/para.png", sold: 1200 },
    { id: "med2", name: "Vitamin C 1000mg", image: "/images/vitc.png", sold: 980 },
    { id: "med3", name: "Cough Syrup", image: "/images/cough.png", sold: 870 }
  ]);
});

app.post("/api/orders", auth, async (req, res) => {
  try {
    const {
      items, address, dosage, paymentMethod, pharmacyId,
      total, prescription,
    } = req.body;
    if (!items || !items.length || !address || !pharmacyId || !total) {
      return res.status(400).json({ message: "Incomplete order data" });
    }
    const pharmacy = await Pharmacy.findById(pharmacyId);
    const order = new Order({
  userId: req.user.userId,
  pharmacy: pharmacyId,
  items, address, dosage, paymentMethod, total, prescription,
  status: "placed", // <-- fix here!
  createdAt: new Date(),
  pharmacyName: pharmacy ? pharmacy.name : undefined,
});
    await order.save();

// ADD THIS CODE RIGHT HERE 👇
const { createPaymentRecord } = require('./controllers/paymentsController');
try {
  // Always create Payment record for every order (COD or Razorpay/UPI/card)
  await createPaymentRecord(order._id, { method: paymentMethod });
} catch (err) {
  console.error("Failed to create payment record:", err);
}

await notifyUser(
  req.user.userId.toString(),
  "Order Placed!",
  "Your order has been placed and is being processed. Track it in GoDavai app.",
  `${process.env.FRONTEND_URL || "http://localhost:3000"}/order/${order._id}`
);
res.status(201).json({ message: "Order placed successfully!", order });
  } catch (err) {
    res.status(500).json({ message: "Order placement failed", error: err.message });
  }
});

app.get("/api/orders/:orderId", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/orders/:orderId/location", auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    await Order.findByIdAndUpdate(req.params.orderId, { driverLocation: { lat, lng } });
    res.json({ message: "Location updated" });
  } catch {
    res.status(500).json({ message: "Failed to update location" });
  }
});

// In your order status update endpoint, e.g.:
app.post("/api/orders/:orderId/status", auth, async (req, res) => {
  const { status } = req.body;
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.status = status;
    await order.save();

    // Example: Notify user on delivery
    if (status === 2) {
      await notifyUser(
        order.userId.toString(),
        "Order Out for Delivery 🚚",
        "Your medicines are out for delivery! Track your order in GoDavai.",
        `${process.env.FRONTEND_URL || "http://localhost:3000"}/order/${order._id}`
      );
      await saveInAppNotification({
        userId: order.userId,
        title: "Order Out for Delivery 🚚",
        message: "Your medicines are out for delivery! Track your order in GoDavai."
      });
    }
    // Example: Notify user on delivered
    if (status === 3) {
      await notifyUser(
        order.userId.toString(),
        "Delivered! Get Well Soon 🎉",
        "Your order has been delivered. Wishing you a speedy recovery!",
        `${process.env.FRONTEND_URL || "http://localhost:3000"}/order/${order._id}`
      );
      await saveInAppNotification({
        userId: order.userId,
        title: "Delivered! Get Well Soon 🎉",
        message: "Your order has been delivered. Wishing you a speedy recovery!"
      });
    }
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Could not update order status" });
  }
});


app.patch("/api/orders/:orderId/dosage", auth, async (req, res) => {
  try {
    const { dosage, note } = req.body;
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (dosage) order.dosage = dosage;
    if (note) order.note = note;
    await order.save();
    await notifyUser(
      order.userId.toString(),
      "Dosage Updated",
      "Pharmacy updated your dosage instructions. Check your order details.",
      `${process.env.FRONTEND_URL || "http://localhost:3000"}/order/${order._id}`
    );
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Could not update dosage/note" });
  }
});

app.get("/api/pharmacy/:pharmacyId/orders", auth, async (req, res) => {
  const { pharmacyId } = req.params;
  const orders = await Order.find({ pharmacy: pharmacyId });
  res.json(orders);
});

// ================= DRIVER SIMULATOR (unchanged) =================
let driverSimulatorInterval = null;
app.post("/api/simulate-driver/:orderId", async (req, res) => {
  const { orderId } = req.params;
  if (driverSimulatorInterval) clearInterval(driverSimulatorInterval);
  let lat = 28.4595, lng = 77.0266;
  driverSimulatorInterval = setInterval(async () => {
    lat += (Math.random() - 0.5) * 0.002;
    lng += (Math.random() - 0.5) * 0.002;
    await Order.findByIdAndUpdate(orderId, { driverLocation: { lat, lng } });
  }, 5000);
  res.json({ message: "Driver simulation started" });
});

// ===================== PASSWORD RESET FLOW =====================

// 1. Request Reset (Email link or Mobile OTP)
app.post("/api/request-reset", async (req, res) => {
  const { emailOrMobile } = req.body;
  if (!emailOrMobile) return res.status(400).json({ message: "Enter email or mobile" });

  const user = await User.findOne({
    $or: [
      { email: emailOrMobile.toLowerCase() },
      { mobile: emailOrMobile }
    ]
  });
  if (!user) return res.status(404).json({ message: "No user found" });

  if (emailOrMobile.includes("@")) {
    // Email flow
    const token = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 1000 * 60 * 20; // 20 min
    await user.save();

    // Nodemailer config (Gmail example)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });

    const resetUrl = `http://localhost:3000/reset-password?token=${token}`; // Change to prod domain

    await transporter.sendMail({
      to: user.email,
      from: process.env.GMAIL_USER,
      subject: "Password Reset - GoDavai",
      html: `<p>Click to reset your password: <a href="${resetUrl}">${resetUrl}</a> (valid 20 min)</p>`,
    });

    return res.json({ message: "Reset link sent to email" });
  } else {
    // Mobile OTP flow
    const otp = randomOTP();
    user.resetOTP = otp;
    user.resetOTPExpires = Date.now() + 1000 * 60 * 10; // 10 min
    await user.save();

    // --- Uncomment for real SMS ---
    /*
    const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
    await twilioClient.messages.create({
      body: `Your GoDavai password reset OTP is: ${otp}`,
      from: process.env.TWILIO_PHONE,
      to: "+91" + user.mobile,
    });
    */
    return res.json({ message: "OTP sent to mobile", otp: otp }); // REMOVE `otp` in production!
  }
});

// 2A. Reset password via email link
app.post("/api/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ message: "Missing data" });

  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() }
  });
  if (!user) return res.status(400).json({ message: "Invalid or expired link" });

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ message: "Password updated! Login with your new password." });
});

// 2B. Reset password via mobile OTP
app.post("/api/reset-password-otp", async (req, res) => {
  const { mobile, otp, newPassword } = req.body;
  if (!mobile || !otp || !newPassword) return res.status(400).json({ message: "Missing data" });

  const user = await User.findOne({
    mobile,
    resetOTP: otp,
    resetOTPExpires: { $gt: Date.now() }
  });
  if (!user) return res.status(400).json({ message: "Invalid OTP or expired" });

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetOTP = undefined;
  user.resetOTPExpires = undefined;
  await user.save();

  res.json({ message: "Password updated! Login with your new password." });
});


app.get("/", (req, res) => res.send("GoDavai API is running..."));
app.get("/test", (req, res) => res.send("Backend is running!"));

// -- Only show all routes if in development/debug mode
function printRoutes() {
  if (process.env.NODE_ENV !== 'production') {
    app._router.stack.forEach(r => {
      if (r.route && r.route.path) {
        console.log("Registered route:", r.route.path, Object.keys(r.route.methods));
      }
    });
  }
}

const PORT = process.env.PORT || 5000;

// Connect DB and handle signals for graceful shutdown
mongoose.connect(
  process.env.MONGO_URI,
  { useNewUrlParser: true, useUnifiedTopology: true }
)
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`GoDavai backend running on http://localhost:${PORT}`);
      printRoutes();
    });

    // --- Handle SIGINT/SIGTERM for safe exit in prod environments ---
    process.on('SIGINT', () => {
      console.log("SIGINT received. Shutting down...");
      server.close(() => {
        mongoose.disconnect().then(() => {
          console.log("MongoDB disconnected. Exiting.");
          process.exit(0);
        });
      });
    });

    process.on('SIGTERM', () => {
      console.log("SIGTERM received. Shutting down...");
      server.close(() => {
        mongoose.disconnect().then(() => {
          console.log("MongoDB disconnected. Exiting.");
          process.exit(0);
        });
      });
    });
  })
  .catch((err) => {
    console.error("Mongo connection error:", err.message);
    process.exit(1);
  });