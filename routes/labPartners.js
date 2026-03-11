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
const HealthVault = require("../models/HealthVault");
const User = require("../models/User");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
let PARTNER_DOCS_DIR = path.join(process.cwd(), "uploads", "lab-partner-docs");
let LAB_REPORTS_DIR = path.join(process.cwd(), "uploads", "lab-reports");
const BASE_UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
PARTNER_DOCS_DIR = path.join(BASE_UPLOADS_DIR, "lab-partner-docs");
LAB_REPORTS_DIR = path.join(BASE_UPLOADS_DIR, "lab-reports");

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

const PARTNER_STATUS = {
  APPLIED: "applied",
  UNDER_REVIEW: "under_review",
  DOCS_PENDING: "docs_pending",
  VERIFICATION_IN_REVIEW: "verification_in_review",
  APPROVED: "approved",
  LIVE: "live",
  SUSPENDED: "suspended",
  REJECTED: "rejected",
};

function statusDisplay(status) {
  const s = asText(status).toLowerCase();
  return {
    [PARTNER_STATUS.APPLIED]: "Applied",
    [PARTNER_STATUS.UNDER_REVIEW]: "Under Review",
    [PARTNER_STATUS.DOCS_PENDING]: "Docs Pending",
    [PARTNER_STATUS.VERIFICATION_IN_REVIEW]: "Verification In Review",
    [PARTNER_STATUS.APPROVED]: "Approved",
    [PARTNER_STATUS.LIVE]: "Live",
    [PARTNER_STATUS.SUSPENDED]: "Suspended",
    [PARTNER_STATUS.REJECTED]: "Rejected",
  }[s] || "Under Review";
}

function syncKycStatusFromPartnerStatus(partnerStatus) {
  const s = asText(partnerStatus).toLowerCase();
  if (s === PARTNER_STATUS.LIVE || s === PARTNER_STATUS.APPROVED) return "verified";
  if (s === PARTNER_STATUS.REJECTED) return "rejected";
  if (s === PARTNER_STATUS.SUSPENDED) return "suspended";
  return "pending";
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
  const partnerStatus = asText(p.partnerStatus || "").toLowerCase() || PARTNER_STATUS.UNDER_REVIEW;
  return {
    id: p._id.toString(),
    name: p.name,
    email: p.email,
    phone: p.phone,
    organization: p.organization || "",
    city: p.city || "",
    labAddress: p.labAddress || "",
    serviceAreasText: p.serviceAreasText || "",
    areas: Array.isArray(p.areas) ? p.areas : [],
    homeCollectionAvailable: !!p.homeCollectionAvailable,
    active: !!p.active,
    partnerStatus,
    partnerStatusLabel: statusDisplay(partnerStatus),
    kycStatus: p.kycStatus || syncKycStatusFromPartnerStatus(partnerStatus),
    statusNotes: p.statusNotes || p.kycNotes || "",
    licenseNumber: p.licenseNumber || "",
    consentAccepted: !!p.consentAccepted,
    preferredLanguage: p.preferredLanguage || "hinglish",
    documents: Array.isArray(p.documents) ? p.documents : [],
    capabilities: Array.isArray(p.capabilities) ? p.capabilities : [],
    catalogProposals: Array.isArray(p.catalogProposals) ? p.catalogProposals : [],
    adminAuditTrail: Array.isArray(p.adminAuditTrail) ? p.adminAuditTrail : [],
    verification: p.verification || {},
    approvedAt: p.approvedAt || null,
    liveAt: p.liveAt || null,
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
  };
}

function flattenVerificationDocs(v = {}) {
  const out = [];
  const pushDocs = (section, key, rows) => {
    if (!Array.isArray(rows)) return;
    rows.forEach((d) => {
      if (!d) return;
      out.push({
        section,
        key,
        label: `${section} / ${key}`,
        fileName: asText(d.fileName),
        mimeType: asText(d.mimeType),
        fileSize: Number(d.fileSize || 0),
        fileUrl: asText(d.fileUrl),
        fileKey: asText(d.fileKey),
        docType: asText(d.docType),
      });
    });
  };

  const compliance = v.compliance || {};
  const banking = v.banking || {};
  const legalAgreement = v.legalAgreement || {};
  pushDocs("compliance", "stateRegistrationCertificate", compliance.stateRegistrationCertificate);
  pushDocs("compliance", "panCardCopy", compliance.panCardCopy);
  pushDocs("compliance", "gstCertificate", compliance.gstCertificate);
  pushDocs("compliance", "addressProof", compliance.addressProof);
  pushDocs("compliance", "authorizedSignatoryIdProof", compliance.authorizedSignatoryIdProof);
  pushDocs("compliance", "nablCertificate", compliance.nablCertificate);
  pushDocs("banking", "bankProof", banking.bankProof);
  pushDocs("legalAgreement", "signedPartnerAgreement", legalAgreement.signedPartnerAgreement);
  return out;
}

function appendAudit(partner, req, action, notes = "", meta = {}) {
  if (!partner) return;
  if (!Array.isArray(partner.adminAuditTrail)) partner.adminAuditTrail = [];
  partner.adminAuditTrail.unshift({
    id: nowId(),
    action: asText(action),
    notes: asText(notes),
    adminId: asText(req?.user?.adminId || req?.user?._id || "system"),
    adminType: asText(req?.user?.type || "admin"),
    meta: meta || {},
    at: new Date(),
  });
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

function nowId() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function getOrCreateVault(userId) {
  let vault = await HealthVault.findOne({ userId });
  if (vault) return vault;
  const user = await User.findById(userId).select("name dob gender").lean();
  const selfId = nowId();
  vault = await HealthVault.create({
    userId,
    members: [
      {
        id: selfId,
        relation: "Self",
        profile: {
          name: asText(user?.name),
          dob: asText(user?.dob),
          gender: asText(user?.gender),
        },
        reports: [],
      },
    ],
    activeMemberId: selfId,
  });
  return vault;
}

async function pushBookingReportToVault(booking) {
  const userId = booking?.userId;
  const fileKey = asText(booking?.reportFile?.fileKey);
  if (!userId || !fileKey) return;

  const vault = await getOrCreateVault(userId);
  const activeMemberId = asText(vault.activeMemberId) || asText(vault.members?.[0]?.id);
  const memberIndex = (vault.members || []).findIndex((m) => asText(m.id) === activeMemberId);
  if (memberIndex < 0) return;

  if (!Array.isArray(vault.members[memberIndex].reports)) vault.members[memberIndex].reports = [];
  const exists = vault.members[memberIndex].reports.some((r) => asText(r.fileKey) === fileKey);
  if (exists) return;

  vault.members[memberIndex].reports.push({
    id: nowId(),
    title: `${booking.items?.[0]?.name || "Lab Report"} (${booking.bookingId})`,
    type: "Lab Result",
    date: asText(booking.date) || new Date().toISOString().slice(0, 10),
    category: "Lab Report",
    fileName: asText(booking.reportFile?.fileName) || asText(booking.reportFileName) || "lab-report",
    mimeType: asText(booking.reportFile?.mimeType) || "application/octet-stream",
    fileSize: Number(booking.reportFile?.fileSize || 0),
    fileUrl: asText(booking.reportFile?.fileUrl),
    fileKey,
  });
  vault.markModified("members");
  await vault.save();
}

router.post("/register", upload.array("documents", 4), async (req, res) => {
  try {
    const name = asText(req.body?.name);
    const email = asText(req.body?.email).toLowerCase();
    const phone = asText(req.body?.phone);
    const city = asText(req.body?.city || "Noida");
    const labAddress = asText(req.body?.labAddress);
    const serviceAreasText = asText(req.body?.serviceAreas || req.body?.areas);
    const homeCollectionAvailable = ["yes", "true", "1"].includes(asText(req.body?.homeCollectionAvailable).toLowerCase());
    const licenseNumber = asText(req.body?.licenseNumber);
    const preferredLanguage = asText(req.body?.preferredLanguage || "hinglish").toLowerCase();
    const consentAccepted = ["yes", "true", "1"].includes(asText(req.body?.consentAccepted).toLowerCase());
    const areas = Array.isArray(req.body?.areas)
      ? req.body.areas.map(asText).filter(Boolean)
      : serviceAreasText
          .split(",")
          .map(asText)
          .filter(Boolean);

    if (!name || !email || !phone || !licenseNumber || !labAddress || !city) {
      return res.status(400).json({
        error: "name, email, phone, lab/diagnostic centre name, city, labAddress and licenseNumber are required",
      });
    }
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "Please upload any one basic proof document" });
    }
    if (!consentAccepted) {
      return res.status(400).json({ error: "Consent is required before submission" });
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

    const partner = await LabPartner.create({
      name,
      email,
      phone,
      city,
      labAddress,
      serviceAreasText,
      areas,
      organization: asText(req.body?.organization || req.body?.labName),
      homeCollectionAvailable,
      licenseNumber,
      consentAccepted: true,
      consentAcceptedAt: new Date(),
      preferredLanguage,
      documents,
      partnerStatus: PARTNER_STATUS.UNDER_REVIEW,
      kycStatus: "pending",
      statusNotes: "Applied via short public registration form",
      active: false,
    });

    return res.status(201).json({
      message: "Application submitted successfully. Status: Applied -> Under Review. This does not mean your lab is live.",
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
    const partnerStatus = asText(partner.partnerStatus || PARTNER_STATUS.UNDER_REVIEW).toLowerCase();
    if (partnerStatus !== PARTNER_STATUS.LIVE || !partner.active) {
      if ([PARTNER_STATUS.REJECTED, PARTNER_STATUS.SUSPENDED].includes(partnerStatus)) {
        return res.status(403).json({ error: "Account is not eligible for login. Contact support/admin." });
      }
      return res.status(403).json({
        error: `Verification pending. Current status: ${statusDisplay(partnerStatus)}. Lab is not live yet.`,
      });
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
    if (asText(partner.partnerStatus).toLowerCase() !== PARTNER_STATUS.LIVE || !partner.active) {
      return res.status(403).json({
        error: `Bookings are disabled until verification is completed and status is Live. Current status: ${statusDisplay(partner.partnerStatus)}.`,
      });
    }

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

async function savePartnerDocs(files = []) {
  const docsDir = ensureDir("docs");
  const out = [];
  for (const f of files) {
    const safeName = path.basename(f.originalname || "doc.bin").replace(/[^\w.\-]/g, "_");
    const key = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safeName}`;
    const abs = path.join(docsDir, key);
    await fs.promises.writeFile(abs, f.buffer);
    out.push({
      docType: asText(f.fieldname || "document"),
      fileName: f.originalname || safeName,
      mimeType: f.mimetype || "",
      fileSize: Number(f.size || 0),
      fileKey: key,
      fileUrl: `/uploads/lab-partner-docs/${key}`,
    });
  }
  return out;
}

function yesNoText(v) {
  const s = asText(v).toLowerCase();
  if (["yes", "no"].includes(s)) return s;
  return "";
}

function hasDocs(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

function canGoLive(partner) {
  const v = partner?.verification || {};
  const c = v.compliance || {};
  const b = v.banking || {};
  const o = v.operations || {};
  const t = v.techReportFlow || {};
  const l = v.legalAgreement || {};
  const k = v.verificationChecklist || {};

  return (
    hasDocs(c.stateRegistrationCertificate) &&
    hasDocs(c.panCardCopy) &&
    (hasDocs(c.gstCertificate) || yesNoText(c.gstNotApplicable) === "yes") &&
    hasDocs(c.addressProof) &&
    hasDocs(c.authorizedSignatoryIdProof) &&
    hasDocs(b.bankProof) &&
    asText(c.pathologistName) &&
    asText(c.pathologistRegistrationNumber) &&
    hasDocs(l.signedPartnerAgreement) &&
    !!o.homeCollectionCapabilityConfirmed &&
    yesNoText(t.canUploadSignedPdfReport) === "yes" &&
    !!t.reportUploadTestPassed &&
    !!k.docsCompleted &&
    !!k.bankVerified &&
    !!k.opsChecked &&
    !!k.agreementSigned
  );
}

router.patch("/bookings/:id/status", partnerAuth, upload.single("reportFile"), async (req, res) => {
  try {
    const partner = await LabPartner.findById(req.partnerAuth.partnerId).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    if (asText(partner.partnerStatus).toLowerCase() !== PARTNER_STATUS.LIVE || !partner.active) {
      return res.status(403).json({
        error: `Booking/report actions are disabled until status is Live. Current status: ${statusDisplay(partner.partnerStatus)}.`,
      });
    }

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
      await pushBookingReportToVault(booking);
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
      await pushBookingReportToVault(booking);
      return res.json({ booking: mapBooking(booking) });
    }

    return res.status(400).json({ error: "Unsupported action. Use accept/collect/processing/upload_report/report_ready/completed/cancel" });
  } catch (err) {
    console.error("PATCH /lab-partners/bookings/:id/status error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update booking status" });
  }
});

router.get("/catalog/capabilities", partnerAuth, async (req, res) => {
  try {
    const partner = await LabPartner.findById(req.partnerAuth.partnerId).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    return res.json({ capabilities: Array.isArray(partner.capabilities) ? partner.capabilities : [] });
  } catch (err) {
    console.error("GET /lab-partners/catalog/capabilities error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load capabilities" });
  }
});

router.get("/catalog/proposals", partnerAuth, async (req, res) => {
  try {
    const partner = await LabPartner.findById(req.partnerAuth.partnerId).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    return res.json({ proposals: Array.isArray(partner.catalogProposals) ? partner.catalogProposals : [] });
  } catch (err) {
    console.error("GET /lab-partners/catalog/proposals error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load proposals" });
  }
});

router.post("/catalog/proposals", partnerAuth, async (req, res) => {
  try {
    const partner = await LabPartner.findById(req.partnerAuth.partnerId);
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });

    const type = asText(req.body?.type);
    const name = asText(req.body?.name);
    const category = asText(req.body?.category);
    const price = Number(req.body?.price || 0);
    if (!type || !name || !category || !(price > 0)) {
      return res.status(400).json({ error: "type, name, category and valid price are required" });
    }

    const proposal = {
      id: nowId(),
      type,
      name,
      category,
      price,
      oldPrice: Number(req.body?.oldPrice || 0),
      reportTime: asText(req.body?.reportTime),
      fastingRequired: asText(req.body?.fastingRequired),
      sampleType: asText(req.body?.sampleType),
      description: asText(req.body?.description),
      includedParameters: asText(req.body?.includedParameters),
      includedTests: asText(req.body?.includedTests),
      customIncludesText: asText(req.body?.customIncludesText),
      homeCollection: asText(req.body?.homeCollection),
      sourcing: asText(req.body?.sourcing),
      available: asText(req.body?.available),
      serviceAreas: asText(req.body?.serviceAreas),
      notesForAdmin: asText(req.body?.notesForAdmin),
      status: "submitted_for_review",
      adminComment: "Pending admin review",
      reviewedAt: null,
    };

    if (!Array.isArray(partner.catalogProposals)) partner.catalogProposals = [];
    partner.catalogProposals.unshift(proposal);
    await partner.save();
    return res.status(201).json({ proposal, proposals: partner.catalogProposals });
  } catch (err) {
    console.error("POST /lab-partners/catalog/proposals error:", err?.message || err);
    return res.status(500).json({ error: "Failed to submit proposal" });
  }
});

router.get("/admin/:id/catalog/proposals", isAdmin, async (req, res) => {
  try {
    const partner = await LabPartner.findById(asText(req.params.id)).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    return res.json({ partner: mapPartner(partner), proposals: Array.isArray(partner.catalogProposals) ? partner.catalogProposals : [] });
  } catch (err) {
    console.error("GET /lab-partners/admin/:id/catalog/proposals error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load admin proposals" });
  }
});

router.patch("/admin/:id/catalog/proposals/:proposalId", isAdmin, async (req, res) => {
  try {
    const partner = await LabPartner.findById(asText(req.params.id));
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    const proposalId = asText(req.params.proposalId);
    const status = asText(req.body?.status).toLowerCase();
    const allowed = new Set(["draft", "submitted_for_review", "approved", "rejected", "needs_changes"]);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: "Invalid proposal status" });
    }

    const idx = (partner.catalogProposals || []).findIndex((p) => asText(p.id) === proposalId);
    if (idx < 0) return res.status(404).json({ error: "Proposal not found" });
    const row = partner.catalogProposals[idx];
    row.status = status;
    row.adminComment = asText(req.body?.adminComment || row.adminComment || "");
    row.reviewedAt = new Date();

    if (status === "approved" && ["yes", "true", "1"].includes(asText(req.body?.activateCapability).toLowerCase())) {
      if (!Array.isArray(partner.capabilities)) partner.capabilities = [];
      partner.capabilities.unshift({
        id: nowId(),
        type: asText(row.type).toLowerCase(),
        name: row.name,
        category: row.category,
        partnerPrice: Number(row.price || 0),
        oldPrice: Number(row.oldPrice || 0),
        reportTAT: row.reportTime || "",
        fastingRequired: row.fastingRequired || "",
        sampleType: row.sampleType || "",
        description: row.description || "",
        includedParameters: row.includedParameters || "",
        includedTests: row.includedTests || "",
        customIncludesText: row.customIncludesText || "",
        homeCollection: row.homeCollection || "",
        sourcing: row.sourcing || "",
        available: row.available || "yes",
        serviceAreas: row.serviceAreas || "",
        status: "active",
      });
    }

    appendAudit(
      partner,
      req,
      "catalog_proposal_review",
      asText(req.body?.adminComment || row.adminComment || ""),
      {
        proposalId,
        proposalName: row.name,
        status,
        activateCapability: ["yes", "true", "1"].includes(asText(req.body?.activateCapability).toLowerCase()),
      }
    );
    partner.markModified("catalogProposals");
    partner.markModified("capabilities");
    partner.markModified("adminAuditTrail");
    await partner.save();
    return res.json({ proposal: row, partner: mapPartner(partner) });
  } catch (err) {
    console.error("PATCH /lab-partners/admin/:id/catalog/proposals/:proposalId error:", err?.message || err);
    return res.status(500).json({ error: "Failed to review proposal" });
  }
});

router.put("/admin/:id/verification", isAdmin, upload.any(), async (req, res) => {
  try {
    const id = asText(req.params.id);
    const partner = await LabPartner.findById(id);
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });

    const docs = await savePartnerDocs(req.files || []);
    const docsByField = docs.reduce((acc, d) => {
      const k = asText(d.docType);
      if (!k) return acc;
      if (!acc[k]) acc[k] = [];
      acc[k].push(d);
      return acc;
    }, {});

    const v = partner.verification || {};
    const patch = {
      businessIdentity: {
        ...v.businessIdentity,
        legalEntityType: asText(req.body?.legalEntityType || v?.businessIdentity?.legalEntityType),
        authorizedSignatoryName: asText(req.body?.authorizedSignatoryName || v?.businessIdentity?.authorizedSignatoryName),
        authorizedSignatoryMobile: asText(req.body?.authorizedSignatoryMobile || v?.businessIdentity?.authorizedSignatoryMobile),
        authorizedSignatoryEmail: asText(req.body?.authorizedSignatoryEmail || v?.businessIdentity?.authorizedSignatoryEmail),
      },
      compliance: {
        ...v.compliance,
        stateRegistrationCertificate: [...(v?.compliance?.stateRegistrationCertificate || []), ...(docsByField.stateRegistrationCertificate || [])],
        panCardCopy: [...(v?.compliance?.panCardCopy || []), ...(docsByField.panCardCopy || [])],
        gstCertificate: [...(v?.compliance?.gstCertificate || []), ...(docsByField.gstCertificate || [])],
        addressProof: [...(v?.compliance?.addressProof || []), ...(docsByField.addressProof || [])],
        authorizedSignatoryIdProof: [...(v?.compliance?.authorizedSignatoryIdProof || []), ...(docsByField.authorizedSignatoryIdProof || [])],
        nablCertificate: [...(v?.compliance?.nablCertificate || []), ...(docsByField.nablCertificate || [])],
        gstNotApplicable: yesNoText(req.body?.gstNotApplicable || v?.compliance?.gstNotApplicable),
        pathologistName: asText(req.body?.pathologistName || v?.compliance?.pathologistName),
        pathologistRegistrationNumber: asText(req.body?.pathologistRegistrationNumber || v?.compliance?.pathologistRegistrationNumber),
      },
      operations: {
        ...v.operations,
        homeCollectionCapabilityConfirmed: ["yes", "true", "1"].includes(asText(req.body?.homeCollectionCapabilityConfirmed || v?.operations?.homeCollectionCapabilityConfirmed).toLowerCase()),
        ownPhlebotomistAvailable: yesNoText(req.body?.ownPhlebotomistAvailable || v?.operations?.ownPhlebotomistAvailable),
        phlebotomistCount: Number(req.body?.phlebotomistCount ?? v?.operations?.phlebotomistCount ?? 0),
        serviceRadiusKm: asText(req.body?.serviceRadiusKm || v?.operations?.serviceRadiusKm),
        sameDayCollectionAvailable: yesNoText(req.body?.sameDayCollectionAvailable || v?.operations?.sameDayCollectionAvailable),
        sundayAvailability: yesNoText(req.body?.sundayAvailability || v?.operations?.sundayAvailability),
        reportTat: asText(req.body?.reportTat || v?.operations?.reportTat),
        recollectionHandling: asText(req.body?.recollectionHandling || v?.operations?.recollectionHandling),
      },
      banking: {
        ...v.banking,
        accountHolderName: asText(req.body?.accountHolderName || v?.banking?.accountHolderName),
        bankName: asText(req.body?.bankName || v?.banking?.bankName),
        accountNumber: asText(req.body?.accountNumber || v?.banking?.accountNumber),
        ifscCode: asText(req.body?.ifscCode || v?.banking?.ifscCode),
        bankProof: [...(v?.banking?.bankProof || []), ...(docsByField.bankProof || [])],
      },
      techReportFlow: {
        ...v.techReportFlow,
        canUploadSignedPdfReport: yesNoText(req.body?.canUploadSignedPdfReport || v?.techReportFlow?.canUploadSignedPdfReport),
        canUpdateBookingStatusDigitally: yesNoText(req.body?.canUpdateBookingStatusDigitally || v?.techReportFlow?.canUpdateBookingStatusDigitally),
        canAcceptWhatsappBookings: yesNoText(req.body?.canAcceptWhatsappBookings || v?.techReportFlow?.canAcceptWhatsappBookings),
        usesLisSoftware: yesNoText(req.body?.usesLisSoftware || v?.techReportFlow?.usesLisSoftware),
        reportUploadTestPassed: ["yes", "true", "1"].includes(asText(req.body?.reportUploadTestPassed || v?.techReportFlow?.reportUploadTestPassed).toLowerCase()),
      },
      legalAgreement: {
        ...v.legalAgreement,
        signedPartnerAgreement: [...(v?.legalAgreement?.signedPartnerAgreement || []), ...(docsByField.signedPartnerAgreement || [])],
        consentForDocumentVerification: ["yes", "true", "1"].includes(asText(req.body?.consentForDocumentVerification || v?.legalAgreement?.consentForDocumentVerification).toLowerCase()),
        acceptanceOfCommercialTerms: ["yes", "true", "1"].includes(asText(req.body?.acceptanceOfCommercialTerms || v?.legalAgreement?.acceptanceOfCommercialTerms).toLowerCase()),
      },
      verificationChecklist: {
        ...v.verificationChecklist,
        docsCompleted: ["yes", "true", "1"].includes(asText(req.body?.docsCompleted || v?.verificationChecklist?.docsCompleted).toLowerCase()),
        bankVerified: ["yes", "true", "1"].includes(asText(req.body?.bankVerified || v?.verificationChecklist?.bankVerified).toLowerCase()),
        opsChecked: ["yes", "true", "1"].includes(asText(req.body?.opsChecked || v?.verificationChecklist?.opsChecked).toLowerCase()),
        agreementSigned: ["yes", "true", "1"].includes(asText(req.body?.agreementSigned || v?.verificationChecklist?.agreementSigned).toLowerCase()),
      },
    };

    partner.verification = patch;
    partner.partnerStatus = PARTNER_STATUS.VERIFICATION_IN_REVIEW;
    partner.kycStatus = "pending";
    partner.statusNotes = asText(req.body?.notes || "Step-2 verification updated");
    partner.active = false;
    appendAudit(
      partner,
      req,
      "verification_updated",
      partner.statusNotes,
      {
        uploadedDocs: (req.files || []).length,
        checklist: patch.verificationChecklist || {},
      }
    );
    partner.markModified("adminAuditTrail");
    await partner.save();
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("PUT /lab-partners/admin/:id/verification error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update verification details" });
  }
});

router.post("/admin/:id/activate-live", isAdmin, async (req, res) => {
  try {
    const id = asText(req.params.id);
    const partner = await LabPartner.findById(id);
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });

    if (!canGoLive(partner)) {
      partner.partnerStatus = PARTNER_STATUS.DOCS_PENDING;
      partner.kycStatus = "pending";
      partner.active = false;
      partner.statusNotes = asText(req.body?.notes || "Mandatory verification fields pending. No full verification = no activation.");
      appendAudit(
        partner,
        req,
        "activate_live_blocked",
        partner.statusNotes,
        { status: PARTNER_STATUS.DOCS_PENDING }
      );
      partner.markModified("adminAuditTrail");
      await partner.save();
      return res.status(409).json({
        error: "Mandatory verification checks are incomplete. No full verification = no activation.",
        partner: mapPartner(partner),
      });
    }

    partner.partnerStatus = PARTNER_STATUS.LIVE;
    partner.kycStatus = "verified";
    partner.active = true;
    partner.liveAt = new Date();
    partner.approvedAt = partner.approvedAt || new Date();
    partner.approvedByAdminId = req.user?.adminId || partner.approvedByAdminId;
    partner.statusNotes = asText(req.body?.notes || "Activated: all verification, bank, ops, report upload test and agreement checks passed.");
    appendAudit(
      partner,
      req,
      "partner_live_activated",
      partner.statusNotes,
      { status: PARTNER_STATUS.LIVE }
    );
    partner.markModified("adminAuditTrail");
    await partner.save();
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("POST /lab-partners/admin/:id/activate-live error:", err?.message || err);
    return res.status(500).json({ error: "Failed to activate partner" });
  }
});

router.get("/admin/pending", isAdmin, async (req, res) => {
  try {
    const rows = await LabPartner.find({
      $or: [
        {
          partnerStatus: {
            $in: [
              PARTNER_STATUS.APPLIED,
              PARTNER_STATUS.UNDER_REVIEW,
              PARTNER_STATUS.DOCS_PENDING,
              PARTNER_STATUS.VERIFICATION_IN_REVIEW,
            ],
          },
        },
        { partnerStatus: { $exists: false }, kycStatus: "pending" },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();
    return res.json({ partners: rows.map(mapPartner) });
  } catch (err) {
    console.error("GET /lab-partners/admin/pending error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load pending partners" });
  }
});

router.get("/admin/all", isAdmin, async (req, res) => {
  try {
    const status = asText(req.query?.status).toLowerCase();
    const q = asText(req.query?.q).toLowerCase();
    const filter = {};
    if (status && status !== "all") filter.partnerStatus = status;
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { organization: { $regex: q, $options: "i" } },
        { city: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }
    const rows = await LabPartner.find(filter).sort({ createdAt: -1 }).limit(1000).lean();
    return res.json({ partners: rows.map(mapPartner) });
  } catch (err) {
    console.error("GET /lab-partners/admin/all error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load all partners" });
  }
});

router.get("/admin/:id/documents", isAdmin, async (req, res) => {
  try {
    const partner = await LabPartner.findById(asText(req.params.id)).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    const basicDocs = Array.isArray(partner.documents)
      ? partner.documents.map((d) => ({
          section: "basic",
          key: asText(d.docType || "document"),
          label: `basic / ${asText(d.docType || "document")}`,
          fileName: asText(d.fileName),
          mimeType: asText(d.mimeType),
          fileSize: Number(d.fileSize || 0),
          fileUrl: asText(d.fileUrl),
          fileKey: asText(d.fileKey),
          docType: asText(d.docType),
        }))
      : [];
    const verificationDocs = flattenVerificationDocs(partner.verification || {});
    return res.json({
      partner: mapPartner(partner),
      documents: [...basicDocs, ...verificationDocs],
    });
  } catch (err) {
    console.error("GET /lab-partners/admin/:id/documents error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load partner documents" });
  }
});

router.get("/admin/:id/audit", isAdmin, async (req, res) => {
  try {
    const partner = await LabPartner.findById(asText(req.params.id)).lean();
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    return res.json({
      partner: mapPartner(partner),
      audit: Array.isArray(partner.adminAuditTrail) ? partner.adminAuditTrail : [],
    });
  } catch (err) {
    console.error("GET /lab-partners/admin/:id/audit error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load partner audit trail" });
  }
});

router.patch("/admin/:id/approve", isAdmin, async (req, res) => {
  try {
    const id = asText(req.params.id);
    const partner = await LabPartner.findById(id);
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    partner.partnerStatus = PARTNER_STATUS.APPROVED;
    partner.kycStatus = "verified";
    partner.active = false;
    partner.statusNotes = asText(req.body?.notes || "Approved. Pending go-live checks.");
    partner.approvedAt = new Date();
    partner.approvedByAdminId = req.user?.adminId || null;
    appendAudit(partner, req, "partner_approved", partner.statusNotes, { status: PARTNER_STATUS.APPROVED });
    partner.markModified("adminAuditTrail");
    await partner.save();
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("PATCH /lab-partners/admin/:id/approve error:", err?.message || err);
    return res.status(500).json({ error: "Failed to approve partner" });
  }
});

router.patch("/admin/:id/reject", isAdmin, async (req, res) => {
  try {
    const id = asText(req.params.id);
    const partner = await LabPartner.findById(id);
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    partner.partnerStatus = PARTNER_STATUS.REJECTED;
    partner.kycStatus = "rejected";
    partner.active = false;
    partner.statusNotes = asText(req.body?.notes || "Rejected by admin");
    partner.approvedAt = null;
    partner.liveAt = null;
    partner.approvedByAdminId = null;
    appendAudit(partner, req, "partner_rejected", partner.statusNotes, { status: PARTNER_STATUS.REJECTED });
    partner.markModified("adminAuditTrail");
    await partner.save();
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("PATCH /lab-partners/admin/:id/reject error:", err?.message || err);
    return res.status(500).json({ error: "Failed to reject partner" });
  }
});

router.patch("/admin/:id/status", isAdmin, async (req, res) => {
  try {
    const id = asText(req.params.id);
    const status = asText(req.body?.status).toLowerCase();
    const allowed = new Set(Object.values(PARTNER_STATUS));
    if (!allowed.has(status)) {
      return res.status(400).json({ error: "Invalid status. Use Applied/Under Review/Docs Pending/Verification In Review/Approved/Live/Suspended/Rejected." });
    }
    const partner = await LabPartner.findById(id);
    if (!partner) return res.status(404).json({ error: "Lab partner not found" });
    partner.partnerStatus = status;
    partner.kycStatus = syncKycStatusFromPartnerStatus(status);
    partner.statusNotes = asText(req.body?.notes || "");
    if (status === PARTNER_STATUS.LIVE) {
      partner.active = true;
      partner.liveAt = new Date();
    } else if ([PARTNER_STATUS.REJECTED, PARTNER_STATUS.SUSPENDED, PARTNER_STATUS.DOCS_PENDING, PARTNER_STATUS.UNDER_REVIEW, PARTNER_STATUS.VERIFICATION_IN_REVIEW, PARTNER_STATUS.APPROVED, PARTNER_STATUS.APPLIED].includes(status)) {
      partner.active = false;
      partner.liveAt = null;
    }
    appendAudit(partner, req, "partner_status_updated", partner.statusNotes, { status });
    partner.markModified("adminAuditTrail");
    await partner.save();
    return res.json({ partner: mapPartner(partner) });
  } catch (err) {
    console.error("PATCH /lab-partners/admin/:id/status error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update partner status" });
  }
});

module.exports = router;
