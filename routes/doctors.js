const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const Doctor = require("../models/Doctor");
const DoctorAppointment = require("../models/DoctorAppointment");

const router = express.Router();

const DEFAULT_SLOT_POOL = ["09:00 AM", "09:30 AM", "10:00 AM", "11:00 AM", "12:30 PM", "04:00 PM", "05:30 PM", "07:00 PM"];
const VALID_MODES = new Set(["video", "inperson", "call"]);
const VALID_APPOINTMENT_STATUS = new Set(["confirmed", "cancelled", "completed"]);

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

function asUserId(req) {
  return req?.user?.userId || req?.user?._id || null;
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
  const meridian = m[3];
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (meridian === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  return { hour, minute };
}

function buildAppointmentAt(date, slot) {
  const day = parseISODateOnly(date);
  const t = parseSlotTo24h(slot);
  if (!day || !t) return null;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), t.hour, t.minute, 0, 0));
}

function toDateLabel(date) {
  const parsed = parseISODateOnly(date);
  if (!parsed) return asText(date);
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(parsed);
  } catch (_) {
    return asText(date);
  }
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
    specialty: doc.specialty,
    rating: doc.rating,
    exp: doc.exp,
    languages: doc.languages || [],
    city: doc.city,
    feeVideo: doc.feeVideo,
    feeInPerson: doc.feeInPerson,
    feeCall: doc.feeCall,
    clinic: doc.clinic,
    tags: doc.tags || [],
    active: !!doc.active,
  };
}

function mapAppointment(a) {
  return {
    id: a._id.toString(),
    doctorId: a.doctorId?.toString ? a.doctorId.toString() : asText(a.doctorId),
    doctorName: a.doctorName,
    specialty: a.specialty,
    mode: a.mode,
    date: a.date,
    dateLabel: a.dateLabel,
    slot: a.slot,
    patientType: a.patientType,
    patientName: a.patientName,
    reason: a.reason,
    fee: a.fee,
    status: a.status,
    cancelledAt: a.cancelledAt || null,
    cancelReason: a.cancelReason || "",
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

async function ensureDefaultDoctors() {
  if (defaultDoctorsSeeded) return;
  const count = await Doctor.countDocuments({});
  if (count === 0) {
    await Doctor.insertMany(DEFAULT_DOCTORS);
  }
  defaultDoctorsSeeded = true;
}

router.get("/specialties", async (_req, res) => {
  try {
    await ensureDefaultDoctors();
    const specialties = await Doctor.distinct("specialty", { active: true });
    const out = ["All", ...specialties.filter(Boolean).sort((a, b) => a.localeCompare(b))];
    res.json(out);
  } catch (err) {
    console.error("GET /doctors/specialties error:", err?.message || err);
    res.status(500).json({ error: "Failed to load specialties" });
  }
});

router.get("/", async (req, res) => {
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
      filter.$or = [{ name: re }, { specialty: re }, { tags: re }, { clinic: re }];
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

    res.json({
      page,
      limit,
      total,
      hasMore: page * limit < total,
      doctors: docs.map(mapDoctor),
    });
  } catch (err) {
    console.error("GET /doctors error:", err?.message || err);
    res.status(500).json({ error: "Failed to load doctors" });
  }
});

router.get("/:doctorId", async (req, res) => {
  try {
    await ensureDefaultDoctors();
    const doctorId = asText(req.params.doctorId);
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({ error: "Invalid doctorId" });
    }
    const doc = await Doctor.findOne({ _id: doctorId, active: true }).lean();
    if (!doc) return res.status(404).json({ error: "Doctor not found" });
    res.json(mapDoctor(doc));
  } catch (err) {
    console.error("GET /doctors/:doctorId error:", err?.message || err);
    res.status(500).json({ error: "Failed to load doctor profile" });
  }
});

router.get("/:doctorId/slots", async (req, res) => {
  try {
    const doctorId = asText(req.params.doctorId);
    const mode = asText(req.query.mode || "video").toLowerCase();
    if (!VALID_MODES.has(mode)) {
      return res.status(400).json({ error: "mode must be one of video, inperson, call" });
    }
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({ error: "Invalid doctorId" });
    }

    await ensureDefaultDoctors();
    const doctor = await Doctor.findOne({ _id: doctorId, active: true }).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const startDateInput = asText(req.query.startDate || req.query.date);
    const startDate = startDateInput ? parseISODateOnly(startDateInput) : parseISODateOnly(new Date().toISOString().slice(0, 10));
    if (!startDate) return res.status(400).json({ error: "Invalid startDate/date, expected YYYY-MM-DD" });

    const dates = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(startDate);
      d.setUTCDate(startDate.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const taken = await DoctorAppointment.find({
      doctorId,
      mode,
      date: { $in: dates },
      status: "confirmed",
    }).select("date slot").lean();

    const takenByDate = new Map();
    for (const row of taken) {
      const key = `${row.date}`;
      if (!takenByDate.has(key)) takenByDate.set(key, new Set());
      takenByDate.get(key).add(row.slot);
    }

    const result = dates.map((date) => {
      const allSlots = getDoctorSlotPool(doctor, date, mode);
      const occupied = takenByDate.get(date) || new Set();
      const slots = allSlots.map((slot) => ({ slot, available: !occupied.has(slot) }));
      return {
        date,
        dateLabel: toDateLabel(date),
        totalSlots: allSlots.length,
        availableCount: slots.filter((s) => s.available).length,
        slots,
      };
    });

    res.json({
      doctorId,
      mode,
      startDate: dates[0],
      days,
      availability: result,
    });
  } catch (err) {
    console.error("GET /doctors/:doctorId/slots error:", err?.message || err);
    res.status(500).json({ error: "Failed to load slots" });
  }
});

router.post("/appointments", auth, async (req, res) => {
  try {
    const userIdRaw = asUserId(req);
    if (!userIdRaw || !mongoose.Types.ObjectId.isValid(String(userIdRaw))) {
      return res.status(401).json({ error: "Invalid user in auth token" });
    }
    const userId = new mongoose.Types.ObjectId(String(userIdRaw));

    const body = req.body || {};
    const doctorId = asText(body.doctorId);
    const mode = asText(body.mode || "video").toLowerCase();
    const date = asText(body.date);
    const slot = asText(body.slot);
    const patientType = asText(body.patientType || "self").toLowerCase();
    const patientName = asText(body.patientName) || (patientType === "self" ? "Self" : "Family Member");
    const reason = asText(body.reason) || "General consultation";

    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({ error: "Invalid doctorId" });
    }
    if (!VALID_MODES.has(mode)) {
      return res.status(400).json({ error: "mode must be one of video, inperson, call" });
    }
    if (!parseISODateOnly(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    if (!slot) return res.status(400).json({ error: "slot is required" });
    if (!["self", "family", "new"].includes(patientType)) {
      return res.status(400).json({ error: "patientType must be self, family, or new" });
    }

    await ensureDefaultDoctors();
    const doctor = await Doctor.findOne({ _id: doctorId, active: true });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    const slotPool = getDoctorSlotPool(doctor, date, mode);
    if (!slotPool.includes(slot)) {
      return res.status(400).json({ error: "Invalid slot for selected doctor/date/mode" });
    }

    const appointmentAt = buildAppointmentAt(date, slot);
    if (!appointmentAt) {
      return res.status(400).json({ error: "Invalid date/slot combination" });
    }

    const existing = await DoctorAppointment.findOne({
      doctorId,
      date,
      slot,
      mode,
      status: "confirmed",
    }).lean();
    if (existing) {
      return res.status(409).json({ error: "Slot already booked. Please choose another slot." });
    }

    const fee = mode === "inperson" ? doctor.feeInPerson : mode === "call" ? doctor.feeCall : doctor.feeVideo;
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
      status: "confirmed",
    });

    res.status(201).json({ appointment: mapAppointment(appointment) });
  } catch (err) {
    console.error("POST /doctors/appointments error:", err?.message || err);
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

router.get("/appointments/me", auth, async (req, res) => {
  try {
    const userIdRaw = asUserId(req);
    if (!userIdRaw || !mongoose.Types.ObjectId.isValid(String(userIdRaw))) {
      return res.status(401).json({ error: "Invalid user in auth token" });
    }
    const userId = new mongoose.Types.ObjectId(String(userIdRaw));

    const status = asText(req.query.status || "upcoming").toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const now = new Date();
    const filter = { userId };

    if (status !== "all") {
      if (!["upcoming", "past", ...VALID_APPOINTMENT_STATUS].includes(status)) {
        return res.status(400).json({ error: "Invalid status filter" });
      }
      if (status === "upcoming") {
        filter.status = "confirmed";
        filter.appointmentAt = { $gte: now };
      } else if (status === "past") {
        filter.$or = [
          { status: { $in: ["cancelled", "completed"] } },
          { status: "confirmed", appointmentAt: { $lt: now } },
        ];
      } else {
        filter.status = status;
      }
    }

    const sort = status === "past" ? { appointmentAt: -1, createdAt: -1 } : { appointmentAt: 1, createdAt: -1 };
    const rows = await DoctorAppointment.find(filter).sort(sort).limit(limit).lean();
    res.json({
      count: rows.length,
      appointments: rows.map(mapAppointment),
    });
  } catch (err) {
    console.error("GET /doctors/appointments/me error:", err?.message || err);
    res.status(500).json({ error: "Failed to load appointments" });
  }
});

router.get("/appointments/me/:appointmentId", auth, async (req, res) => {
  try {
    const userIdRaw = asUserId(req);
    if (!userIdRaw || !mongoose.Types.ObjectId.isValid(String(userIdRaw))) {
      return res.status(401).json({ error: "Invalid user in auth token" });
    }
    const userId = new mongoose.Types.ObjectId(String(userIdRaw));
    const appointmentId = asText(req.params.appointmentId);
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ error: "Invalid appointmentId" });
    }

    const appt = await DoctorAppointment.findOne({ _id: appointmentId, userId }).lean();
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    res.json({ appointment: mapAppointment(appt) });
  } catch (err) {
    console.error("GET /doctors/appointments/me/:appointmentId error:", err?.message || err);
    res.status(500).json({ error: "Failed to load appointment" });
  }
});

router.patch("/appointments/me/:appointmentId/cancel", auth, async (req, res) => {
  try {
    const userIdRaw = asUserId(req);
    if (!userIdRaw || !mongoose.Types.ObjectId.isValid(String(userIdRaw))) {
      return res.status(401).json({ error: "Invalid user in auth token" });
    }
    const userId = new mongoose.Types.ObjectId(String(userIdRaw));
    const appointmentId = asText(req.params.appointmentId);
    const cancelReason = asText(req.body?.cancelReason || req.body?.reason);

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ error: "Invalid appointmentId" });
    }

    const appt = await DoctorAppointment.findOne({ _id: appointmentId, userId });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    if (appt.status === "cancelled") {
      return res.status(409).json({ error: "Appointment already cancelled" });
    }
    if (appt.status === "completed") {
      return res.status(409).json({ error: "Completed appointment cannot be cancelled" });
    }

    appt.status = "cancelled";
    appt.cancelledAt = new Date();
    appt.cancelReason = cancelReason || "Cancelled by user";
    await appt.save();

    res.json({ appointment: mapAppointment(appt) });
  } catch (err) {
    console.error("PATCH /doctors/appointments/me/:appointmentId/cancel error:", err?.message || err);
    res.status(500).json({ error: "Failed to cancel appointment" });
  }
});

router.patch("/appointments/me/:appointmentId/reschedule", auth, async (req, res) => {
  try {
    const userIdRaw = asUserId(req);
    if (!userIdRaw || !mongoose.Types.ObjectId.isValid(String(userIdRaw))) {
      return res.status(401).json({ error: "Invalid user in auth token" });
    }
    const userId = new mongoose.Types.ObjectId(String(userIdRaw));
    const appointmentId = asText(req.params.appointmentId);

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ error: "Invalid appointmentId" });
    }

    const newDate = asText(req.body?.date);
    const newSlot = asText(req.body?.slot);
    const newMode = asText(req.body?.mode).toLowerCase();
    if (!parseISODateOnly(newDate) || !newSlot) {
      return res.status(400).json({ error: "date (YYYY-MM-DD) and slot are required" });
    }

    const appt = await DoctorAppointment.findOne({ _id: appointmentId, userId });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    if (appt.status !== "confirmed") {
      return res.status(409).json({ error: "Only confirmed appointments can be rescheduled" });
    }

    const mode = VALID_MODES.has(newMode) ? newMode : appt.mode;
    const doctor = await Doctor.findOne({ _id: appt.doctorId, active: true });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    const slotPool = getDoctorSlotPool(doctor, newDate, mode);
    if (!slotPool.includes(newSlot)) {
      return res.status(400).json({ error: "Invalid slot for selected doctor/date/mode" });
    }

    const taken = await DoctorAppointment.findOne({
      _id: { $ne: appt._id },
      doctorId: appt.doctorId,
      date: newDate,
      slot: newSlot,
      mode,
      status: "confirmed",
    }).lean();
    if (taken) {
      return res.status(409).json({ error: "Requested slot already booked" });
    }

    const appointmentAt = buildAppointmentAt(newDate, newSlot);
    if (!appointmentAt) {
      return res.status(400).json({ error: "Invalid date/slot combination" });
    }

    appt.mode = mode;
    appt.date = newDate;
    appt.dateLabel = toDateLabel(newDate);
    appt.slot = newSlot;
    appt.appointmentAt = appointmentAt;
    appt.fee = mode === "inperson" ? doctor.feeInPerson : mode === "call" ? doctor.feeCall : doctor.feeVideo;
    await appt.save();

    res.json({ appointment: mapAppointment(appt) });
  } catch (err) {
    console.error("PATCH /doctors/appointments/me/:appointmentId/reschedule error:", err?.message || err);
    res.status(500).json({ error: "Failed to reschedule appointment" });
  }
});

module.exports = router;
