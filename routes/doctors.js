const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const Doctor = require("../models/Doctor");
const DoctorAppointment = require("../models/DoctorAppointment");

const router = express.Router();

const DEFAULT_SLOT_POOL = ["09:00 AM", "09:30 AM", "10:00 AM", "11:00 AM", "12:30 PM", "04:00 PM", "05:30 PM", "07:00 PM"];
const VALID_MODES = new Set(["video", "inperson", "call"]);

const DEFAULT_DOCTORS = [
  { name: "Dr. Riya Sharma", specialty: "General Physician", rating: 4.8, exp: 11, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 499, feeInPerson: 700, feeCall: 449, clinic: "CarePoint Clinic, Karol Bagh", tags: ["Fever", "Infection", "BP"] },
  { name: "Dr. Arjun Menon", specialty: "Cardiology", rating: 4.9, exp: 15, languages: ["English", "Hindi"], city: "Delhi", feeVideo: 899, feeInPerson: 1400, feeCall: 749, clinic: "Metro Heart Center, CP", tags: ["ECG", "BP", "Cholesterol"] },
  { name: "Dr. Kavya Patel", specialty: "Dermatology", rating: 4.7, exp: 9, languages: ["Hindi", "English", "Gujarati"], city: "Delhi", feeVideo: 599, feeInPerson: 850, feeCall: 499, clinic: "SkinHub, Rajouri Garden", tags: ["Acne", "Hair", "Allergy"] },
  { name: "Dr. Nikhil Bansal", specialty: "Pediatrics", rating: 4.8, exp: 12, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 549, feeInPerson: 780, feeCall: 469, clinic: "HappyKids Clinic, Pitampura", tags: ["Child Fever", "Vaccination"] },
  { name: "Dr. Sana Iqbal", specialty: "Gynecology", rating: 4.8, exp: 10, languages: ["Hindi", "English", "Urdu"], city: "Delhi", feeVideo: 699, feeInPerson: 1100, feeCall: 579, clinic: "WomenCare, Lajpat Nagar", tags: ["PCOS", "Pregnancy", "Hormones"] },
  { name: "Dr. Pranav Rao", specialty: "Orthopedics", rating: 4.6, exp: 13, languages: ["English", "Hindi"], city: "Delhi", feeVideo: 649, feeInPerson: 999, feeCall: 549, clinic: "Joint & Bone, Dwarka", tags: ["Back Pain", "Knee", "Sports"] },
];

let defaultDoctorsSeeded = false;

function asText(v) {
  return String(v == null ? "" : v).trim();
}

function parseISODateOnly(v) {
  const s = asText(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseSlotTo24h(slot) {
  const s = asText(slot).toUpperCase();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (m[3] === "AM") hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;
  return { hour, minute };
}

function buildAppointmentAt(date, slot) {
  const day = parseISODateOnly(date);
  const t = parseSlotTo24h(slot);
  if (!day || !t) return null;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), t.hour, t.minute, 0, 0));
}

function toDateLabel(date) {
  const d = parseISODateOnly(date);
  if (!d) return asText(date);
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

function getDoctorSlotPool(doctor, date, mode) {
  const d = asText(date);
  const m = asText(mode);
  const overrideForDate = doctor?.slotOverrides?.[d];
  if (overrideForDate && Array.isArray(overrideForDate[m]) && overrideForDate[m].length) {
    return overrideForDate[m].map(asText).filter(Boolean);
  }
  return DEFAULT_SLOT_POOL;
}

function mapDoctor(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email || "",
    phone: doc.phone || "",
    specialty: doc.specialty,
    rating: doc.rating,
    exp: doc.exp,
    experience: doc.experience || doc.exp || 0,
    languages: doc.languages || [],
    city: doc.city,
    feeVideo: doc.feeVideo,
    feeInPerson: doc.feeInPerson,
    feeCall: doc.feeCall,
    clinic: doc.clinic || doc.clinicName || "",
    clinicName: doc.clinicName || doc.clinic || "",
    tags: doc.tags || [],
    active: !!doc.active,
    availability: doc.availability || {},
    isPortalDoctor: !!doc.isPortalDoctor,
  };
}

function doctorTokenPayload(doctor) {
  return { role: "doctor", doctorId: doctor._id.toString(), email: doctor.email || "" };
}

function doctorAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Authorization header missing" });
  const token = authHeader.slice("Bearer ".length).trim();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.role !== "doctor" || !decoded?.doctorId) {
      return res.status(401).json({ error: "Doctor token required" });
    }
    req.doctorAuth = decoded;
    next();
  } catch (_) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function ensureDefaultDoctors() {
  if (defaultDoctorsSeeded) return;
  const count = await Doctor.countDocuments({});
  if (count === 0) await Doctor.insertMany(DEFAULT_DOCTORS);
  defaultDoctorsSeeded = true;
}

async function isSlotTaken({ doctorId, mode, date, slot, excludeAppointmentId = null }) {
  const rows = await DoctorAppointment.find({
    doctorId,
    mode,
    date,
    slot,
    ...(excludeAppointmentId ? { _id: { $ne: excludeAppointmentId } } : {}),
    status: { $in: ["pending_payment", "confirmed", "accepted"] },
  }).select("status holdExpiresAt").lean();

  const now = new Date();
  return rows.some((r) => r.status !== "pending_payment" || (r.holdExpiresAt && new Date(r.holdExpiresAt) > now));
}

router.post("/register", async (req, res) => {
  try {
    const body = req.body || {};
    const name = asText(body.fullName || body.name);
    const email = asText(body.email).toLowerCase();
    const phone = asText(body.phone);
    const password = asText(body.password);

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: "fullName/name, email, phone, and password are required" });
    }

    const exists = await Doctor.findOne({ email });
    if (exists) return res.status(409).json({ error: "Doctor already exists with this email" });

    const passwordHash = await bcrypt.hash(password, 10);
    const doctor = await Doctor.create({
      name,
      email,
      phone,
      passwordHash,
      specialty: asText(body.specialty) || "General Physician",
      exp: Number(body.experience || body.exp || 0) || 0,
      experience: Number(body.experience || body.exp || 0) || 0,
      clinicName: asText(body.clinicName || body.clinic),
      clinic: asText(body.clinicName || body.clinic),
      city: asText(body.city) || "Delhi",
      feeVideo: Number(body.feeVideo || 499),
      feeInPerson: Number(body.feeInPerson || 799),
      feeCall: Number(body.feeCall || body.feeVideo || 399),
      languages: Array.isArray(body.languages) && body.languages.length ? body.languages.map(asText).filter(Boolean) : ["English", "Hindi"],
      availability: body.availability && typeof body.availability === "object" ? body.availability : undefined,
      isPortalDoctor: true,
      active: true,
    });

    const token = jwt.sign(doctorTokenPayload(doctor), process.env.JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, doctor: mapDoctor(doctor) });
  } catch (err) {
    console.error("POST /doctors/register error:", err?.message || err);
    res.status(500).json({ error: "Failed to register doctor" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = asText(req.body?.email).toLowerCase();
    const password = asText(req.body?.password);
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const doctor = await Doctor.findOne({ email, active: true });
    if (!doctor || !doctor.passwordHash) return res.status(401).json({ error: "Invalid email or password" });
    const ok = await bcrypt.compare(password, doctor.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign(doctorTokenPayload(doctor), process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, doctor: mapDoctor(doctor) });
  } catch (err) {
    console.error("POST /doctors/login error:", err?.message || err);
    res.status(500).json({ error: "Failed to login doctor" });
  }
});

router.get("/me", doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.doctorAuth.doctorId).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    res.json({ doctor: mapDoctor(doctor) });
  } catch (err) {
    console.error("GET /doctors/me error:", err?.message || err);
    res.status(500).json({ error: "Failed to load doctor profile" });
  }
});

router.put("/me/availability", doctorAuth, async (req, res) => {
  try {
    const availability = req.body?.availability;
    if (!availability || typeof availability !== "object") {
      return res.status(400).json({ error: "availability object is required" });
    }
    const doctor = await Doctor.findByIdAndUpdate(
      req.doctorAuth.doctorId,
      { $set: { availability } },
      { new: true }
    );
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    res.json({ doctor: mapDoctor(doctor) });
  } catch (err) {
    console.error("PUT /doctors/me/availability error:", err?.message || err);
    res.status(500).json({ error: "Failed to update availability" });
  }
});

router.put("/me/fees", doctorAuth, async (req, res) => {
  try {
    const feeVideo = Number(req.body?.feeVideo);
    const feeInPerson = Number(req.body?.feeInPerson);
    const feeCall = Number(req.body?.feeCall);

    const patch = {};
    if (Number.isFinite(feeVideo) && feeVideo >= 0) patch.feeVideo = feeVideo;
    if (Number.isFinite(feeInPerson) && feeInPerson >= 0) patch.feeInPerson = feeInPerson;
    if (Number.isFinite(feeCall) && feeCall >= 0) patch.feeCall = feeCall;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "At least one valid fee is required" });

    const doctor = await Doctor.findByIdAndUpdate(req.doctorAuth.doctorId, { $set: patch }, { new: true });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    res.json({ doctor: mapDoctor(doctor) });
  } catch (err) {
    console.error("PUT /doctors/me/fees error:", err?.message || err);
    res.status(500).json({ error: "Failed to update fees" });
  }
});

router.get("/specialties", async (_req, res) => {
  try {
    await ensureDefaultDoctors();
    const specialties = await Doctor.distinct("specialty", { active: true });
    res.json(["All", ...specialties.filter(Boolean).sort((a, b) => a.localeCompare(b))]);
  } catch (err) {
    console.error("GET /doctors/specialties error:", err?.message || err);
    res.status(500).json({ error: "Failed to load specialties" });
  }
});

async function listDoctors(req, res) {
  try {
    await ensureDefaultDoctors();
    const q = asText(req.query.q || req.query.query);
    const specialty = asText(req.query.specialty);
    const city = asText(req.query.city);
    const mode = asText(req.query.mode || "video").toLowerCase();
    const sort = asText(req.query.sort || "soonest").toLowerCase();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const filter = { active: true };
    if (specialty && specialty.toLowerCase() !== "all") filter.specialty = specialty;
    if (city) filter.city = new RegExp(city, "i");
    if (q) {
      const re = new RegExp(q, "i");
      filter.$or = [{ name: re }, { specialty: re }, { tags: re }, { clinic: re }, { clinicName: re }];
    }

    let sortBy = { createdAt: -1 };
    if (sort === "rating") sortBy = { rating: -1, exp: -1, createdAt: -1 };
    if (sort === "fee") {
      if (mode === "inperson") sortBy = { feeInPerson: 1, rating: -1 };
      else if (mode === "call") sortBy = { feeCall: 1, rating: -1 };
      else sortBy = { feeVideo: 1, rating: -1 };
    }

    const [total, docs] = await Promise.all([
      Doctor.countDocuments(filter),
      Doctor.find(filter).sort(sortBy).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    res.json({ page, limit, total, hasMore: page * limit < total, doctors: docs.map(mapDoctor) });
  } catch (err) {
    console.error("GET /doctors/list error:", err?.message || err);
    res.status(500).json({ error: "Failed to load doctors" });
  }
}

router.get("/", listDoctors);
router.get("/list", listDoctors);

async function doctorSlots(req, res) {
  try {
    const doctorId = asText(req.params.id || req.params.doctorId);
    const mode = asText(req.query.mode || "video").toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(doctorId)) return res.status(400).json({ error: "Invalid doctor id" });
    if (!VALID_MODES.has(mode)) return res.status(400).json({ error: "mode must be video, inperson, or call" });

    const date = asText(req.query.date);
    const startDate = asText(req.query.startDate || date || new Date().toISOString().slice(0, 10));
    const days = date ? 1 : Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const start = parseISODateOnly(startDate);
    if (!start) return res.status(400).json({ error: "Invalid date/startDate format. Use YYYY-MM-DD" });

    const doctor = await Doctor.findOne({ _id: doctorId, active: true }).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    const dates = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const heldOrBooked = await DoctorAppointment.find({
      doctorId,
      mode,
      date: { $in: dates },
      status: { $in: ["pending_payment", "confirmed", "accepted"] },
    }).select("date slot status holdExpiresAt").lean();

    const now = new Date();
    const taken = new Map();
    for (const row of heldOrBooked) {
      const activeHold = row.status !== "pending_payment" || (row.holdExpiresAt && new Date(row.holdExpiresAt) > now);
      if (!activeHold) continue;
      const key = row.date;
      if (!taken.has(key)) taken.set(key, new Set());
      taken.get(key).add(row.slot);
    }

    const availability = dates.map((d) => {
      const slots = getDoctorSlotPool(doctor, d, mode);
      const occupied = taken.get(d) || new Set();
      const list = slots.map((s) => ({ slot: s, available: !occupied.has(s) }));
      return {
        date: d,
        dateLabel: toDateLabel(d),
        totalSlots: list.length,
        availableCount: list.filter((x) => x.available).length,
        slots: list,
      };
    });

    res.json({
      doctorId,
      mode,
      startDate: dates[0],
      days,
      availability,
      slots: days === 1 ? availability[0]?.slots || [] : undefined,
    });
  } catch (err) {
    console.error("GET /doctors/:id/slots error:", err?.message || err);
    res.status(500).json({ error: "Failed to load slots" });
  }
}

router.get("/:id/slots", doctorSlots);
router.get("/:doctorId/slots", doctorSlots);

router.get("/:id", async (req, res) => {
  try {
    const id = asText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid doctor id" });
    const doctor = await Doctor.findOne({ _id: id, active: true }).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    res.json({ doctor: mapDoctor(doctor) });
  } catch (err) {
    console.error("GET /doctors/:id error:", err?.message || err);
    res.status(500).json({ error: "Failed to load doctor profile" });
  }
});

router.post("/appointments", auth, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;
    const doctorId = asText(req.body?.doctorId);
    const mode = asText(req.body?.mode || "video").toLowerCase();
    const date = asText(req.body?.date);
    const slot = asText(req.body?.slot);
    const patientType = asText(req.body?.patientType || "self").toLowerCase();
    const patientName = asText(req.body?.patientName) || (patientType === "self" ? "Self" : "Family Member");
    const reason = asText(req.body?.reason) || "General consultation";
    const paymentMethod = asText(req.body?.paymentMethod || "");
    const paymentStatus = asText(req.body?.paymentStatus || "paid").toLowerCase();
    const transactionId = asText(req.body?.transactionId || "");

    if (!mongoose.Types.ObjectId.isValid(String(userId))) return res.status(401).json({ error: "Invalid user token" });
    if (!mongoose.Types.ObjectId.isValid(doctorId)) return res.status(400).json({ error: "Invalid doctorId" });
    if (!VALID_MODES.has(mode)) return res.status(400).json({ error: "mode must be video, inperson, or call" });
    if (!parseISODateOnly(date) || !slot) return res.status(400).json({ error: "date and slot are required" });

    const doctor = await Doctor.findById(doctorId);
    if (!doctor || !doctor.active) return res.status(404).json({ error: "Doctor not found" });
    if (!getDoctorSlotPool(doctor, date, mode).includes(slot)) {
      return res.status(400).json({ error: "Invalid slot for selected doctor/date/mode" });
    }
    if (await isSlotTaken({ doctorId, mode, date, slot })) {
      return res.status(409).json({ error: "Slot already booked" });
    }

    const appointmentAt = buildAppointmentAt(date, slot);
    if (!appointmentAt) return res.status(400).json({ error: "Invalid date/slot combination" });
    const fee = mode === "inperson" ? doctor.feeInPerson : mode === "call" ? doctor.feeCall : doctor.feeVideo;
    const isPaid = paymentStatus === "paid";

    const appointment = await DoctorAppointment.create({
      userId,
      doctorId,
      doctorName: doctor.name,
      specialty: doctor.specialty,
      mode,
      date,
      dateLabel: toDateLabel(date),
      slot,
      appointmentAt,
      patientType,
      patientName,
      reason,
      fee,
      paymentMethod,
      paymentStatus: isPaid ? "paid" : "pending",
      transactionId,
      amountPaid: isPaid ? fee : 0,
      status: isPaid ? "confirmed" : "pending_payment",
      holdExpiresAt: isPaid ? null : new Date(Date.now() + 10 * 60 * 1000),
      paymentRef: isPaid ? asText(req.body?.paymentRef) : "",
    });

    res.status(201).json({ appointment });
  } catch (err) {
    console.error("POST /doctors/appointments error:", err?.message || err);
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

module.exports = router;
