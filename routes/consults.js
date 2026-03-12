const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const Doctor = require("../models/Doctor");
const DoctorAppointment = require("../models/DoctorAppointment");
const DoctorNotification = require("../models/DoctorNotification");
const upload = require("../utils/upload");

const router = express.Router();

const VALID_MODES = new Set(["video", "inperson", "call"]);
const HOLD_MINUTES = Number(process.env.CONSULT_HOLD_MINUTES || 10);

function asText(v) {
  return String(v == null ? "" : v).trim();
}

function normalizeMode(mode) {
  const m = asText(mode).toLowerCase();
  if (m === "audio" || m === "call") return "call";
  if (m === "in-person" || m === "inperson") return "inperson";
  return "video";
}

function computePlatformBand(fee) {
  const f = Number(fee || 0);
  if (f <= 500) return { bandKey: "0_500", serviceFee: 19, gstLabel: "+ applicable GST", manualApprovalRequired: false };
  if (f <= 1000) return { bandKey: "501_1000", serviceFee: 39, gstLabel: "+ applicable GST", manualApprovalRequired: false };
  if (f <= 1500) return { bandKey: "1001_1500", serviceFee: 59, gstLabel: "+ applicable GST", manualApprovalRequired: false };
  if (f <= 2000) return { bandKey: "1501_2000", serviceFee: 79, gstLabel: "+ applicable GST", manualApprovalRequired: false };
  return { bandKey: "2001_plus", serviceFee: 0, gstLabel: "Manual commercial approval required", manualApprovalRequired: true };
}

function bundledFee(baseFee) {
  const base = Number(baseFee || 0);
  const band = computePlatformBand(base);
  return band.manualApprovalRequired ? base : base + Number(band.serviceFee || 0);
}

function parseISODateOnly(v) {
  const s = asText(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseSlotTo24h(slot) {
  const m = asText(slot).toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  hour = m[3] === "AM" ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
  return { hour, minute };
}

function buildAppointmentAt(date, slot) {
  const day = parseISODateOnly(date);
  const t = parseSlotTo24h(slot);
  if (!day || !t) return null;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), t.hour, t.minute, 0, 0));
}

function isPastSlot(date, slot) {
  const appointmentAt = buildAppointmentAt(date, slot);
  if (!appointmentAt) return true;
  return appointmentAt.getTime() < Date.now();
}

function toDateLabel(date) {
  const d = parseISODateOnly(date);
  if (!d) return asText(date);
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

function doctorAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Authorization header missing" });
  const token = authHeader.slice("Bearer ".length).trim();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.role !== "doctor" || !decoded?.doctorId) return res.status(401).json({ error: "Doctor token required" });
    req.doctorAuth = decoded;
    next();
  } catch (_) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function slotIsTaken({ doctorId, date, slot, mode, ignoreId }) {
  const rows = await DoctorAppointment.find({
    doctorId,
    date,
    slot,
    mode,
    ...(ignoreId ? { _id: { $ne: ignoreId } } : {}),
    status: { $in: ["pending_payment", "confirmed", "accepted"] },
  }).select("status holdExpiresAt").lean();
  const now = new Date();
  return rows.some((r) => r.status !== "pending_payment" || (r.holdExpiresAt && new Date(r.holdExpiresAt) > now));
}

function mapConsultDoctor(c) {
  return {
    id: c._id.toString(),
    doctorId: c.doctorId?.toString ? c.doctorId.toString() : asText(c.doctorId),
    doctorName: c.doctorName,
    specialty: c.specialty,
    mode: c.mode,
    date: c.date,
    dateLabel: c.dateLabel,
    slot: c.slot,
    patientType: c.patientType,
    patientName: c.patientName,
    reason: c.reason,
    fee: c.fee,
    status: c.status,
    paymentMethod: c.paymentMethod || "",
    paymentStatus: c.paymentStatus || "pending",
    transactionId: c.transactionId || "",
    paymentRef: c.paymentRef || "",
    bundledPriceLabel: c.bundledPriceLabel || "",
    prescription: c.prescription || {},
    clinicLocation: c.clinicLocationSnapshot || {},
    locationUnlockedForPatient: !!c.locationUnlockedForPatient,
    holdExpiresAt: c.holdExpiresAt || null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function mapConsultUser(c) {
  const exactAllowed = !!c.locationUnlockedForPatient || c.mode !== "inperson";
  const loc = c.clinicLocationSnapshot || {};
  return {
    id: c._id.toString(),
    doctorId: c.doctorId?.toString ? c.doctorId.toString() : asText(c.doctorId),
    doctorName: c.doctorName,
    specialty: c.specialty,
    mode: c.mode,
    date: c.date,
    dateLabel: c.dateLabel,
    slot: c.slot,
    patientType: c.patientType,
    patientName: c.patientName,
    reason: c.reason,
    fee: c.fee,
    bundledPriceLabel: c.bundledPriceLabel || `Consultation Rs ${c.fee || 0}`,
    status: c.status,
    paymentMethod: c.paymentMethod || "",
    paymentStatus: c.paymentStatus || "pending",
    transactionId: c.transactionId || "",
    paymentRef: c.paymentRef || "",
    holdExpiresAt: c.holdExpiresAt || null,
    prescription: c.prescription || {},
    clinicLocation: {
      clinicName: asText(loc.clinicName),
      locality: asText(loc.locality),
      fullAddress: exactAllowed ? asText(loc.fullAddress) : "",
      pincode: exactAllowed ? asText(loc.pincode) : "",
      coordinates: exactAllowed ? loc.coordinates || {} : {},
      exactUnlocked: exactAllowed,
    },
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

router.post("/create", auth, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;
    const doctorId = asText(req.body?.doctorId);
    const mode = normalizeMode(req.body?.mode || "video");
    const date = asText(req.body?.date);
    const slot = asText(req.body?.slot);

    if (!mongoose.Types.ObjectId.isValid(String(userId))) return res.status(401).json({ error: "Invalid user token" });
    if (!mongoose.Types.ObjectId.isValid(doctorId)) return res.status(400).json({ error: "Invalid doctorId" });
    if (!VALID_MODES.has(mode)) return res.status(400).json({ error: "mode must be video, inperson, or call" });
    if (!parseISODateOnly(date) || !slot) return res.status(400).json({ error: "date and slot are required" });
    if (isPastSlot(date, slot)) return res.status(409).json({ error: "Cannot book past slots" });

    const doctor = await Doctor.findOne({ _id: doctorId, active: true });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    if (doctor.verificationStatus && doctor.verificationStatus !== "approved") {
      return res.status(409).json({ error: "Doctor profile is not approved for booking yet" });
    }
    if (mode === "inperson" && !doctor?.consultModes?.inPerson) {
      return res.status(409).json({ error: "In-person consultation is not enabled for this doctor" });
    }
    if (mode === "video" && !doctor?.consultModes?.video) {
      return res.status(409).json({ error: "Video consultation is not enabled for this doctor" });
    }
    if (mode === "call" && !doctor?.consultModes?.audio) {
      return res.status(409).json({ error: "Audio consultation is not enabled for this doctor" });
    }
    if (await slotIsTaken({ doctorId, date, slot, mode })) {
      return res.status(409).json({ error: "Slot already booked" });
    }

    const appointmentAt = buildAppointmentAt(date, slot);
    if (!appointmentAt) return res.status(400).json({ error: "Invalid date/slot format" });
    const baseFee = mode === "inperson" ? Number(doctor.feeInPerson || 0) : mode === "call" ? Number(doctor.feeCall || 0) : Number(doctor.feeVideo || 0);
    const platformBand = doctor.platformFeeBand?.bandKey ? doctor.platformFeeBand : computePlatformBand(baseFee);
    const fee = bundledFee(baseFee);
    const paymentRef = `CONSULT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const consult = await DoctorAppointment.create({
      userId,
      doctorId,
      doctorName: doctor.name,
      specialty: doctor.specialty,
      mode,
      date,
      dateLabel: toDateLabel(date),
      slot,
      appointmentAt,
      patientType: asText(req.body?.patientType || "self").toLowerCase(),
      patientName: asText(req.body?.patientName) || "Self",
      reason: asText(req.body?.reason) || "General consultation",
      fee,
      bundledPriceLabel: mode === "inperson" ? `In-Person Visit Rs ${fee}` : `Consultation Rs ${fee}`,
      platformFeeBandApplied: platformBand,
      paymentMethod: asText(req.body?.paymentMethod || ""),
      paymentStatus: "pending",
      paymentRef,
      status: "pending_payment",
      holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000),
      clinicLocationSnapshot: {
        clinicName: asText(doctor?.clinicProfile?.name || doctor?.clinicName || doctor?.clinic || ""),
        locality: asText(doctor?.clinicProfile?.locality || doctor?.city || ""),
        fullAddress: asText(doctor?.clinicProfile?.fullAddress || ""),
        pincode: asText(doctor?.clinicProfile?.pincode || ""),
        coordinates: doctor?.clinicProfile?.coordinates || {},
      },
      locationUnlockedForPatient: false,
    });

    DoctorNotification.create({
      doctorId,
      type: "booking_created",
      title: `New ${mode === "inperson" ? "In-person" : mode === "video" ? "Video" : "Audio"} booking`,
      message: `${asText(req.body?.patientName) || "Patient"} booked ${date} at ${slot}. Booking ID ${consult._id.toString().slice(-6)}`,
      bookingId: consult._id,
      meta: { mode, date, slot },
    }).catch(() => {});

    res.status(201).json({
      consult: mapConsultUser(consult),
      paymentIntent: {
        paymentRef,
        amount: fee,
        currency: "INR",
        methods: ["upi", "card", "netbanking"],
        holdExpiresAt: consult.holdExpiresAt,
      },
    });
  } catch (err) {
    console.error("POST /consults/create error:", err?.message || err);
    res.status(500).json({ error: "Failed to create consult hold" });
  }
});

router.get("/my", auth, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;
    if (!mongoose.Types.ObjectId.isValid(String(userId))) return res.status(401).json({ error: "Invalid user token" });
    const status = asText(req.query.status || "all").toLowerCase();
    const q = { userId };
    if (status !== "all") q.status = status;
    const rows = await DoctorAppointment.find(q).sort({ appointmentAt: 1, createdAt: -1 }).limit(200).lean();
    res.json({ consults: rows.map(mapConsultUser) });
  } catch (err) {
    console.error("GET /consults/my error:", err?.message || err);
    res.status(500).json({ error: "Failed to load consults" });
  }
});

router.get("/doctor", doctorAuth, async (req, res) => {
  try {
    const doctorId = req.doctorAuth.doctorId;
    const status = asText(req.query.status || "all").toLowerCase();
    const q = { doctorId };
    if (status !== "all") q.status = status;
    const rows = await DoctorAppointment.find(q).sort({ appointmentAt: 1, createdAt: -1 }).limit(300).lean();
    res.json({ consults: rows.map(mapConsultDoctor) });
  } catch (err) {
    console.error("GET /consults/doctor error:", err?.message || err);
    res.status(500).json({ error: "Failed to load doctor consults" });
  }
});

router.patch("/:id/status", doctorAuth, async (req, res) => {
  try {
    const id = asText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid consult id" });

    const consult = await DoctorAppointment.findOne({ _id: id, doctorId: req.doctorAuth.doctorId });
    if (!consult) return res.status(404).json({ error: "Consult not found" });

    const action = asText(req.body?.action || req.body?.status).toLowerCase();
    if (!action) return res.status(400).json({ error: "action is required" });

    if (action === "accept") {
      if (!["confirmed", "pending_payment"].includes(consult.status)) {
        return res.status(409).json({ error: "Consult cannot be accepted in current state" });
      }
      if (consult.status === "pending_payment") {
        return res.status(409).json({ error: "Payment pending. Verify payment first." });
      }
      consult.status = "accepted";
      await consult.save();
      return res.json({ consult: mapConsultDoctor(consult) });
    }

    if (action === "complete" || action === "completed") {
      if (!["accepted", "confirmed"].includes(consult.status)) {
        return res.status(409).json({ error: "Consult cannot be completed in current state" });
      }
      consult.status = "completed";
      await consult.save();
      DoctorNotification.create({
        doctorId: consult.doctorId,
        type: "booking_completed",
        title: "Consultation marked completed",
        message: `Booking ${consult._id.toString().slice(-6)} marked completed`,
        bookingId: consult._id,
      }).catch(() => {});
      return res.json({ consult: mapConsultDoctor(consult) });
    }

    if (action === "cancel" || action === "cancelled" || action === "reject") {
      consult.status = action === "reject" ? "rejected" : "cancelled";
      consult.cancelReason = asText(req.body?.reason || req.body?.cancelReason || "Cancelled by doctor");
      consult.cancelledAt = new Date();
      await consult.save();
      DoctorNotification.create({
        doctorId: consult.doctorId,
        type: "booking_cancelled",
        title: "Consultation cancelled",
        message: `${consult.patientName || "Patient"} booking ${consult._id.toString().slice(-6)} was cancelled`,
        bookingId: consult._id,
      }).catch(() => {});
      return res.json({ consult: mapConsultDoctor(consult) });
    }

    if (action === "reschedule") {
      const date = asText(req.body?.date);
      const slot = asText(req.body?.slot);
      const mode = normalizeMode(req.body?.mode || consult.mode);
      if (!parseISODateOnly(date) || !slot) return res.status(400).json({ error: "date and slot are required for reschedule" });
      if (!VALID_MODES.has(mode)) return res.status(400).json({ error: "Invalid mode" });
      if (isPastSlot(date, slot)) return res.status(409).json({ error: "Cannot reschedule to past slots" });

      const taken = await slotIsTaken({ doctorId: consult.doctorId, date, slot, mode, ignoreId: consult._id });
      if (taken) return res.status(409).json({ error: "Requested slot already booked" });

      const appointmentAt = buildAppointmentAt(date, slot);
      if (!appointmentAt) return res.status(400).json({ error: "Invalid date/slot format" });

      consult.mode = mode;
      consult.date = date;
      consult.dateLabel = toDateLabel(date);
      consult.slot = slot;
      consult.appointmentAt = appointmentAt;
      await consult.save();
      return res.json({ consult: mapConsultDoctor(consult) });
    }

    return res.status(400).json({ error: "Unsupported action. Use accept/reschedule/complete/cancel/reject" });
  } catch (err) {
    console.error("PATCH /consults/:id/status error:", err?.message || err);
    res.status(500).json({ error: "Failed to update consult status" });
  }
});

router.patch("/:id/prescription", doctorAuth, upload.single("prescription"), async (req, res) => {
  try {
    const id = asText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid consult id" });
    const consult = await DoctorAppointment.findOne({ _id: id, doctorId: req.doctorAuth.doctorId });
    if (!consult) return res.status(404).json({ error: "Consult not found" });
    if (!["accepted", "completed", "confirmed"].includes(consult.status)) {
      return res.status(409).json({ error: "Prescription can be uploaded only for active/completed consults" });
    }
    const fileUrl = req.file?.location || req.file?.path || "";
    if (!fileUrl) return res.status(400).json({ error: "Prescription file is required" });
    consult.prescription = {
      fileUrl,
      fileName: asText(req.file?.originalname || "prescription"),
      notes: asText(req.body?.notes || ""),
      uploadedAt: new Date(),
      uploadedByDoctorId: req.doctorAuth.doctorId,
    };
    await consult.save();
    return res.json({ consult: mapConsultDoctor(consult) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to upload prescription" });
  }
});

module.exports = router;
