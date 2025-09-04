// app.js
require('dotenv').config();
require('./utils/ensureFolders');
const fs = require("fs");
const path = require("path");

// REMOVE or COMMENT OUT debug logs in production
// console.log('SERVER STARTED, ENV:', process.env.NODE_ENV, 'PORT:', process.env.PORT);

const express = require("express");
const axios = require('axios');
const MSG91_AUTHKEY = process.env.MSG91_AUTHKEY;
const app = express();
app.get("/__up", (req, res) => res.json({ ok: true, env: process.env.NODE_ENV }));
app.get("/__routes", (req, res) => {
  const out = [];
  const split = (thing) => {
    if (typeof thing === "string") return thing;
    if (thing.fast_slash) return "";
    const m = thing.toString().replace("\\/?", "").replace("(?=\\/|$)", "$")
      .match(/^\/\^\\\/?(.*)\\\/\?\$\//);
    return m ? "/" + m[1].replace(/\\\//g, "/") : "";
  };
  const walk = (base, layer) => {
    if (layer.route && layer.route.path) {
      Object.keys(layer.route.methods).forEach(m =>
        out.push(`${m.toUpperCase()} ${base}${layer.route.path}`));
    } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
      const newBase = base + split(layer.regexp);
      layer.handle.stack.forEach(l => walk(newBase, l));
    }
  };
  app._router.stack.forEach(l => walk("", l));
  res.json(out.sort());
});

const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
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
const medicinesRouter = require("./routes/medicines");
const pharmaciesRouter = require("./routes/pharmacies"); // optional, for consistency
const upload = require('./utils/upload');

// ---- S3 guard (put near your other env reads) ----
const haveS3Creds =
  !!process.env.AWS_BUCKET_NAME &&
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY;

const useS3 = process.env.USE_S3 === '1' && haveS3Creds;  // opt-in
// ---------------------------------------------------

const isS3 = !!process.env.AWS_BUCKET_NAME; // keep for legacy uses elsewhere

const { createPaymentRecord } = require('./controllers/paymentsController');
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000").split(",").map(url => url.trim());

// ADD THESE DEBUG LOGS HERE:
console.log("[ENV FRONTEND_URL]:", process.env.FRONTEND_URL);
console.log("[Allowed origins]:", allowedOrigins);
const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

// --- For Password Reset ---
function randomOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Allow www and non-www
function normalizeOrigin(url) {
  // Lowercase, remove trailing slashes, remove www
  return url ? url.replace(/^https?:\/\/(www\.)?/, 'https://').replace(/\/$/, '').toLowerCase() : '';
}

function isOriginAllowed(origin) {
  if (!origin) return true; // Allow Postman, server-side, etc.
  const normOrigin = normalizeOrigin(origin);
  return allowedOrigins.some(o => normalizeOrigin(o) === normOrigin);
}

// --- CORS: keep this BEFORE any routes ---


const corsOptions = {
  origin: [
    'https://godavaii.com',
    'https://www.godavaii.com',
    /\.vercel\.app$/i,         // allow your preview apps
    'http://localhost:3000'    // keep for local dev if you use it
  ],
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: [
    'Origin','X-Requested-With','Content-Type','Accept','Authorization',
    'deliverypartnerid','pharmacyid','adminid','userid',
    'x-access-token','x-refresh-token','x-csrf-token'
  ],
  exposedHeaders: ['Authorization','x-access-token']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // respond to all preflights


// Upload folders
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
if (!isS3 && !fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
if (!isS3) app.use("/uploads", express.static(UPLOADS_DIR));

console.log("BOOT: suggestions routes should be mounted");
app.get("/api/whoami", (req,res)=>res.json({ ok:true, tag:"whoami" }));

// ---- SUGGESTIONS: mount early so nothing can swallow it ----
// --- prove boot + mount suggestions early ---
console.log("BOOT: mounting /api/suggestions (+aliases)");
const toObjId = s => mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;

async function suggestionsHandler(req, res) {
  try {
    const { pharmacyId, exclude = "", limit = 10 } = req.query;
    if (!pharmacyId) return res.status(400).json({ message: "pharmacyId is required" });

    const lim = Math.min(parseInt(limit || 10, 10), 50);
    const excludeIds = exclude.split(",").map(s => toObjId(s.trim())).filter(Boolean);

    const or = [];
    if (toObjId(pharmacyId)) or.push({ pharmacy: toObjId(pharmacyId) }); // when stored as ObjectId
    or.push({ pharmacyId });                                             // when stored as string

    const filter = {
      ...(or.length ? { $or: or } : {}),
      ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}),
    };

    const items = await Medicine.find(filter)
      .select("_id name price brand img mrp category pharmacy pharmacyId")
      .sort({ popularity: -1, createdAt: -1 })
      .limit(lim)
      .lean();

    // Debug log INSIDE handler only — never at top level
    console.log("Suggestions query:", {
      pharmacyId,
      excludeCount: excludeIds.length,
      returned: items.length
    });

    // Ensure frontend always has a pharmacyId string
    res.json(items.map(doc => ({
      ...doc,
      pharmacyId: (doc.pharmacyId || doc.pharmacy || "").toString()
    })));
  } catch (err) {
    console.error("GET /suggestions error:", err);
    res.status(500).json({ message: "Failed to fetch suggestions" });
  }
}

// One handler, three aliases:
app.get("/api/suggestions", suggestionsHandler);
app.get("/api/medicines/suggestions", suggestionsHandler);
app.get("/api/medicine/suggestions", suggestionsHandler);

// ---- end suggestions ----
app.use("/api/search", require("./routes/search"));
// Routes (leave unchanged - already modular and clean)
// replace the four lines above with just these two:
app.use("/api/pharmacies", pharmaciesRouter);
app.use("/api/medicines", medicinesRouter);

app.use("/api/orders", require("./routes/orders"));

app.use('/api/payments', require('./routes/payments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use("/api/users", require("./routes/users"));
app.use("/api/delivery", require("./routes/deliveryRoutes"));
app.use("/api/prescriptions", require("./routes/prescriptions"));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/support-chat", require("./routes/supportChat"));
app.use('/api/admin', require('./routes/admin'));

app.use("/api/allorders", require("./routes/allorders"));
app.use("/api/pharmacy", require("./routes/pharmacyAuth"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/debug-invoices', (req, res) => {
  const fs = require('fs');
  const invoicesDir = path.join(process.env.UPLOADS_DIR || path.join(__dirname, "uploads"), "invoices");
  let files = [];
  try {
    files = fs.readdirSync(invoicesDir);
  } catch (e) {
    files = ["ERROR: " + e.message];
  }
  res.json({ dir: invoicesDir, files });
});

app.get('/debug-s3', async (req, res) => {
  const AWS = require('aws-sdk');
  const s3 = new AWS.S3();
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Prefix: 'medicines/'
  };
  s3.listObjectsV2(params, (err, data) => {
    if (err) return res.status(500).json({ err: err.message });
    res.json(data.Contents.map(obj => ({
      key: obj.Key,
      url: `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${obj.Key}`
    })));
  });
});


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
const allowedMimeTypes = ["image/jpeg", "image/png", "application/pdf"];
const pharmacyDocFields = [
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
];
const pharmacyDocsUpload = isS3
  ? upload.fields(pharmacyDocFields)
  : multer({
      storage: multer.diskStorage({
        destination: (req, file, cb) => {
          const key = req.body?.email || req.body?.contact || "unknown";
          const folder = path.join(UPLOADS_DIR, "pharmacies", key.replace(/[^a-zA-Z0-9@.]/g, "_"));
          if (!isS3 && !fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
          cb(null, folder);
        },
        filename: (req, file, cb) => {
          const safeName = Date.now() + "-" + file.originalname.replace(/\s/g, "_");
          cb(null, safeName);
        }
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!allowedMimeTypes.includes(file.mimetype)) {
          return cb(new Error("Only JPEG, PNG, and PDF files allowed!"));
        }
        cb(null, true);
      }
    }).fields(pharmacyDocFields);


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
    const requiredFields = [
  "name","ownerName","city","area","address","contact","email","password","qualification",
  "stateCouncilReg","drugLicenseRetail","gstin","bankAccount","ifsc","declarationAccepted"
];
console.log("Incoming registration:", req.body);
console.log("Incoming files:", req.files);
const missingFields = requiredFields.filter(f => !req.body[f]);
if (missingFields.length) {
  return res.status(400).json({ 
    message: "Missing required fields",
    fieldsMissing: missingFields 
  });
}


    const hashed = await bcrypt.hash(password, 10);
    function filePath(field) {
  if (req.files && req.files[field]) {
    // S3: use file.location, local: use /uploads/...
    return isS3
      ? req.files[field][0].location
      : (() => {
          const p = req.files[field][0].path.replace(/\\/g, "/");
          const idx = p.indexOf("/uploads/");
          return idx !== -1 ? p.substring(idx) : p;
        })();
  }
  return undefined;
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

const lat = req.body.lat ? parseFloat(req.body.lat) : null;
const lng = req.body.lng ? parseFloat(req.body.lng) : null;

let location = undefined;
if (lat && lng) {
  location = {
    type: "Point",
    coordinates: [lng, lat],
    formatted: req.body.locationFormatted || "",
  };
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
        location, 
      });
      // After collecting city, area, address:
const fullAddress = `${address}, ${area}, ${city}`;
if (!location || !location.formatted) {
const geo = await geocodeAddress(fullAddress);
if (geo) {
  pharmacy.location = {
    type: "Point",
    coordinates: [geo.lng, geo.lat], // [lng, lat] order!
    formatted: geo.formatted
  };
} else {
  // Optional: You can choose to block registration, or just skip location
  pharmacy.location = undefined;
 }
} 
      await pharmacy.save();
      // After pharmacy.save() and BEFORE res.status(201)...
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com", // change to smtp.gmail.com if using Gmail, or as per your provider
  port: 465, // or 587 for TLS
  secure: true, // true for port 465, false for 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const mailOptions = {
  from: `"GoDavaii" <${process.env.EMAIL_USER}>`,
  to: pharmacy.email,
  subject: "GoDavaii: Pharmacy Registration Received",
  html: `
    <div style="font-family:sans-serif">
      <h2>Welcome to GoDavaii!</h2>
      <p>Hi <b>${pharmacy.ownerName}</b>,</p>
      <p>Your pharmacy registration for <b>${pharmacy.name}</b> has been received and is now under review by our admin team.</p>
      <p>You will be notified by email/SMS as soon as your account is approved.</p>
      <br>
      <p>Thank you for joining the GoDavaii!</p>
      <p>Team GoDavaii</p>
    </div>
  `
};
try {
  await transporter.sendMail(mailOptions);
  console.log("✅ Registration email sent to:", pharmacy.email);
} catch (emailErr) {
  console.error("❌ Failed to send registration email:", emailErr);
}
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

  if (code !== process.env.ADMIN_REGISTER_CODE && code !== "Pururva1501") {
    // Accept "Pururva1501" or the code in your .env
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
    const pharmacy = await Pharmacy.findByIdAndUpdate(
      pharmacyId,
      { status: "approved", approved: true },
      { new: true }
    );
    if (!pharmacy) return res.status(404).json({ message: "Pharmacy not found" });

    // --- SEND APPROVAL EMAIL ---
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com", // or as per your provider
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"GoDavaii" <${process.env.EMAIL_USER}>`,
      to: pharmacy.email,
      subject: "GoDavaii Pharmacy Approval – You’re Ready to Start!",
      html: `
        <div style="font-family:sans-serif;background:#F9FAFB;padding:25px 18px;border-radius:8px">
          <h2 style="color:#13C0A2;">Welcome to GoDavaii!</h2>
          <p>Hi <b>${pharmacy.ownerName || pharmacy.name}</b>,</p>
          <p>Your pharmacy <b>${pharmacy.name}</b> has been <span style="color:#13C0A2;"><b>approved</b></span> on GoDavaii!</p>
          <p>You can now <a href="https://www.godavaii.com/pharmacy/login" style="color:#FFD43B;text-decoration:underline">login</a> and start receiving medicine orders from new customers.</p>
          <ul>
            <li><b>Pharmacy Name:</b> ${pharmacy.name}</li>
            <li><b>Contact:</b> ${pharmacy.contact}</li>
            <li><b>City/Area:</b> ${pharmacy.city}, ${pharmacy.area}</li>
          </ul>
          <p>If you have any questions, our support team is here to help!</p>
          <br>
          <p>Thank you for partnering with GoDavaii.<br/>Let’s deliver better health together!</p>
          <p style="color:#13C0A2;">Team GoDavaii</p>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Pharmacy approval email sent to:", pharmacy.email);
    } catch (emailErr) {
      console.error("❌ Failed to send pharmacy approval email:", emailErr);
    }

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

// --- accept common field names for images and avoid "Unexpected field"
const imageFields = [
  { name: "images", maxCount: 8 },
  { name: "image",  maxCount: 8 },   // changed from 1 -> 8
  { name: "photo",  maxCount: 8 },
  { name: "file",   maxCount: 8 },
];

const pharmacyImagesUpload = useS3
  ? upload.fields(imageFields)              // S3 wrapper respects field names
  : multer({
      storage: multer.diskStorage({
        destination: (req, file, cb) => {
          const folder = path.join(UPLOADS_DIR, "medicines");
          if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
          cb(null, folder);
        },
        filename: (req, file, cb) =>
          cb(null, Date.now() + path.extname(file.originalname))
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }).fields(imageFields);

// helper: detect multipart/form-data
const isMultipart = req =>
  (req.headers["content-type"] || "").toLowerCase().includes("multipart/form-data");

// normalize all possible multer shapes into one flat array of image files
function collectImageFiles(req) {
  const isArrayShape = Array.isArray(req.files);
  const raw = isArrayShape ? req.files : Object.values(req.files || {}).flat();
  return (raw || []).filter(f => /^image\//i.test(f.mimetype));
}

/** keep existing helpers — no behavioral change */
const normalizeCategory = (input) => {
  let cat = input;
  try {
    if (typeof cat === "string" && cat.trim().startsWith("[")) cat = JSON.parse(cat);
  } catch (_) {}
  if (!Array.isArray(cat)) cat = cat ? [String(cat)] : ["Miscellaneous"];
  return cat;
};
const asTrimmedString = (v) => (v ?? "").toString().trim();
// ---- bool helper for yes/true/1/on strings ----
const toBool = (v) => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
};

// treat empty, whitespace, or the sentinel as "missing"
// treat empty, whitespace, the sentinel, or old long paragraphs (no bullets) as "missing"
const isBulleted = (s) => /(^|\n)\s*(?:•|-|\d+\.)\s+/.test(String(s || ""));
const isMissingDesc = (s) => {
  const t = String(s || "").trim();
  if (!t) return true;
  if (/^no description available\.?$/i.test(t)) return true;
  // legacy long paragraph (not bulleted) → replace
  if (t.length > 240 && !isBulleted(t)) return true;
  return false;
};


/** GET: dashboard list (unchanged) */
app.get("/api/pharmacy/medicines", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  const medicines = await Medicine.find({ pharmacy: req.user.pharmacyId });
  res.json(medicines);
});

app.options("/api/pharmacy/medicines", cors());
app.options("/api/pharmacy/medicines/:id", cors());

/** POST: add medicine — now always writes composition & company */
// app.js  — replace the whole POST /api/pharmacy/medicines with this

app.post("/api/pharmacy/medicines", auth, (req, res) => {
  const run = async () => {
    try {
      const pharmacyId = req.user?.pharmacyId;

      // tolerate brand-only (UI sets name from brand)
      const {
        name, brand, price, mrp, stock,
        category, discount, composition, company, type, customType, prescriptionRequired
      } = req.body || {};

      if (!pharmacyId || (!name && !brand) || price === undefined || mrp === undefined || stock === undefined || !category) {
        return res.status(400).json({ error: "Missing fields." });
      }

      const asNum = v => (v === "" || v === null || v === undefined) ? NaN : Number(v);
      const priceNum = asNum(price);
      const mrpNum   = asNum(mrp);
      const stockNum = asNum(stock);
      const discNum  = isNaN(asNum(discount)) ? 0 : asNum(discount);

      if ([priceNum, mrpNum, stockNum].some(Number.isNaN)) {
        return res.status(400).json({ error: "price/mrp/stock must be numbers" });
      }

      // handle category/type from JSON or multipart
      const toList = (x) => {
        try { if (typeof x === "string" && x.trim().startsWith("[")) return JSON.parse(x); } catch {}
        return Array.isArray(x) ? x : (x ? [String(x)] : []);
      };

      const catList = toList(category);
      const categoryIsArray = (Medicine.schema.paths.category?.instance || "").toLowerCase() === "array";
      const categoryValue = categoryIsArray ? (catList.length ? catList : ["Miscellaneous"])
                                            : (catList[0] || "Miscellaneous");

      const typeList = toList(type);
      const typeIsArray = (Medicine.schema.paths.type?.instance || "").toLowerCase() === "array";
      const typeValue = (type === "Other")
        ? ((customType || "Other").toString().trim())
        : (typeIsArray ? (typeList.length ? typeList : ["Tablet"])
                       : (typeList[0] || "Tablet"));

      // gather images regardless of multer shape
      const filesArray = Array.isArray(req.files)
        ? req.files
        : Object.values(req.files || {}).flat();

      const imgs = (filesArray || [])
        .filter(f => /^image\//i.test(f.mimetype))
        .map(f =>
          useS3
            ? (f.location || `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${f.key}`)
            : "/uploads/medicines/" + (f.filename || f.key)
        );

      const mergedName = (name && name.toString().trim()) || (brand && brand.toString().trim());

      const med = new Medicine({
        name: mergedName,
        brand: (brand || mergedName),
        composition: (composition ?? "").toString().trim(),
        company: (company ?? "").toString().trim(),
        price: priceNum,
        mrp: mrpNum,
        stock: stockNum,
        discount: discNum,
        category: categoryValue,
        type: typeValue,
        prescriptionRequired: toBool(prescriptionRequired),
        pharmacy: pharmacyId,
        img: imgs[0],
        images: imgs
      });

      try {
        const desc = await generateMedicineDescription(mergedName);
        if (desc) med.description = desc;
      } catch { /* ignore description failure */ }

      await med.save();
      return res.status(201).json({ success: true, medicine: med });
    } catch (e) {
      console.error("Add new medicine error:", e);
      if (e?.name === "ValidationError" || e?.name === "CastError") {
        return res.status(400).json({ error: "Invalid data", detail: e.message });
      }
      if (e?.code === 11000) {
        return res.status(409).json({ error: "Duplicate", detail: e.message });
      }
      return res.status(500).json({ error: "Failed to add medicine", detail: e?.message || String(e) });
    }
  };

  // IMPORTANT: only parse files first when multipart, then run()
  const contentType = (req.headers["content-type"] || "").toLowerCase();
  const multipart = contentType.includes("multipart/form-data");

  if (multipart) {
    return pharmacyImagesUpload(req, res, (err) => {
      if (err) {
        console.error("Multer upload error:", err);
        const msg = err.code === "LIMIT_FILE_SIZE" ? "Image too large" :
                    err.code === "LIMIT_UNEXPECTED_FILE" ? "Unexpected field" :
                    err.message || "Upload error";
        return res.status(400).json({ error: msg });
      }
      // now safely run your logic
      return run();
    });
  }

  // JSON path (no files)
  return run();
});

/** PATCH: edit medicine — now updates composition & company too */
app.patch("/api/pharmacy/medicines/:id", auth, (req, res) => {
  const handle = async () => {
    try {
      const med = await Medicine.findOne({ _id: req.params.id, pharmacy: req.user.pharmacyId });
      if (!med) return res.status(404).json({ message: "Medicine not found" });

      const b = req.body || {};
      const S = v => (v ?? "").toString().trim();

      if (b.name !== undefined)        med.name        = S(b.name);
      if (b.brand !== undefined)       med.brand       = S(b.brand);
      if (b.composition !== undefined) med.composition = S(b.composition);
      if (b.company !== undefined)     med.company     = S(b.company);
      if (b.prescriptionRequired !== undefined) med.prescriptionRequired = toBool(b.prescriptionRequired);

      if (!med.name && med.brand) med.name = med.brand;
      if (!med.brand && med.name) med.brand = med.name;

      if (b.price   !== undefined) med.price   = Number(b.price);
      if (b.mrp     !== undefined) med.mrp     = Number(b.mrp);
      if (b.stock   !== undefined) med.stock   = Number(b.stock);
      if (b.discount!== undefined) med.discount= Number(b.discount);

      if (b.category !== undefined) {
        let cat = b.category;
        try { if (typeof cat === "string" && cat.trim().startsWith("[")) cat = JSON.parse(cat); } catch {}
        med.category = Array.isArray(cat) ? cat : (cat ? [String(cat)] : ["Miscellaneous"]);
      }

      if (b.type !== undefined) {
        med.type = b.type === "Other" ? (S(b.customType) || "Other") : S(b.type);
      }

      // append any newly uploaded images
      const imgs = collectImageFiles(req).map(f =>
        useS3 ? (f.location || `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${f.key}`)
              : "/uploads/medicines/" + (f.filename || f.key)
      );
      if (imgs.length) {
        med.images = [...(med.images || []), ...imgs];
        if (!med.img) med.img = med.images[0];
      }

      await med.save();
      res.json({ success: true, medicine: med });
    } catch (e) {
      console.error("Edit medicine error:", e);
      res.status(500).json({ message: "Failed to update medicine" });
    }
  };

  if (isMultipart(req)) {
    return pharmacyImagesUpload(req, res, err => {
      if (err) return res.status(400).json({ message: "Upload error", error: err.message });
      handle();
    });
  }
  handle();
});

/** DELETE (unchanged) */
app.delete("/api/pharmacy/medicines/:id", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  await Medicine.deleteOne({ _id: req.params.id, pharmacy: req.user.pharmacyId });
  res.json({ message: "Medicine deleted" });
});

app.patch("/api/pharmacy/medicines/:id/availability", auth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const body = req.body || {};
    const toUnavailable = typeof body.unavailable === "boolean"
      ? body.unavailable
      : String(body.status || "").toLowerCase() === "unavailable";

    const nextStatus = toUnavailable ? "unavailable" : "active";

    const med = await Medicine.findByIdAndUpdate(
      id,
      { $set: { status: nextStatus, available: !toUnavailable } },
      { new: true }
    );

    if (!med) return res.status(404).json({ error: "Medicine not found" });
    return res.json({ ok: true, medicine: med });
  } catch (e) {
    console.error("availability toggle error:", e.message);
    res.status(500).json({ error: "Failed to update availability" });
  }
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
  const orders = await Order.find({ pharmacy: pharmacy._id }).lean();
  // Remove address field from each order object
  const sanitizedOrders = orders.map(order => {
    // Remove entire address object, or just the sensitive fields you want
    if (order.address) {
      // Option 1: Remove entire address object
      delete order.address;

      // Option 2: If you want to keep coordinates or pin, you can delete only specific fields
      // delete order.address.addressLine;
      // delete order.address.landmark;
      // delete order.address.floor;
      // delete order.address.city;
      // ... etc.
    }
    return order;
  });
  res.json(sanitizedOrders);
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
    // default: hide unavailable unless onlyAvailable="0"
    if (String(req.query.onlyAvailable || "1") === "1") {
      medFilter.status = { $ne: "unavailable" };
      medFilter.available = { $ne: false };
      medFilter.stock = { $gt: 0 };
      }
    // If searching for a city/area but no pharmacy matches, return []
    if ((city || area || location) && pharmacyIds.length === 0)
      return res.json([]);

    // Get medicines, also populate pharmacy so you can show name/city in frontend if needed
    // NOTE: lean() so we can mutate before sending
    const meds = await Medicine.find(medFilter).populate("pharmacy").lean();

    // Eager-fill missing descriptions only when enabled
    const gptOn = String(process.env.GPT_MED_STAGE || "1") === "1" && !!process.env.OPENAI_API_KEY;
    if (gptOn) {
      const missing = meds.filter(m => isMissingDesc(m.description));
      if (missing.length) {
        // small concurrency cap
        const slots = 3;
        let inFlight = 0;
        const queue = [...missing];

        const runOne = async () => {
          const m = queue.shift();
          if (!m) return;
          inFlight++;
          try {
            const text = await generateMedicineDescription({
              name: m.name,
              brand: m.brand,
              composition: m.composition,
              company: m.company,
              type: m.type
            });
            if (text && text !== "No description available.") {
              await Medicine.updateOne({ _id: m._id }, { $set: { description: text } });
              const hit = meds.find(x => String(x._id) === String(m._id));
              if (hit) hit.description = text; // so response includes it now
            }
          } catch (e) {
            console.error("Desc gen (GET /api/medicines) failed:", m?.name, e?.response?.data || e.message);
          } finally {
            inFlight--;
            if (queue.length) await runOne();
          }
        };

        // kick off workers
        const workers = Array(Math.min(slots, queue.length)).fill(0).map(runOne);
        await Promise.all(workers);
      }
    }

    res.json(meds);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch medicines" });
  }
});

// Ensure a single medicine has a description now (idempotent)
app.post("/api/medicines/:id/ensure-description", async (req, res) => {
  try {
    const id = req.params.id;
    const med = await Medicine.findById(id);
    if (!med) return res.status(404).json({ error: "Medicine not found" });

    // already has description?
    if (!isMissingDesc(med.description)) {
      return res.json({ ok: true, description: med.description });
    }

    const gptOn = String(process.env.GPT_MED_STAGE || "1") === "1" && !!process.env.OPENAI_API_KEY;
    if (!gptOn) return res.json({ ok: false, error: "GPT disabled", description: "" });

    const text = await generateMedicineDescription({
      name: med.name,
      brand: med.brand,
      composition: med.composition,
      company: med.company,
      type: med.type
    });

    if (text && !isMissingDesc(text)) {
      med.description = text;
      await med.save();
      return res.json({ ok: true, description: text });
    }
    res.json({ ok: false, description: "" });
  } catch (e) {
    console.error("ensure-description error:", e?.response?.data || e.message);
    res.status(500).json({ error: "Failed to ensure description" });
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
  "Your order has been placed and is being processed. Track it in GoDavaii app.",
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
        "Your medicines are out for delivery! Track your order in GoDavaii.",
        `${process.env.FRONTEND_URL || "http://localhost:3000"}/order/${order._id}`
      );
      await saveInAppNotification({
        userId: order.userId,
        title: "Order Out for Delivery 🚚",
        message: "Your medicines are out for delivery! Track your order in GoDavaii."
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
      subject: "Password Reset - GoDavaii",
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
      body: `Your GoDavaii password reset OTP is: ${otp}`,
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

// Health checks / root endpoints
app.get("/cors-test", (req, res) => 
  res.json({ ok: true, origin: req.headers.origin || null })
);
app.get("/", (req, res) => res.send("GoDavai API is running..."));
app.get("/test", (req, res) => res.send("Backend is running!"));

// --- Only show all routes if in development/debug mode ---
function printRoutes() {
  if (process.env.NODE_ENV !== 'production') {
    app._router.stack.forEach(r => {
      if (r.route && r.route.path) {
        console.log("Registered route:", r.route.path, Object.keys(r.route.methods));
      }
    });
  }
}

// Proxy for Geocoding (lat,lng -> address)
app.get('/api/geocode', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await axios.get(url);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch geocode", detail: err.message });
  }
});

// Proxy for Place Autocomplete (address search box)
app.get('/api/place-autocomplete', async (req, res) => {
  const { input } = req.query;
  if (!input) return res.status(400).json({ error: "Missing input" });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${GOOGLE_MAPS_API_KEY}&types=address&components=country:in`;
    const response = await axios.get(url);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch autocomplete", detail: err.message });
  }
});

// Proxy for Place Details (get lat/lng by place_id)
app.get('/api/place-details', async (req, res) => {
  const { place_id } = req.query;
  if (!place_id) return res.status(400).json({ error: "Missing place_id" });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await axios.get(url);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch place details", detail: err.message });
  }
});

// --- TEMP: prove routes are mounted in prod ---
if (process.env.PRINT_ROUTES === "1") {
  console.log("=== PRINT_ROUTES: dumping registered paths ===");
  app._router.stack
    .filter(r => r.route)
    .forEach(r => console.log(Object.keys(r.route.methods).join(","), r.route.path));
}

// DO NOT add any mongoose.connect or app.listen code here!
// This file should ONLY setup the Express app and export it:

// --- TEMP: print every mounted route, including nested routers ---
if (process.env.PRINT_ROUTES === "1") {
  console.log("=== PRINT_ROUTES: dumping registered paths (incl. nested) ===");

  const split = (thing) => {
    if (typeof thing === "string") return thing;
    if (thing.fast_slash) return "";
    // Turn layer.regexp into a readable path fragment
    const m = thing
      .toString()
      .replace("\\/?", "")
      .replace("(?=\\/|$)", "$")
      .match(/^\/\^\\\/?(.*)\\\/\?\$\//);
    return m ? "/" + m[1].replace(/\\\//g, "/") : "";
  };

  const print = (base, layer) => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods)
        .map((m) => m.toUpperCase())
        .join(",");
      console.log(methods, base + layer.route.path);
    } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
      const newBase = base + split(layer.regexp);
      layer.handle.stack.forEach((l) => print(newBase, l));
    }
  };

  app._router.stack.forEach((l) => print("", l));
}
// --- end route dump ---

app.get('/api/whoami', (req,res) => {
  const routes = [];
  app._router.stack.forEach(l => {
    if (l.route) routes.push(...Object.keys(l.route.methods).map(m => `${m.toUpperCase()} ${l.route.path}`));
  });
  res.json({ commit: process.env.RENDER_GIT_COMMIT || 'local', routes });
});

// Debug: list every registered route (helps verify in prod)
app.get("/routes", (req, res) => {
  const out = [];
  const split = (thing) => {
    if (typeof thing === "string") return thing;
    if (thing.fast_slash) return "";
    const m = thing.toString().replace("\\/?", "").replace("(?=\\/|$)", "$")
      .match(/^\/\^\\\/?(.*)\\\/\?\$\//);
    return m ? "/" + m[1].replace(/\\\//g, "/") : "";
  };
  const walk = (base, layer) => {
    if (layer.route && layer.route.path) {
      Object.keys(layer.route.methods).forEach(m => out.push(`${m.toUpperCase()} ${base}${layer.route.path}`));
    } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
      const newBase = base + split(layer.regexp);
      layer.handle.stack.forEach(l => walk(newBase, l));
    }
  };
  app._router.stack.forEach(l => walk("", l));
  res.json(out.sort());
});

// --- Global error handler that still returns CORS so the browser shows the real error ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  // echo back the origin if allowed; otherwise use first allowed origin or *
  const reqOrigin = req.headers.origin;
  const allow =
    ['https://godavaii.com','https://www.godavaii.com'].includes(reqOrigin) ||
    /\.vercel\.app$/i.test(reqOrigin) ||
    reqOrigin === 'http://localhost:3000';

  res.setHeader('Access-Control-Allow-Origin', allow ? reqOrigin : 'https://www.godavaii.com');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(500).json({ error: 'Server error' });
});

module.exports = app;
 