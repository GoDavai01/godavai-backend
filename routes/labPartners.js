const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const auth = require("../middleware/auth");
const LabPartner = require("../models/LabPartner");
const LabBooking = require("../models/LabBooking");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
let PARTNER_DOCS_DIR = path.join(process.cwd(), "uploads", "lab-partner-docs");
let LAB_REPORTS_DIR = path.join(process.cwd(), "uploads", "lab-reports");

function ensureDir(dirType = "docs") {
  try {
    if (dirType === "reports") {
      fs.mkdirSync(LAB_REPORTS_DIR, { recursive: true });
      return LAB_REPORTS_DIR;
    }
    fs.mkdirSync(PARTNER_DOCS_DIR, { recursive: true });
    return PARTNER_DOCS_DIR;
  } catch (_) {
    if (dirType === "reports") {
      LAB_REPORTS_DIR = path.join(os.tmpdir(), "godavaii-lab-reports");
      fs.mkdirSync(LAB_REPORTS_DIR, { recursive: true });
      return LAB_REPORTS_DIR;
    }
    PARTNER_DOCS_DIR = path.join(os.tmpdir(), "godavaii-lab-partner-docs");
    fs.mkdirSync(PARTNER_DOCS_DIR, { recursive: true });
    return PARTNER_DOCS_DIR;
  }
}

function asText(v) {
  return String(v == null ? "" : v).trim();
}

function partnerTokenPayload(partner) {
  return {
    role: "lab_partner",
    partnerId: partner._id.toString(),
    email: partner.email,
  };
}

function partnerAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Authorization header missing" });
  const token = authHeader.slice("Bearer ".length).trim();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.role !== "lab_partner" || !decoded?.partnerId) {
      return res.status(401).json({ error: "Lab partner token required" });
    }
    req.partnerAuth = decoded;
    next();
  } catch (_) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

const isAdmin = (req, res, next) => {
  return auth(req, res, () => {
    const ok = !!req.user?.adminId || req.user?.type === "admin";
    if (!ok) return res.status(403).json({ error: "Admin only" });
    next();
  });
};

function mapPartner(p) {
  return {
    id: p._id.toString(),
    name: p.name,
    email: p.email,
    phone: p.phone,
    organization: p.organization || "",
    city: p.city || "",
    pincode: p.pincode || "",
    labAddress: p.labAddress || "",
    areas: Array.isArray(p.areas) ? p.areas : [],
    active: !!p.active,
    kycStatus: p.kycStatus || "pending",
    kycNotes: p.kycNotes || "",
    licenseNumber: p.licenseNumber || "",
    licenseAuthority: p.licenseAuthority || "",
    licenseValidUpto: p.licenseValidUpto || "",
    gstNumber: p.gstNumber || "",
    panNumber: p.panNumber || "",
    documents: Array.isArray(p.documents) ? p.documents : [],
    approvedAt: p.approvedAt || null,
  };
}

function mapBooking(row) {
  return {
    id: row.bookingId,
    _id: row._id,
    items: row.items || [],
    total: row.total || 0,
    profileName: row.profileName || "Self",
    phone: row.phone || "",
    address: row.address || "",
    landmark: row.landmark || "",
    cityArea: row.cityArea || "",
    date: row.date,
    dateLabel: row.dateLabel || row.date,
    slot: row.slot,
    paymentMethod: row.paymentMethod || "",
    paymentStatus: row.paymentStatus || "pending",
    status: row.status || "sample_scheduled",
    notes: row.notes || "",
    reportEta: row.reportEta || "24 hrs",
    assignedPartnerId: row.assignedPartnerId || null,
    assignedPartnerName: row.assignedPartnerName || "",
    attachedFileName: row.attachedFileName || null,
    attachedFile: row.attachedFile || null,
    reportFileName: row.reportFileName || null,
    reportFile: row.reportFile || null,
    reportUploadedAt: row.reportUploadedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.post("/register", upload.array("documents", 8), async (req, res) => {
  try {
    const name = asText(req.body?.name);
    const email = asText(req.body?.email).toLowerCase();
    const phone = asText(req.body?.phone);
    const password = asText(req.body?.password);
    const city = asText(req.body?.city || "Noida");
    const pincode = asText(req.body?.pincode);
    const labAddress = asText(req.body?.labAddress);
    const licenseNumber = asText(req.body?.licenseNumber);
    const licenseAuthority = asText(req.body?.licenseAuthority);
    const licenseValidUpto = asText(req.body?.licenseValidUpto);
    const gstNumber = asText(req.body?.gstNumber);
    const panNumber = asText(req.body?.panNumber);
    const areas = Array.isArray(req.body?.areas)
      ? req.body.areas.map(asText).filter(Boolean)
      : asText(req.body?.areas)
          .split(",")
          .map(asText)
          .filter(Boolean);

    if (!name || !email || !phone || !password || !licenseNumber || !labAddress || !pincode) {
      return res.status(400).json({
        error: "name, email, phone, password, licenseNumber, labAddress, pincode are required",
      });
    }
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "At least one verification document is required" });
    }
    const exists = await LabPartner.findOne({ email });
    if (exists) return res.status(409).json({ error: "Lab partner already exists with this email" });

    const docsDir = ensureDir("docs");
    const documents = [];
    for (const f of req.files) {
      const safeName = path.basename(f.originalname || "doc.bin").replace(/[^\w.\-]/g, "_");
      const key = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safeName}`;
      const abs = path.join(docsDir, key);
      await fs.promises.writeFile(abs, f.buffer);
      documents.push({
        docType: asText(f.fieldname || "document"),
        fileName: f.originalname || safeName,
        mimeType: f.mimetype || "",
        fileSize: Number(f.size || 0),
        fileKey: key,
        fileUrl: `/uploads/lab-partner-docs/${key}`,
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const partner = await LabPartner.create({
      name,
      email,
      phone,
      city,
      pincode,
      labAddress,
      areas,
      organization: asText(req.body?.organization),
      licenseNumber,
      licenseAuthority,
      licenseValidUpto,
      gstNumber,
      panNumber,
      documents,
      passwordHash,
      kycStatus: "pending",
      active: false,
    });

    return res.status(201).json({
      message: "Registration submitted. Account will be activated after compliance verification.",
      partner: mapPartner(partner),
    });
  } catch (err) {
    console.error("POST /lab-partners/register error:", err?.message || err);
    return res.status(500).json({ error: "Failed to register lab partner" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = asText(req.body?.email).toLowerCase();
    const password = asText(req.body?.password);
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const partner = await LabPartner.findOne({ email });
    if (!partner || !partner.passwordHash) return res.status(401).json({ error: "Invalid email or password" });
    const ok = await bcrypt.compare(password, partner.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });
    if (partner.kycStatus !== "verified" || !partner.active) {
      if (partner.kycStatus === "rejected" || partner.kycStatus === "suspended") {
        return res.status(403).json({ error: "Account is not eligible for login. Contact support/admin." });
      }
      return res.status(403).json({ error: "Verification pending. Your lab account is under compliance review." });
    }
    const token = jwt.sign(partnerTokenPayload(partner), process.env.JWT_SECRET, { expiresIn: "30d" });
    return res.json({ token, partner: mapPartner(partner) });
  } catch (err) {
    console.error("POST /lab-partners/login error:", err?.message || err);
    return res.status(500).json({ error: "Failed to login lab partner" });
  }
});

router.get("/me", partnerAuth, async (req, res) => {
  try {
    const partner = await LabPartner.findById(req.partnerAuth.partnerId).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("GET /lab-partners/me error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

router.put("/me", partnerAuth, async (req, res) => {
  try {
    const patch = {};
    if (asText(req.body?.name)) patch.name = asText(req.body.name);
    if (asText(req.body?.phone)) patch.phone = asText(req.body.phone);
    if (asText(req.body?.city)) patch.city = asText(req.body.city);
    if (req.body?.organization != null) patch.organization = asText(req.body.organization);
    if (Array.isArray(req.body?.areas)) patch.areas = req.body.areas.map(asText).filter(Boolean);

    const partner = await LabPartner.findByIdAndUpdate(req.partnerAuth.partnerId, { $set: patch }, { new: true });
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("PUT /lab-partners/me error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update profile" });
  }
});

router.get("/bookings", partnerAuth, async (req, res) => {
  try {
    const partner = await LabPartner.findById(req.partnerAuth.partnerId).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });

    const status = asText(req.query.status || "all").toLowerCase();
    const showUnassigned = asText(req.query.unassigned || "1") !== "0";

    const baseStatus = status === "all" ? { $in: ["sample_scheduled", "sample_collected", "processing", "report_ready"] } : status;

    const cityRe = asText(req.query.city || partner.city || "");
    const cityFilter = cityRe ? { cityArea: new RegExp(cityRe, "i") } : {};

    const assignedFilter = {
      $or: [
        { assignedPartnerId: partner._id },
        ...(showUnassigned ? [{ assignedPartnerId: null }] : []),
      ],
    };

    const rows = await LabBooking.find({
      status: baseStatus,
      ...cityFilter,
      ...assignedFilter,
    })
      .sort({ date: 1, createdAt: -1 })
      .limit(300)
      .lean();

    return res.json({ bookings: rows.map(mapBooking) });
  } catch (err) {
    console.error("GET /lab-partners/bookings error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load bookings" });
  }
});

async function saveReportFile(file) {
  const reportsDir = ensureDir("reports");
  const safeName = path.basename(file.originalname || "report.bin").replace(/[^\w.\-]/g, "_");
  const key = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safeName}`;
  const abs = path.join(reportsDir, key);
  await fs.promises.writeFile(abs, file.buffer);
  return {
    fileName: file.originalname || safeName,
    mimeType: file.mimetype || "",
    fileSize: Number(file.size || 0),
    fileKey: key,
    fileUrl: `/uploads/lab-reports/${key}`,
  };
}

router.patch("/bookings/:id/status", partnerAuth, upload.single("reportFile"), async (req, res) => {
  try {
    const partner = await LabPartner.findById(req.partnerAuth.partnerId).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });

    const id = asText(req.params.id);
    const byMongoId = mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : [];
    const booking = await LabBooking.findOne({
      $or: [{ bookingId: id }, ...byMongoId],
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const action = asText(req.body?.action || req.body?.status).toLowerCase();
    if (!action) return res.status(400).json({ error: "action is required" });

    const ownedByMe = String(booking.assignedPartnerId || "") === String(partner._id);
    const unassigned = !booking.assignedPartnerId;

    if (action === "accept") {
      if (!["sample_scheduled"].includes(booking.status)) {
        return res.status(409).json({ error: "Booking cannot be accepted in current state" });
      }
      if (!unassigned && !ownedByMe) return res.status(403).json({ error: "Booking assigned to another partner" });
      booking.assignedPartnerId = partner._id;
      booking.assignedPartnerName = partner.name;
      await booking.save();
      return res.json({ booking: mapBooking(booking) });
    }

    if (!ownedByMe) return res.status(403).json({ error: "Booking is not assigned to you" });

    if (action === "sample_collected" || action === "collect") {
      if (booking.status !== "sample_scheduled") {
        return res.status(409).json({ error: "Booking must be sample_scheduled first" });
      }
      booking.status = "sample_collected";
      booking.sampleCollectedAt = new Date();
      await booking.save();
      return res.json({ booking: mapBooking(booking) });
    }

    if (action === "processing" || action === "start_processing") {
      if (!["sample_collected", "sample_scheduled"].includes(booking.status)) {
        return res.status(409).json({ error: "Booking cannot move to processing from current state" });
      }
      booking.status = "processing";
      booking.processingStartedAt = new Date();
      await booking.save();
      return res.json({ booking: mapBooking(booking) });
    }

    if (action === "report_ready") {
      if (!["processing", "sample_collected"].includes(booking.status)) {
        return res.status(409).json({ error: "Booking cannot move to report_ready from current state" });
      }
      if (!req.file && !booking.reportFile?.fileKey) {
        return res.status(400).json({ error: "reportFile is required before marking report_ready" });
      }
      if (req.file) {
        booking.reportFile = await saveReportFile(req.file);
        booking.reportFileName = booking.reportFile.fileName;
        booking.reportUploadedAt = new Date();
      }
      booking.status = "report_ready";
      booking.reportReadyAt = new Date();
      await booking.save();
      return res.json({ booking: mapBooking(booking) });
    }

    if (action === "completed" || action === "complete") {
      if (!["report_ready", "processing"].includes(booking.status)) {
        return res.status(409).json({ error: "Booking cannot be completed from current state" });
      }
      booking.status = "completed";
      booking.completedAt = new Date();
      await booking.save();
      return res.json({ booking: mapBooking(booking) });
    }

    if (action === "cancel" || action === "cancelled") {
      booking.status = "cancelled";
      booking.cancelledAt = new Date();
      booking.cancelReason = asText(req.body?.reason || "Cancelled by lab partner");
      await booking.save();
      return res.json({ booking: mapBooking(booking) });
    }

    if (action === "upload_report") {
      if (!req.file) return res.status(400).json({ error: "reportFile is required" });
      if (!["sample_collected", "processing", "report_ready"].includes(booking.status)) {
        return res.status(409).json({ error: "Report upload is not allowed in current state" });
      }
      booking.reportFile = await saveReportFile(req.file);
      booking.reportFileName = booking.reportFile.fileName;
      booking.reportUploadedAt = new Date();
      if (booking.status === "sample_collected") booking.status = "processing";
      await booking.save();
      return res.json({ booking: mapBooking(booking) });
    }

    return res.status(400).json({ error: "Unsupported action. Use accept/collect/processing/upload_report/report_ready/completed/cancel" });
  } catch (err) {
    console.error("PATCH /lab-partners/bookings/:id/status error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update booking status" });
  }
});

router.get("/admin/pending", isAdmin, async (req, res) => {
  try {
    const rows = await LabPartner.find({ kycStatus: "pending" })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();
    return res.json({ partners: rows.map(mapPartner) });
  } catch (err) {
    console.error("GET /lab-partners/admin/pending error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load pending partners" });
  }
});

router.patch("/admin/:id/approve", isAdmin, async (req, res) => {
  try {
    const id = asText(req.params.id);
    const partner = await LabPartner.findByIdAndUpdate(
      id,
      {
        $set: {
          kycStatus: "verified",
          active: true,
          kycNotes: asText(req.body?.notes || "Approved by admin"),
          approvedAt: new Date(),
          approvedByAdminId: req.user?.adminId || null,
        },
      },
      { new: true }
    );
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("PATCH /lab-partners/admin/:id/approve error:", err?.message || err);
    return res.status(500).json({ error: "Failed to approve partner" });
  }
});

router.patch("/admin/:id/reject", isAdmin, async (req, res) => {
  try {
    const id = asText(req.params.id);
    const partner = await LabPartner.findByIdAndUpdate(
      id,
      {
        $set: {
          kycStatus: "rejected",
          active: false,
          kycNotes: asText(req.body?.notes || "Rejected by admin"),
          approvedAt: null,
          approvedByAdminId: null,
        },
      },
      { new: true }
    );
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("PATCH /lab-partners/admin/:id/reject error:", err?.message || err);
    return res.status(500).json({ error: "Failed to reject partner" });
  }
});

module.exports = router;
