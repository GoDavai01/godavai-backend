const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const auth = require("../middleware/auth");
const Doctor = require("../models/Doctor");
const DoctorAppointment = require("../models/DoctorAppointment");
const DoctorNotification = require("../models/DoctorNotification");
const User = require("../models/User");
const ClinicChangeRequest = require("../models/ClinicChangeRequest");
const AdminAuditLog = require("../models/AdminAuditLog");
const upload = require("../utils/upload");
const multer = require("multer");
const { getPlatformFeeBandFromDoctorFees, getPatientFacingBundledPricing, getDoctorCommercialSnapshot } = require("../services/doctorCommercials");
const { createDoctorNotification, streamDoctorNotifications, bootstrapDoctorReminderScheduler } = require("../services/doctorNotifications");

const router = express.Router();

const DEFAULT_SLOT_POOL = ["09:00 AM", "09:30 AM", "10:00 AM", "11:00 AM", "12:30 PM", "04:00 PM", "05:30 PM", "07:00 PM"];
const VALID_MODES = new Set(["video", "inperson", "call"]);
const VALID_ADMIN_STATES = new Set(["pending_verification", "approved", "rejected", "needs_more_info", "suspended"]);
const OTP_STORE = global.__GODAVAI_DOCTOR_OTP__ || new Map();
global.__GODAVAI_DOCTOR_OTP__ = OTP_STORE;
const MASTER_SPECIALTIES = [
  "General Physician", "Internal Medicine", "Family Medicine", "Pediatrics", "Neonatology",
  "Cardiology", "Cardiothoracic Surgery", "Neurology", "Neurosurgery", "Dermatology",
  "Psychiatry", "Clinical Psychology", "Orthopedics", "Rheumatology", "Gastroenterology",
  "Hepatology", "Pulmonology", "Nephrology", "Endocrinology", "Oncology",
  "Hematology", "Gynecology", "Obstetrics", "ENT", "Ophthalmology", "Urology",
  "General Surgery", "Plastic Surgery", "Anesthesiology", "Pain Medicine",
  "Radiology", "Pathology", "Immunology", "Infectious Disease", "Dentistry",
  "Physiotherapy", "Sports Medicine", "Geriatrics", "Nutrition", "Diabetology",
];

const DEFAULT_DOCTORS = [
  { name: "Dr. Riya Sharma", specialty: "General Physician", rating: 4.8, exp: 11, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 499, feeInPerson: 700, feeCall: 449, clinic: "CarePoint Clinic, Karol Bagh", tags: ["Fever", "Infection", "BP"] },
  { name: "Dr. Arjun Menon", specialty: "Cardiology", rating: 4.9, exp: 15, languages: ["English", "Hindi"], city: "Delhi", feeVideo: 899, feeInPerson: 1400, feeCall: 749, clinic: "Metro Heart Center, CP", tags: ["ECG", "BP", "Cholesterol"] },
  { name: "Dr. Kavya Patel", specialty: "Dermatology", rating: 4.7, exp: 9, languages: ["Hindi", "English", "Gujarati"], city: "Delhi", feeVideo: 599, feeInPerson: 850, feeCall: 499, clinic: "SkinHub, Rajouri Garden", tags: ["Acne", "Hair", "Allergy"] },
  { name: "Dr. Nikhil Bansal", specialty: "Pediatrics", rating: 4.8, exp: 12, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 549, feeInPerson: 780, feeCall: 469, clinic: "HappyKids Clinic, Pitampura", tags: ["Child Fever", "Vaccination"] },
  { name: "Dr. Sana Iqbal", specialty: "Gynecology", rating: 4.8, exp: 10, languages: ["Hindi", "English", "Urdu"], city: "Delhi", feeVideo: 699, feeInPerson: 1100, feeCall: 579, clinic: "WomenCare, Lajpat Nagar", tags: ["PCOS", "Pregnancy", "Hormones"] },
  { name: "Dr. Pranav Rao", specialty: "Orthopedics", rating: 4.6, exp: 13, languages: ["English", "Hindi"], city: "Delhi", feeVideo: 649, feeInPerson: 999, feeCall: 549, clinic: "Joint & Bone, Dwarka", tags: ["Back Pain", "Knee", "Sports"] },
  { name: "Dr. Ishita Sen", specialty: "Neurology", rating: 4.7, exp: 12, languages: ["English", "Hindi"], city: "Delhi", feeVideo: 950, feeInPerson: 1400, feeCall: 799, clinic: "NeuroCare, Rohini", tags: ["Migraine", "Seizure"] },
  { name: "Dr. Aman Kohli", specialty: "Pulmonology", rating: 4.8, exp: 10, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 799, feeInPerson: 1200, feeCall: 679, clinic: "Breath Plus, Saket", tags: ["Asthma", "COPD"] },
  { name: "Dr. Kriti Malhotra", specialty: "Endocrinology", rating: 4.8, exp: 9, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 749, feeInPerson: 1199, feeCall: 649, clinic: "Hormone Clinic, GK", tags: ["Diabetes", "Thyroid"] },
  { name: "Dr. Harsh Vardhan", specialty: "Gastroenterology", rating: 4.6, exp: 11, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 850, feeInPerson: 1350, feeCall: 699, clinic: "GI Liver Centre, Janakpuri", tags: ["Acidity", "IBS"] },
  { name: "Dr. Meera Ahuja", specialty: "Nephrology", rating: 4.7, exp: 14, languages: ["English", "Hindi"], city: "Delhi", feeVideo: 899, feeInPerson: 1450, feeCall: 749, clinic: "Kidney Point, Noida", tags: ["CKD", "BP"] },
  { name: "Dr. Rohan Dutta", specialty: "ENT", rating: 4.7, exp: 8, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 549, feeInPerson: 850, feeCall: 449, clinic: "Ear Nose Throat Hub, Patel Nagar", tags: ["Sinus", "Throat"] },
  { name: "Dr. Tanvi Roy", specialty: "Ophthalmology", rating: 4.8, exp: 10, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 599, feeInPerson: 899, feeCall: 499, clinic: "Vision First, Dwarka", tags: ["Eye Checkup", "Dry Eye"] },
  { name: "Dr. Sahil Jain", specialty: "Psychiatry", rating: 4.9, exp: 9, languages: ["English", "Hindi"], city: "Delhi", feeVideo: 899, feeInPerson: 1299, feeCall: 799, clinic: "MindWell, South Ex", tags: ["Anxiety", "Sleep"] },
  { name: "Dr. Priya Bedi", specialty: "Dermatology", rating: 4.8, exp: 7, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 649, feeInPerson: 999, feeCall: 549, clinic: "Skin Craft, Vasant Kunj", tags: ["Acne", "Pigmentation"] },
  { name: "Dr. Vivek Suri", specialty: "Urology", rating: 4.6, exp: 13, languages: ["Hindi", "English"], city: "Delhi", feeVideo: 899, feeInPerson: 1499, feeCall: 749, clinic: "UroCare, Gurgaon", tags: ["Kidney Stone", "UTI"] },
  { name: "Dr. Naina Kapoor", specialty: "Oncology", rating: 4.8, exp: 15, languages: ["English", "Hindi"], city: "Delhi", feeVideo: 1200, feeInPerson: 1800, feeCall: 999, clinic: "Cancer Care Unit, Delhi", tags: ["Second Opinion", "Chemo Advice"] },
];

let defaultDoctorsSeeded = false;
bootstrapDoctorReminderScheduler();

function asText(v) {
  return String(v == null ? "" : v).trim();
}

function normalizePhone(v) {
  const digits = String(v || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

async function sendDoctorOtpSms(phone, code) {
  const smsUrl = asText(process.env.DOCTOR_OTP_HTTP_URL);
  const authToken = asText(process.env.DOCTOR_OTP_HTTP_TOKEN);
  if (!smsUrl) return { ok: false, error: "DOCTOR_OTP_HTTP_URL missing" };
  if (smsUrl.includes("<") || smsUrl.includes(">")) return { ok: false, error: "DOCTOR_OTP_HTTP_URL is placeholder, set real provider URL" };
  if (authToken && (authToken.includes("<") || authToken.includes(">"))) return { ok: false, error: "DOCTOR_OTP_HTTP_TOKEN is placeholder, set real token" };
  if (!/^https?:\/\//i.test(smsUrl)) return { ok: false, error: "DOCTOR_OTP_HTTP_URL must start with http/https" };

  try {
    await axios.post(
      smsUrl,
      {
        phone,
        otp: code,
        template: "doctor_onboarding_otp",
        source: "godavaii",
      },
      {
        timeout: 10000,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      }
    );
    return { ok: true };
  } catch (err) {
    const providerErr = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Unknown SMS provider error";
    return { ok: false, error: providerErr };
  }
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
  if (band.manualApprovalRequired) return base;
  return base + Number(band.serviceFee || 0);
}

function normalizeDoctorModes(doctor = {}) {
  return {
    audio: !!doctor?.consultModes?.audio,
    video: !!doctor?.consultModes?.video,
    inperson: !!(doctor?.consultModes?.inperson || doctor?.consultModes?.inPerson),
  };
}

function formatBandLabel(bandKey = "") {
  switch (String(bandKey || "")) {
    case "0_500":
      return "\u20B90\u2013\u20B9500";
    case "501_1000":
      return "\u20B9501\u2013\u20B91000";
    case "1001_1500":
      return "\u20B91001\u2013\u20B91500";
    case "1501_2000":
      return "\u20B91501\u2013\u20B92000";
    case "2001_plus":
      return "\u20B92001+";
    default:
      return String(bandKey || "");
  }
}

function toDisplayDays(days = []) {
  return (days || []).map((day) => {
    const key = asText(day).toLowerCase().slice(0, 3);
    switch (key) {
      case "mon":
        return "Mon";
      case "tue":
        return "Tue";
      case "wed":
        return "Wed";
      case "thu":
        return "Thu";
      case "fri":
        return "Fri";
      case "sat":
        return "Sat";
      case "sun":
        return "Sun";
      default:
        return asText(day);
    }
  });
}

function formatFrontendPlatformBand(band = {}) {
  return {
    code: band.code || band.bandKey || "",
    label: formatBandLabel(band.bandKey || band.code || ""),
    fee: band.requiresManualApproval ? null : Number(band.serviceFee || band.serviceFeeExGst || 0),
    serviceFee: band.requiresManualApproval ? null : Number(band.serviceFee || band.serviceFeeExGst || 0),
    gstApplicable: band.gstApplicable !== false,
    requiresManualApproval: !!band.requiresManualApproval,
  };
}
function humanizeProfileStatus(status = "") {
  switch (mapVerificationStatus(status)) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "needs_more_info":
      return "Needs More Info";
    case "suspended":
      return "Suspended";
    case "pending_verification":
    default:
      return "Pending Verification";
  }
}

function mapClinicChangeRequestForDashboard(request = null) {
  if (!request) return null;
  return {
    _id: request._id,
    doctorId: request.doctorId,
    status: asText(request.status || "pending_verification"),
    adminComment: asText(request.adminComment),
    submittedAt: request.submittedAt || request.createdAt || null,
    reviewedAt: request.reviewedAt || null,
    requestedClinic: {
      clinicName: asText(request?.requestedClinic?.name),
      addressLine1: asText(request?.requestedClinic?.fullAddress),
      locality: asText(request?.requestedClinic?.locality),
      city: asText(request?.requestedClinic?.city),
      pin: asText(request?.requestedClinic?.pincode),
      mapLabel: asText(request?.requestedClinic?.mapLabel || request?.requestedClinic?.name),
      coordinates: request?.requestedClinic?.coordinates || { lat: null, lng: null },
      consultationDays: toDisplayDays(request?.requestedClinic?.consultationDays || []),
      startTime: asText(request?.requestedClinic?.startTime),
      endTime: asText(request?.requestedClinic?.endTime),
      slotDuration: Number(request?.requestedClinic?.slotDuration || 0),
      arrivalWindow: Number(request?.requestedClinic?.arrivalWindow || 0),
      maxPatientsPerDay: Number(request?.requestedClinic?.maxPatientsPerDay || 0),
    },
    proofDocument: {
      url: asText(request?.proofDocument?.url),
      fileName: asText(request?.proofDocument?.fileName),
      mimeType: asText(request?.proofDocument?.mimeType),
      size: Number(request?.proofDocument?.size || 0),
    },
    locationCaptureSource: asText(request?.locationCaptureSource),
    locationCapturedAt: request?.locationCapturedAt || null,
  };
}

function buildDoctorFeeShape(doctor = {}) {
  return {
    audio: Number(doctor?.feeCall || 0),
    video: Number(doctor?.feeVideo || 0),
    inperson: Number(doctor?.feeInPerson || 0),
  };
}

function getDoctorClinicForOps(doctor = {}) {
  const verified = doctor?.verifiedClinicProfile?.name ? doctor.verifiedClinicProfile : null;
  const locationSource = verified || doctor?.clinicProfile || {};
  const scheduleSource = doctor?.clinicProfile?.consultationDays?.length ? doctor.clinicProfile : locationSource;
  const timingsText = asText(scheduleSource?.timingsText || locationSource?.timingsText || "");
  const timingMatch = timingsText.match(/(\d{1,2}:\d{2})\s*[-to]+\s*(\d{1,2}:\d{2})/i);
  return {
    verified: !!locationSource?.verified,
    name: asText(locationSource?.name),
    addressLine1: asText(locationSource?.fullAddress),
    locality: asText(locationSource?.locality),
    city: asText(locationSource?.city || doctor?.city),
    pin: asText(locationSource?.pincode),
    mapLabel: asText(locationSource?.mapLabel || locationSource?.name),
    coordinates: locationSource?.coordinates || { lat: null, lng: null },
    consultationDays: Array.isArray(scheduleSource?.consultationDays) ? toDisplayDays(scheduleSource.consultationDays) : [],
    startTime: timingMatch?.[1] || "",
    endTime: timingMatch?.[2] || "",
    slotDuration: Number(scheduleSource?.slotDurationMins || 15),
    arrivalWindow: Number(scheduleSource?.patientArrivalWindowMins || 15),
    maxPatientsPerDay: Number(scheduleSource?.maxPatientsPerDay || 24),
  };
}

function maskPayoutAccount(doctor = {}) {
  if (asText(doctor?.payoutAccountMasked)) return doctor.payoutAccountMasked;
  const last4 = asText(doctor?.payoutDetails?.accountNumberLast4);
  const bankName = asText(doctor?.payoutDetails?.bankName);
  if (last4 || bankName) return `${bankName || "Bank"} •••• ${last4 || "0000"}`;
  return "";
}

function mapVerificationStatus(status) {
  const normalized = asText(status || "pending_verification").toLowerCase();
  if (normalized === "under_review") return "pending_verification";
  return normalized || "pending_verification";
}

function deriveDashboardBookingState(booking) {
  const baseStatus = asText(booking?.status).toLowerCase();
  if (["cancelled", "rejected"].includes(baseStatus)) return "cancelled";
  if (baseStatus === "no_show") return "no_show";
  if (baseStatus === "completed") return "completed";
  if (baseStatus === "confirmed") return "pending";
  const appointmentAt = booking?.appointmentAt ? new Date(booking.appointmentAt) : null;
  if (baseStatus === "accepted") {
    if (appointmentAt && appointmentAt.getTime() <= Date.now() + 60 * 1000) return "live_now";
    return "upcoming";
  }
  if (baseStatus === "upcoming" || baseStatus === "live_now" || baseStatus === "pending") return baseStatus;
  if (baseStatus === "pending_payment") return "pending";
  return "pending";
}

function buildDoctorDashboardPayload({ doctor, incomingRequests = [], upcomingConsults = [], notifications = [], clinicChangeRequest = null }) {
  const fees = buildDoctorFeeShape(doctor);
  const modes = normalizeDoctorModes(doctor);
  const commercial = getDoctorCommercialSnapshot({
    feeVideo: fees.video,
    feeInPerson: fees.inperson,
    feeCall: fees.audio,
    consultModes: { audio: modes.audio, video: modes.video, inPerson: modes.inperson },
  });
  return {
    doctor: {
      _id: doctor._id.toString(),
      id: doctor._id.toString(),
      fullName: asText(doctor.fullName || doctor.name),
      specialty: asText(doctor.specialty),
      qualification: asText(doctor.qualification),
      avatar: asText(doctor.avatar),
      phone: asText(doctor.phone),
      email: asText(doctor.email),
      city: asText(doctor.city),
      area: asText(doctor.area || doctor.clinicProfile?.locality || doctor.verifiedClinicProfile?.locality),
      yearsExperience: Number(doctor.yearsExperience || doctor.experience || doctor.exp || 0),
      profileStatus: humanizeProfileStatus(doctor.verificationStatus),
      online: !!doctor.online,
      payoutAccountMasked: maskPayoutAccount(doctor),
      modes,
      fees,
      platformBand: formatFrontendPlatformBand(commercial.band),
      clinic: getDoctorClinicForOps(doctor),
      availability: doctor.availability || {},
    },
    incomingRequests,
    upcomingConsults,
    nextConsult:
      upcomingConsults.find((row) => ["accepted", "upcoming", "live_now"].includes(asText(row.status).toLowerCase())) || null,
    notifications,
    clinicChangeRequest: mapClinicChangeRequestForDashboard(clinicChangeRequest),
  };
}

function mapDoctorNotificationRow(row = {}) {
  return {
    _id: row._id,
    type: row.type,
    title: row.title,
    body: row.message,
    message: row.message,
    bookingId: row.bookingId || null,
    read: !!row.read,
    createdAt: row.createdAt,
    meta: row.meta || {},
  };
}

function mapDoctorBookingForDashboard(booking = {}, patientMeta = null) {
  const mode = booking.mode === "call" ? "audio" : booking.mode;
  return {
    _id: booking._id,
    patientId: booking.userId,
    patientName: asText(booking.patientName || "Patient"),
    patientAge: patientMeta?.patientAge ?? null,
    patientGender: patientMeta?.patientGender ?? null,
    patientSummary: asText(booking.patientSummary),
    mode,
    status: deriveDashboardBookingState(booking),
    bookedFor: booking.appointmentAt,
    createdAt: booking.createdAt,
    fee: Number(booking.fee || 0),
    symptoms: asText(booking.symptoms || booking.reason),
    reason: asText(booking.reason),
    notes: asText(booking.doctorNotes),
    locationLabel: asText(booking?.clinicLocationSnapshot?.locality),
    paymentStatus: asText(booking.paymentStatus || "pending"),
    consultRoomId: asText(booking.consultRoomId),
    clinicRevealAllowed: !!(booking.clinicRevealAllowed || booking.locationUnlockedForPatient),
    prescriptionId: booking.prescriptionId || null,
    patientAttachments: Array.isArray(booking.patientAttachments) ? booking.patientAttachments : [],
    canJoin:
      deriveDashboardBookingState(booking) === "live_now" ||
      (booking.appointmentAt && new Date(booking.appointmentAt).getTime() <= Date.now() + 5 * 60 * 1000),
  };
}

async function mapDoctorBookingsForDashboard(rows = []) {
  const patientMetaMap = await buildPatientMetaMap(rows);
  return rows.map((row) => mapDoctorBookingForDashboard(row, patientMetaMap.get(String(row?.userId || "")) || null));
}

function parseISODateOnly(v) {
  const s = asText(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function calculateAgeFromDob(dob) {
  const raw = asText(dob);
  if (!raw) return null;
  const birthDate = new Date(raw);
  if (Number.isNaN(birthDate.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDelta = now.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

async function buildPatientMetaMap(bookings = []) {
  const userIds = [...new Set(
    (bookings || [])
      .map((booking) => String(booking?.userId || ""))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  )];
  if (!userIds.length) return new Map();
  const rows = await User.find({ _id: { $in: userIds } }).select("_id dob gender sex").lean();
  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        patientAge: calculateAgeFromDob(row.dob),
        patientGender: asText(row.gender || row.sex) || null,
      },
    ])
  );
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

function dayKeyFromIsoDate(date) {
  const d = parseISODateOnly(date);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Kolkata" }).format(d).toLowerCase().slice(0, 3);
}

function toMinutes(hhmm) {
  const t = asText(hhmm);
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function minsTo12h(mins) {
  const h24 = Math.floor(mins / 60);
  const mm = mins % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function generateSlotsBetween(startHHmm, endHHmm, stepMins) {
  const start = toMinutes(startHHmm);
  const end = toMinutes(endHHmm);
  const step = Number(stepMins || 15);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step < 5 || end <= start) return [];
  const out = [];
  for (let t = start; t + step <= end; t += step) out.push(minsTo12h(t));
  return out;
}

function buildAvailabilityFromDashboard({ consultationDays = [], startTime = "09:00", endTime = "13:00", enabled = true }) {
  const activeSet = new Set(
    (consultationDays || []).map((day) => asText(day).toLowerCase().slice(0, 3)).filter(Boolean)
  );
  const allDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const availability = {};
  for (const day of allDays) {
    const isActive = enabled && activeSet.has(day);
    availability[day] = {
      enabled: isActive,
      start: isActive ? startTime : "",
      end: isActive ? endTime : "",
    };
  }
  return availability;
}

function normalizeCustomDaySlots(rawSlots = {}) {
  const allDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const normalized = {};
  for (const day of allDays) {
    const row = rawSlots?.[day] || rawSlots?.[day.toUpperCase()] || {};
    const start = asText(row?.start);
    const end = asText(row?.end);
    const isEnabled = !!row?.enabled && !!start && !!end;
    normalized[day] = {
      enabled: isEnabled,
      start: isEnabled ? start : "",
      end: isEnabled ? end : "",
    };
  }
  return normalized;
}

function parseTimingRangeFromText(text) {
  const m = asText(text).match(/(\d{1,2}:\d{2})\s*[-to]+\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  return { start: m[1], end: m[2] };
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
  const dayKey = dayKeyFromIsoDate(d);
  if (m === "inperson" && doctor?.clinicProfile?.consultationDays?.length) {
    const active = doctor.clinicProfile.consultationDays.map((x) => asText(x).toLowerCase().slice(0, 3));
    if (!active.includes(dayKey)) return [];
  }

  const step = Number(doctor?.clinicProfile?.slotDurationMins || 15);
  const dailyCap = Number(doctor?.clinicProfile?.maxPatientsPerDay || 0);
  const av = doctor?.availability?.[dayKey] || {};
  const avStart = asText(av?.start);
  const avEnd = asText(av?.end);
  if (av?.enabled && avStart && avEnd) {
    const slots = generateSlotsBetween(avStart, avEnd, step);
    return dailyCap > 0 ? slots.slice(0, dailyCap) : slots;
  }

  if (m === "inperson") {
    const range = parseTimingRangeFromText(doctor?.clinicProfile?.timingsText);
    if (range) {
      const slots = generateSlotsBetween(range.start, range.end, step);
      return dailyCap > 0 ? slots.slice(0, dailyCap) : slots;
    }
  }

  return [];
}

function isPastSlot(date, slot) {
  const appointmentAt = buildAppointmentAt(date, slot);
  if (!appointmentAt) return true;
  return appointmentAt.getTime() < Date.now();
}

function mapDoctorPrivate(doc) {
  const baseConsult = Number(doc.consultationFee || doc.feeVideo || 0);
  const band = doc.platformFeeBand?.bandKey
    ? {
        code: doc.platformFeeBand.bandKey,
        bandKey: doc.platformFeeBand.bandKey,
        label: doc.platformFeeBand.bandKey,
        serviceFee: Number(doc.platformFeeBand.serviceFee || 0),
        serviceFeeExGst: Number(doc.platformFeeBand.serviceFee || 0),
        gstApplicable: true,
        gstLabel: doc.platformFeeBand.gstLabel || "+ applicable GST",
        requiresManualApproval: !!doc.platformFeeBand.manualApprovalRequired,
      }
    : getPlatformFeeBandFromDoctorFees(
        { audio: doc.feeCall, video: doc.feeVideo, inperson: doc.feeInPerson },
        { audio: doc?.consultModes?.audio, video: doc?.consultModes?.video, inperson: doc?.consultModes?.inPerson }
      );
  const feeVideo = Number(doc.feeVideo || baseConsult || 0);
  const feeInPerson = Number(doc.feeInPerson || baseConsult || 0);
  const feeCall = Number(doc.feeCall || baseConsult || 0);
  return {
    id: doc._id.toString(),
    name: doc.name,
    fullName: asText(doc.fullName || doc.name),
    email: doc.email || "",
    phone: doc.phone || "",
    specialty: doc.specialty,
    qualification: asText(doc.qualification),
    avatar: asText(doc.avatar),
    rating: doc.rating,
    exp: doc.exp,
    experience: doc.experience || doc.exp || 0,
    yearsExperience: Number(doc.yearsExperience || doc.experience || doc.exp || 0),
    languages: doc.languages || [],
    city: doc.city,
    area: asText(doc.area || doc.clinicProfile?.locality || doc.verifiedClinicProfile?.locality),
    feeVideo,
    feeInPerson,
    feeCall,
    consultationFee: baseConsult,
    platformFeeBand: band,
    verificationStatus: mapVerificationStatus(doc.verificationStatus),
    verificationNotes: doc.verificationNotes || "",
    verificationReviewedAt: doc.verificationReviewedAt || null,
    consultModes: doc.consultModes || { audio: true, video: true, inPerson: false },
    clinicProfile: getDoctorClinicForOps(doc),
    rawClinicProfile: doc.clinicProfile || {},
    verifiedClinicProfile: doc.verifiedClinicProfile || {},
    documents: doc.documents || {},
    onboardingStep: Number(doc.onboardingStep || 1),
    clinic: doc.clinic || doc.clinicName || "",
    clinicName: doc.clinicName || doc.clinic || "",
    tags: doc.tags || [],
    active: !!doc.active,
    online: !!doc.online,
    payoutAccountMasked: maskPayoutAccount(doc),
    availability: doc.availability || {},
    isPortalDoctor: !!doc.isPortalDoctor,
    clinicChangeRequestActive: !!doc.clinicChangeRequestActive,
    latestClinicChangeRequestId: doc.latestClinicChangeRequestId || null,
  };
}

function mapDoctorPublic(doc) {
  const feeVideoBase = Number(doc.feeVideo || doc.consultationFee || 0);
  const feeInPersonBase = Number(doc.feeInPerson || doc.consultationFee || 0);
  const feeCallBase = Number(doc.feeCall || doc.consultationFee || 0);
  return {
    id: doc._id.toString(),
    name: doc.name,
    specialty: doc.specialty,
    rating: doc.rating,
    exp: doc.exp,
    languages: doc.languages || [],
    city: doc.city,
    locality: asText(doc.verifiedClinicProfile?.locality || doc.clinicProfile?.locality || doc.city || ""),
    feeVideo: getPatientFacingBundledPricing(feeVideoBase),
    feeInPerson: getPatientFacingBundledPricing(feeInPersonBase),
    feeCall: getPatientFacingBundledPricing(feeCallBase),
    customerPriceLabelVideo: `Consultation Rs ${getPatientFacingBundledPricing(feeVideoBase)}`,
    customerPriceLabelInPerson: `In-Person Visit Rs ${getPatientFacingBundledPricing(feeInPersonBase)}`,
    customerPriceLabelCall: `Consultation Rs ${getPatientFacingBundledPricing(feeCallBase)}`,
    clinic: asText(doc.verifiedClinicProfile?.locality || doc.clinicProfile?.locality || doc.clinicName || doc.clinic || doc.city || "Clinic Area"),
    clinicName: asText(doc.verifiedClinicProfile?.name || doc.clinicName || doc.clinicProfile?.name || "Clinic"),
    tags: doc.tags || [],
    active: !!doc.active,
    online: !!doc.online,
    consultationModes: {
      audio: !!doc.consultModes?.audio,
      video: !!doc.consultModes?.video,
      inPerson: !!doc.consultModes?.inPerson,
    },
  };
}

const isAdmin = (req, res, next) => {
  return auth(req, res, () => {
    const ok =
      !!req.user?.adminId ||
      req.user?.type === "admin" ||
      req.user?.role === "admin" ||
      req.user?.isAdmin === true ||
      req.user?.scope === "admin";
    if (!ok) return res.status(403).json({ error: "Admin only" });
    next();
  });
};

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
  if (count < 18) {
    const existing = await Doctor.find({}).select("name specialty").lean();
    const existingKey = new Set(existing.map((x) => `${asText(x.name).toLowerCase()}::${asText(x.specialty).toLowerCase()}`));
    const seeded = DEFAULT_DOCTORS
      .filter((d) => !existingKey.has(`${asText(d.name).toLowerCase()}::${asText(d.specialty).toLowerCase()}`))
      .map((d) => ({
      ...d,
      active: true,
      verificationStatus: "approved",
      consultModes: { audio: true, video: true, inPerson: true },
      consultationFee: Number(d.feeVideo || 499),
      platformFeeBand: { ...computePlatformBand(Number(d.feeVideo || 499)), updatedAt: new Date() },
      clinicProfile: {
        name: asText(d.clinic || "Clinic"),
        locality: asText(d.city || ""),
        inPersonEnabled: true,
      },
      }));
    if (seeded.length) await Doctor.insertMany(seeded);
  }
  defaultDoctorsSeeded = true;
}

function publicDoctorFilter() {
  return {
    active: true,
    $or: [{ verificationStatus: "approved" }, { verificationStatus: { $exists: false } }],
  };
}

function getUploadedFileMeta(file = null) {
  if (!file) return { url: "", fileName: "", mimeType: "", size: 0 };
  const url = asText(file.location || file.path || file.url);
  return {
    url,
    fileName: asText(file.originalname || file.key || file.filename),
    mimeType: asText(file.mimetype),
    size: Number(file.size || 0),
  };
}

function getUploadedFilesMeta(files = []) {
  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      ...getUploadedFileMeta(file),
      category: "medical_record",
      uploadedAt: new Date(),
    }))
    .filter((file) => file.url);
}

const clinicChangeUpload = (req, res, next) => {
  upload.single("clinicProof")(req, res, (err) => {
    if (!err) return next();
    const raw = asText(err?.message || "Upload failed");
    const msg =
      err?.code === "LIMIT_FILE_SIZE"
        ? "Clinic proof file too large. Max 5MB allowed."
        : err instanceof multer.MulterError
        ? raw
        : raw || "Clinic proof upload failed";
    return res.status(400).json({ error: msg });
  });
};

const consultRecordUpload = (req, res, next) => {
  upload.array("medicalRecords", 5)(req, res, (err) => {
    if (!err) return next();
    const raw = asText(err?.message || "Upload failed");
    const msg =
      err?.code === "LIMIT_FILE_SIZE"
        ? "Medical record file too large. Max 5MB allowed."
        : err instanceof multer.MulterError
        ? raw
        : raw || "Medical record upload failed";
    return res.status(400).json({ error: msg });
  });
};

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

function pushDoctorNotification(doctorId, title, message, type = "info", bookingId = null, meta = {}) {
  if (!doctorId) return;
  createDoctorNotification({
    doctorId,
    title,
    message,
    type,
    bookingId,
    meta,
  }).catch(() => {});
}

const onboardingUploadFields = [
  { name: "registrationCertificate", maxCount: 1 },
  { name: "mbbsDegree", maxCount: 1 },
  { name: "specialistDegree", maxCount: 1 },
  { name: "pan", maxCount: 1 },
  { name: "bankProof", maxCount: 1 },
  { name: "clinicProof", maxCount: 1 },
];

const doctorOnboardingUploadDir = path.join(process.cwd(), "uploads", "doctor-onboarding");
try { fs.mkdirSync(doctorOnboardingUploadDir, { recursive: true }); } catch (_) {}

const onboardingLocalUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, doctorOnboardingUploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${String(file.originalname || "file").replace(/\s+/g, "_")}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const type = String(file.mimetype || "").toLowerCase();
    const extOk = [".jpg", ".jpeg", ".png", ".webp", ".pdf", ".heic", ".heif"].some((x) => name.endsWith(x));
    const typeOk = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
      "application/octet-stream",
    ].includes(type);
    if (!extOk && !typeOk) return cb(new Error("Invalid file type (use jpg/jpeg/png/webp/pdf/heic)"));
    cb(null, true);
  },
});

const onboardingUpload = (req, res, next) => {
  const hasS3Creds =
    !!process.env.AWS_BUCKET_NAME &&
    !!process.env.AWS_ACCESS_KEY_ID &&
    !!process.env.AWS_SECRET_ACCESS_KEY &&
    !!process.env.AWS_REGION;
  const s3Enabled = process.env.USE_S3 === "1" && hasS3Creds;
  const mw = s3Enabled
    ? upload.fields(onboardingUploadFields)
    : onboardingLocalUpload.fields(onboardingUploadFields);
  mw(req, res, (err) => {
    if (!err) return next();
    const raw = String(err?.message || "Upload failed");
    const isMulter = err instanceof multer.MulterError;
    const msg =
      err?.code === "LIMIT_FILE_SIZE"
        ? "File too large. Max 5MB per file."
        : err?.code === "LIMIT_UNEXPECTED_FILE"
        ? "Unexpected upload field. Please refresh and try again."
        : raw.toLowerCase().includes("credential") || raw.toLowerCase().includes("bucket")
        ? "Upload service unavailable. Please try again in a moment."
        : raw;
    return res.status(isMulter ? 400 : 503).json({ error: msg });
  });
};

router.post("/onboarding/otp/send", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone || phone.length < 10) return res.status(400).json({ error: "Valid mobile number is required" });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const sent = await sendDoctorOtpSms(phone, code);
    if (!sent?.ok) {
      return res.status(503).json({
        error: `OTP service error: ${sent?.error || "provider unavailable"}`,
      });
    }
    OTP_STORE.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
    return res.json({ ok: true, expiresInSec: 300, smsStatus: "sent" });
  } catch (err) {
    console.error("POST /doctors/onboarding/otp/send error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to send OTP" });
  }
});

router.post("/onboarding/otp/verify", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const otp = asText(req.body?.otp);
    const row = OTP_STORE.get(phone);
    if (!row || Date.now() > Number(row.expiresAt || 0)) return res.status(400).json({ error: "OTP expired. Please resend." });
    if (otp !== row.code) return res.status(400).json({ error: "Invalid OTP" });
    OTP_STORE.delete(phone);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
});

router.post(
  "/onboarding/submit",
  onboardingUpload,
  async (req, res) => {
    try {
      const b = req.body || {};
      const fullName = asText(b.fullName || b.name);
      const phone = normalizePhone(b.phone);
      const otpVerified = ["yes", "true", "1"].includes(asText(b.otpVerified).toLowerCase());
      const email = asText(b.email).toLowerCase();
      const specialty = asText(b.specialty);
      const city = asText(b.city);
      const area = asText(b.area);
      const availableTimings = asText(b.availableTimings);
      const consultationFee = Number(b.consultationFee || 0);
      const modeAudio = ["yes", "true", "1"].includes(asText(b.modeAudio).toLowerCase());
      const modeVideo = ["yes", "true", "1"].includes(asText(b.modeVideo).toLowerCase());
      const modeInPerson = ["yes", "true", "1"].includes(asText(b.modeInPerson).toLowerCase());
      const specialistRequired = ["yes", "true", "1"].includes(asText(b.specialistRequired).toLowerCase());

      const registrationNumber = asText(b.registrationNumber);
      const clinicName = asText(b.clinicName);
      const clinicAddress = asText(b.clinicAddress);
      const clinicLocality = asText(b.clinicLocality || area);
      const clinicPincode = asText(b.clinicPincode);
      const clinicLat = Number(b.clinicLat);
      const clinicLng = Number(b.clinicLng);

      const c1 = ["yes", "true", "1"].includes(asText(b.consentRegisteredDoctor).toLowerCase());
      const c2 = ["yes", "true", "1"].includes(asText(b.consentVerification).toLowerCase());
      const c3 = ["yes", "true", "1"].includes(asText(b.consentTerms).toLowerCase());
      const c4 = ["yes", "true", "1"].includes(asText(b.consentPlatformFee).toLowerCase());

      if (!fullName || !phone || !otpVerified || !email || !specialty || !city || !area || !availableTimings) {
        return res.status(400).json({ error: "Missing mandatory basic details or OTP verification" });
      }
      if (!modeAudio && !modeVideo && !modeInPerson) {
        return res.status(400).json({ error: "Select at least one consultation mode" });
      }
      if (!(consultationFee >= 0)) return res.status(400).json({ error: "Valid consultation fee is required" });
      if (!registrationNumber) return res.status(400).json({ error: "Registration number is required" });

      const files = req.files || {};
      const fileUrl = (k) => {
        const f = files?.[k]?.[0];
        if (!f) return "";
        if (f.location) return f.location;
        if (f.filename) return `/uploads/doctor-onboarding/${f.filename}`;
        const p = asText(f.path);
        const marker = `${path.sep}uploads${path.sep}`;
        const idx = p.toLowerCase().indexOf(marker.toLowerCase());
        if (idx >= 0) return `/${p.slice(idx).replace(/\\/g, "/")}`;
        return "";
      };
      const registrationCertificateUrl = fileUrl("registrationCertificate");
      const mbbsDegreeUrl = fileUrl("mbbsDegree");
      const specialistDegreeUrl = fileUrl("specialistDegree");
      const panUrl = fileUrl("pan");
      const bankProofUrl = fileUrl("bankProof");
      const clinicProofUrl = fileUrl("clinicProof");

      if (!registrationCertificateUrl || !mbbsDegreeUrl || !panUrl || !bankProofUrl) {
        return res.status(400).json({ error: "Registration certificate, MBBS degree, PAN and bank proof are required" });
      }
      if (specialistRequired && !specialistDegreeUrl) {
        return res.status(400).json({ error: "Specialist degree is required for specialist onboarding" });
      }
      if (modeInPerson) {
        if (!clinicName || !clinicAddress || !clinicPincode || !Number.isFinite(clinicLat) || !Number.isFinite(clinicLng) || !clinicProofUrl) {
          return res.status(400).json({ error: "Clinic name/address/pincode/map pin/clinic proof are required for in-person mode" });
        }
      }
      if (!(c1 && c2 && c3 && c4)) return res.status(400).json({ error: "All consent checkboxes are mandatory" });

      const band = computePlatformBand(consultationFee);
      const payload = {
        name: fullName,
        fullName,
        email,
        phone,
        specialty,
        city,
        area,
        qualification: specialistRequired ? "Specialist" : "General Physician",
        yearsExperience: Number(b.yearsExperience || 0),
        clinicName: modeInPerson ? clinicName : "",
        clinic: modeInPerson ? clinicLocality : "",
        consultationFee,
        feeVideo: modeVideo ? consultationFee : 0,
        feeCall: modeAudio ? consultationFee : 0,
        feeInPerson: modeInPerson ? consultationFee : 0,
        active: false,
        isPortalDoctor: true,
        doctorOtpVerified: true,
        onboardingStep: 3,
        onboardingCompletedAt: new Date(),
        verificationStatus: "pending_verification",
        verificationNotes: "Submitted for verification",
        consultModes: {
          audio: modeAudio,
          video: modeVideo,
          inPerson: modeInPerson,
        },
        platformFeeBand: { ...band, updatedAt: new Date() },
        commercialTermsAcceptedAt: new Date(),
        consents: {
          registeredDoctorConfirmed: c1,
          verificationConsent: c2,
          teleconsultTermsConsent: c3,
          platformFeeTermsConsent: c4,
        },
        documents: {
          registrationNumber,
          registrationCertificateUrl,
          mbbsDegreeUrl,
          specialistDegreeUrl: specialistRequired ? specialistDegreeUrl : "",
          panUrl,
          bankProofUrl,
          clinicProofUrl: modeInPerson ? clinicProofUrl : "",
          specialistRequired,
        },
        clinicProfile: {
          verified: false,
          name: modeInPerson ? clinicName : "",
          fullAddress: modeInPerson ? clinicAddress : "",
          locality: modeInPerson ? clinicLocality : area,
          city,
          pincode: modeInPerson ? clinicPincode : "",
          mapLabel: modeInPerson ? clinicName : "",
          coordinates: {
            lat: modeInPerson ? clinicLat : null,
            lng: modeInPerson ? clinicLng : null,
          },
          slotDurationMins: Number(b.slotDurationMins || 15),
          patientArrivalWindowMins: Number(b.patientArrivalWindowMins || 15),
          maxPatientsPerDay: Number(b.maxPatientsPerDay || 24),
          consultationDays: Array.isArray(b.consultationDays) ? b.consultationDays.map(asText).filter(Boolean) : ["mon", "tue", "wed", "thu", "fri"],
          timingsText: availableTimings,
          inPersonEnabled: modeInPerson,
        },
        verifiedClinicProfile: {
          verified: false,
          name: "",
          fullAddress: "",
          locality: "",
          city: "",
          pincode: "",
          mapLabel: "",
          coordinates: { lat: null, lng: null },
          slotDurationMins: 15,
          patientArrivalWindowMins: 15,
          maxPatientsPerDay: 24,
          consultationDays: [],
          timingsText: "",
          inPersonEnabled: false,
        },
      };

      let doctor = await Doctor.findOne({ email });
      if (doctor) {
        doctor.set(payload);
      } else {
        doctor = new Doctor(payload);
      }
      await doctor.save();

      const token = jwt.sign(doctorTokenPayload(doctor), process.env.JWT_SECRET, { expiresIn: "30d" });
      return res.status(201).json({
        token,
        doctor: mapDoctorPrivate(doctor),
        verificationStatus: doctor.verificationStatus,
      });
    } catch (err) {
      console.error("POST /doctors/onboarding/submit error:", err?.message || err);
      return res.status(500).json({ error: "Failed to submit doctor onboarding" });
    }
  }
);

router.get("/admin/all", isAdmin, async (req, res) => {
  try {
    const status = asText(req.query?.status).toLowerCase();
    const q = asText(req.query?.q);
    const filter = {};
    if (status && status !== "all") {
      if (status === "pending_verification") {
        filter.$or = [
          { verificationStatus: "pending_verification" },
          { verificationStatus: "under_review" },
          { verificationStatus: { $exists: false } },
          { verificationStatus: null },
        ];
      } else {
        filter.verificationStatus = status;
      }
    }
    if (q) {
      const qOr = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { specialty: { $regex: q, $options: "i" } },
      ];
      if (filter.$or?.length) {
        filter.$and = [{ $or: filter.$or }, { $or: qOr }];
        delete filter.$or;
      } else {
        filter.$or = qOr;
      }
    }
    const rows = await Doctor.find(filter).sort({ createdAt: -1 }).limit(1000).lean();
    return res.json({ doctors: rows.map(mapDoctorPrivate) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load doctors" });
  }
});

router.get("/admin/detail/:id", isAdmin, async (req, res) => {
  try {
    const id = asText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid doctor id" });
    const [doctor, latestClinicChangeRequest, recentBookings, recentNotifications] = await Promise.all([
      Doctor.findById(id).lean(),
      ClinicChangeRequest.findOne({ doctorId: id }).sort({ createdAt: -1 }).lean(),
      DoctorAppointment.find({ doctorId: id }).sort({ createdAt: -1 }).limit(20).lean(),
      DoctorNotification.find({ doctorId: id }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    return res.json({
      doctor: mapDoctorPrivate(doctor),
      latestClinicChangeRequest,
      recentBookings: await mapDoctorBookingsForDashboard(recentBookings),
      recentNotifications: recentNotifications.map(mapDoctorNotificationRow),
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load doctor detail" });
  }
});

router.get("/admin/clinic-change-requests", isAdmin, async (req, res) => {
  try {
    const status = asText(req.query.status || "all").toLowerCase();
    const filter = {};
    if (status && status !== "all") filter.status = status;
    const rows = await ClinicChangeRequest.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ requests: rows });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load clinic change requests" });
  }
});

router.patch("/admin/clinic-change-requests/:id/status", isAdmin, async (req, res) => {
  try {
    const id = asText(req.params.id);
    const status = asText(req.body?.status).toLowerCase();
    const adminComment = asText(req.body?.adminComment || req.body?.note);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid request id" });
    if (!["pending_verification", "approved", "rejected", "needs_more_info"].includes(status)) {
      return res.status(400).json({ error: "Invalid clinic change status" });
    }
    const request = await ClinicChangeRequest.findById(id);
    if (!request) return res.status(404).json({ error: "Clinic change request not found" });
    request.status = status;
    request.adminComment = adminComment;
    request.reviewedAt = new Date();
    request.reviewedByAdminId = req.user?.adminId || null;
    await request.save();

    const doctor = await Doctor.findById(request.doctorId);
    if (doctor) {
      if (status === "approved") {
        doctor.verifiedClinicProfile = {
          verified: true,
          name: request.requestedClinic?.name || "",
          fullAddress: request.requestedClinic?.fullAddress || "",
          locality: request.requestedClinic?.locality || "",
          city: request.requestedClinic?.city || doctor.city,
          pincode: request.requestedClinic?.pincode || "",
          mapLabel: request.requestedClinic?.mapLabel || request.requestedClinic?.name || "",
          coordinates: request.requestedClinic?.coordinates || {},
          consultationDays: request.requestedClinic?.consultationDays || [],
          slotDurationMins: Number(request.requestedClinic?.slotDuration || 15),
          patientArrivalWindowMins: Number(request.requestedClinic?.arrivalWindow || 15),
          maxPatientsPerDay: Number(request.requestedClinic?.maxPatientsPerDay || 24),
          timingsText:
            request.requestedClinic?.startTime && request.requestedClinic?.endTime
              ? `${request.requestedClinic.startTime} - ${request.requestedClinic.endTime}`
              : doctor?.clinicProfile?.timingsText || "",
          inPersonEnabled: !!doctor?.consultModes?.inPerson,
        };
      }
      doctor.clinicChangeRequestActive = status === "pending_verification" || status === "needs_more_info";
      await doctor.save();
      await AdminAuditLog.create({
        adminId: req.user?.adminId || null,
        entityType: "ClinicChangeRequest",
        entityId: request._id,
        action: `clinic_change_${status}`,
        notes: adminComment,
        meta: { doctorId: doctor._id },
      });
      await createDoctorNotification({
        doctorId: doctor._id,
        type: "clinic_change_review",
        title: "Clinic change request updated",
        message: `Clinic change request is now ${status.replace(/_/g, " ")}`,
        entityType: "ClinicChangeRequest",
        entityId: request._id,
      });
    }

    return res.json({ request });
  } catch (err) {
    console.error("PATCH /doctors/admin/clinic-change-requests/:id/status error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update clinic change request" });
  }
});

async function handleAdminDoctorStatusUpdate(req, res) {
  try {
    const id = asText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid doctor id" });
    const status = asText(req.body?.status).toLowerCase();
    if (!VALID_ADMIN_STATES.has(status)) return res.status(400).json({ error: "Invalid verification status" });
    const note = asText(req.body?.note || "");
    const doctor = await Doctor.findById(id);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    doctor.verificationStatus = status;
    doctor.verificationNotes = note;
    doctor.verificationReviewedAt = new Date();
    doctor.verificationReviewedByAdminId = req.user?.adminId || null;
    doctor.active = status === "approved";
    if (status === "approved" && doctor.clinicProfile?.name && !doctor.verifiedClinicProfile?.name) {
      doctor.verifiedClinicProfile = {
        ...(doctor.clinicProfile || {}),
        verified: true,
        city: asText(doctor?.clinicProfile?.city || doctor.city),
        mapLabel: asText(doctor?.clinicProfile?.mapLabel || doctor?.clinicProfile?.name),
      };
    }
    await doctor.save();
    await AdminAuditLog.create({
      adminId: req.user?.adminId || null,
      entityType: "Doctor",
      entityId: doctor._id,
      action: `doctor_verification_${status}`,
      notes: note,
      meta: { doctorId: doctor._id },
    });
    pushDoctorNotification(
      doctor._id,
      "Verification status updated",
      `Your GoDavaii verification status is now: ${status.replace(/_/g, " ")}`,
      "verification_status"
    );
    return res.json({ doctor: mapDoctorPrivate(doctor) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update doctor verification status" });
  }
}

router.patch("/admin/:id/verification-status", isAdmin, handleAdminDoctorStatusUpdate);
router.patch("/admin/:id/status", isAdmin, handleAdminDoctorStatusUpdate);

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
      fullName: name,
      email,
      phone,
      passwordHash,
      specialty: asText(body.specialty) || "General Physician",
      qualification: asText(body.qualification),
      exp: Number(body.experience || body.exp || 0) || 0,
      experience: Number(body.experience || body.exp || 0) || 0,
      yearsExperience: Number(body.experience || body.exp || 0) || 0,
      clinicName: asText(body.clinicName || body.clinic),
      clinic: asText(body.clinicName || body.clinic),
      city: asText(body.city) || "Delhi",
      area: asText(body.area || ""),
      feeVideo: Number(body.feeVideo || 499),
      feeInPerson: Number(body.feeInPerson || 799),
      feeCall: Number(body.feeCall || body.feeVideo || 399),
      languages: Array.isArray(body.languages) && body.languages.length ? body.languages.map(asText).filter(Boolean) : ["English", "Hindi"],
      availability: body.availability && typeof body.availability === "object" ? body.availability : undefined,
      isPortalDoctor: true,
      active: true,
    });

    const token = jwt.sign(doctorTokenPayload(doctor), process.env.JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, doctor: mapDoctorPrivate(doctor) });
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

    const doctor = await Doctor.findOne({ email });
    if (!doctor || !doctor.passwordHash) return res.status(401).json({ error: "Invalid email or password" });
    const ok = await bcrypt.compare(password, doctor.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign(doctorTokenPayload(doctor), process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, doctor: mapDoctorPrivate(doctor) });
  } catch (err) {
    console.error("POST /doctors/login error:", err?.message || err);
    res.status(500).json({ error: "Failed to login doctor" });
  }
});

router.get("/me", doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.doctorAuth.doctorId).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    const [notificationRows, clinicChangeRequest] = await Promise.all([
      DoctorNotification.find({ doctorId: doctor._id }).sort({ createdAt: -1 }).limit(20).lean(),
      ClinicChangeRequest.findOne({ doctorId: doctor._id }).sort({ createdAt: -1 }).lean(),
    ]);
    res.json({
      doctor: mapDoctorPrivate(doctor),
      platformBand: getDoctorCommercialSnapshot(doctor).band,
      notifications: notificationRows.map(mapDoctorNotificationRow),
      clinicChangeRequest: mapClinicChangeRequestForDashboard(clinicChangeRequest),
    });
  } catch (err) {
    console.error("GET /doctors/me error:", err?.message || err);
    res.status(500).json({ error: "Failed to load doctor profile" });
  }
});

router.get("/me/notifications", doctorAuth, async (req, res) => {
  try {
    const rows = await DoctorNotification.find({ doctorId: req.doctorAuth.doctorId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ notifications: rows.map(mapDoctorNotificationRow) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load doctor notifications" });
  }
});

router.get("/me/notifications/stream", doctorAuth, async (req, res) => {
  streamDoctorNotifications(req, res, req.doctorAuth.doctorId);
});

router.patch("/me/notifications/:id/read", doctorAuth, async (req, res) => {
  try {
    const id = asText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid notification id" });
    await DoctorNotification.updateOne(
      { _id: id, doctorId: req.doctorAuth.doctorId },
      { $set: { read: true, readAt: new Date() } }
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update notification" });
  }
});

router.patch("/me/notifications/read-all", doctorAuth, async (req, res) => {
  try {
    await DoctorNotification.updateMany(
      { doctorId: req.doctorAuth.doctorId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to mark all notifications read" });
  }
});

router.get("/dashboard/self", doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.doctorAuth.doctorId).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    const [incomingRows, upcomingRows, notificationRows, clinicChangeRequest] = await Promise.all([
      DoctorAppointment.find({
        doctorId: doctor._id,
        status: { $in: ["confirmed", "pending"] },
        paymentStatus: "paid",
      }).sort({ appointmentAt: 1, createdAt: -1 }).limit(50).lean(),
      DoctorAppointment.find({
        doctorId: doctor._id,
        status: { $in: ["accepted", "upcoming", "live_now", "completed"] },
      }).sort({ appointmentAt: 1, createdAt: -1 }).limit(100).lean(),
      DoctorNotification.find({ doctorId: doctor._id }).sort({ createdAt: -1 }).limit(20).lean(),
      ClinicChangeRequest.findOne({ doctorId: doctor._id }).sort({ createdAt: -1 }).lean(),
    ]);

    const [incomingRequests, upcomingConsults] = await Promise.all([
      mapDoctorBookingsForDashboard(incomingRows),
      mapDoctorBookingsForDashboard(upcomingRows),
    ]);
    const notifications = notificationRows.map(mapDoctorNotificationRow);
    return res.json(
      buildDoctorDashboardPayload({
        doctor,
        incomingRequests,
        upcomingConsults,
        notifications,
        clinicChangeRequest: mapClinicChangeRequestForDashboard(clinicChangeRequest),
      })
    );
  } catch (err) {
    console.error("GET /doctors/dashboard/self error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load doctor dashboard" });
  }
});

router.get("/dashboard/me", doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.doctorAuth.doctorId).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    const [incomingRows, upcomingRows, notificationRows, clinicChangeRequest] = await Promise.all([
      DoctorAppointment.find({
        doctorId: doctor._id,
        status: { $in: ["confirmed", "pending"] },
        paymentStatus: "paid",
      }).sort({ appointmentAt: 1, createdAt: -1 }).limit(50).lean(),
      DoctorAppointment.find({
        doctorId: doctor._id,
        status: { $in: ["accepted", "upcoming", "live_now", "completed"] },
      }).sort({ appointmentAt: 1, createdAt: -1 }).limit(100).lean(),
      DoctorNotification.find({ doctorId: doctor._id }).sort({ createdAt: -1 }).limit(20).lean(),
      ClinicChangeRequest.findOne({ doctorId: doctor._id }).sort({ createdAt: -1 }).lean(),
    ]);

    const [incomingRequests, upcomingConsults] = await Promise.all([
      mapDoctorBookingsForDashboard(incomingRows),
      mapDoctorBookingsForDashboard(upcomingRows),
    ]);
    const notifications = notificationRows.map(mapDoctorNotificationRow);
    return res.json(
      buildDoctorDashboardPayload({
        doctor,
        incomingRequests,
        upcomingConsults,
        notifications,
        clinicChangeRequest: mapClinicChangeRequestForDashboard(clinicChangeRequest),
      })
    );
  } catch (err) {
    console.error("GET /doctors/dashboard/me error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load doctor dashboard" });
  }
});

router.get("/platform-band", doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.doctorAuth.doctorId).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    return res.json({ platformBand: formatFrontendPlatformBand(getDoctorCommercialSnapshot(doctor).band) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load platform fee band" });
  }
});

router.get("/dashboard/requests", doctorAuth, async (req, res) => {
  try {
    const rows = await DoctorAppointment.find({
      doctorId: req.doctorAuth.doctorId,
      status: { $in: ["confirmed", "pending"] },
      paymentStatus: "paid",
    }).sort({ appointmentAt: 1, createdAt: -1 }).limit(100).lean();
    return res.json({ requests: await mapDoctorBookingsForDashboard(rows) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load incoming requests" });
  }
});

router.get("/dashboard/incoming-requests", doctorAuth, async (req, res) => {
  try {
    const rows = await DoctorAppointment.find({
      doctorId: req.doctorAuth.doctorId,
      status: { $in: ["confirmed", "pending"] },
      paymentStatus: "paid",
    }).sort({ appointmentAt: 1, createdAt: -1 }).limit(100).lean();
    return res.json({ requests: await mapDoctorBookingsForDashboard(rows) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load incoming requests" });
  }
});

router.get("/dashboard/upcoming", doctorAuth, async (req, res) => {
  try {
    const rows = await DoctorAppointment.find({
      doctorId: req.doctorAuth.doctorId,
      status: { $in: ["accepted", "upcoming", "live_now", "completed"] },
    }).sort({ appointmentAt: 1, createdAt: -1 }).limit(100).lean();
    return res.json({ consults: await mapDoctorBookingsForDashboard(rows) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load upcoming consults" });
  }
});

router.get("/dashboard/upcoming-consults", doctorAuth, async (req, res) => {
  try {
    const rows = await DoctorAppointment.find({
      doctorId: req.doctorAuth.doctorId,
      status: { $in: ["accepted", "upcoming", "live_now", "completed"] },
    }).sort({ appointmentAt: 1, createdAt: -1 }).limit(100).lean();
    return res.json({ consults: await mapDoctorBookingsForDashboard(rows) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load upcoming consults" });
  }
});

router.get("/dashboard/next", doctorAuth, async (req, res) => {
  try {
    const row = await DoctorAppointment.findOne({
      doctorId: req.doctorAuth.doctorId,
      status: { $in: ["accepted", "upcoming", "live_now"] },
    }).sort({ appointmentAt: 1, createdAt: -1 }).lean();
    if (!row) return res.json({ consult: null });
    const patientMetaMap = await buildPatientMetaMap([row]);
    return res.json({ consult: mapDoctorBookingForDashboard(row, patientMetaMap.get(String(row.userId || "")) || null) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load next consult" });
  }
});

router.patch("/dashboard/online-status", doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.doctorAuth.doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    doctor.online = !!req.body?.online;
    await doctor.save();
    return res.json({ ok: true, online: !!doctor.online });
  } catch (err) {
    console.error("PATCH /doctors/dashboard/online-status error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update online status" });
  }
});

router.patch("/dashboard/settings", doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.doctorAuth.doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    const online = req.body?.online === undefined ? doctor.online : !!req.body.online;
    const modes = {
      audio: req.body?.modes?.audio === undefined ? !!doctor?.consultModes?.audio : !!req.body.modes.audio,
      video: req.body?.modes?.video === undefined ? !!doctor?.consultModes?.video : !!req.body.modes.video,
      inperson:
        req.body?.modes?.inperson === undefined
          ? !!doctor?.consultModes?.inPerson
          : !!req.body.modes.inperson,
    };
    const fees = {
      audio: modes.audio ? Number(req.body?.fees?.audio ?? doctor.feeCall ?? 0) : 0,
      video: modes.video ? Number(req.body?.fees?.video ?? doctor.feeVideo ?? 0) : 0,
      inperson: modes.inperson ? Number(req.body?.fees?.inperson ?? doctor.feeInPerson ?? 0) : 0,
    };
    const availability = req.body?.availability || {};
    let consultationDays = Array.isArray(availability.consultationDays)
      ? availability.consultationDays.map(asText).filter(Boolean)
      : getDoctorClinicForOps(doctor).consultationDays;
    const startTime = asText(availability.startTime || getDoctorClinicForOps(doctor).startTime || "09:00");
    const endTime = asText(availability.endTime || getDoctorClinicForOps(doctor).endTime || "13:00");
    const scheduleMode = asText(availability.scheduleMode).toLowerCase() === "custom" ? "custom" : "uniform";
    const customDaySlots = normalizeCustomDaySlots(availability.customDaySlots || {});
    const slotDuration = modes.inperson ? Number(availability.slotDuration || 15) : 0;
    const arrivalWindow = modes.inperson ? Number(availability.arrivalWindow || 15) : 0;
    const maxPatientsPerDay = modes.inperson ? Number(availability.maxPatientsPerDay || 24) : 0;
    const band = getPlatformFeeBandFromDoctorFees(fees, modes);
    const resolvedAvailability =
      scheduleMode === "custom" && modes.inperson
        ? customDaySlots
        : buildAvailabilityFromDashboard({
            consultationDays,
            startTime,
            endTime,
            enabled: modes.inperson,
          });

    if (scheduleMode === "custom" && modes.inperson) {
      consultationDays = Object.entries(resolvedAvailability)
        .filter(([, row]) => row?.enabled)
        .map(([day]) => day);
    }

    doctor.online = online;
    doctor.consultModes = {
      ...(doctor.consultModes?.toObject ? doctor.consultModes.toObject() : doctor.consultModes || {}),
      audio: modes.audio,
      video: modes.video,
      inPerson: modes.inperson,
    };
    doctor.feeCall = fees.audio;
    doctor.feeVideo = fees.video;
    doctor.feeInPerson = fees.inperson;
    doctor.consultationFee = Math.max(fees.audio || 0, fees.video || 0, fees.inperson || 0);
    doctor.platformFeeBand = {
      ...(doctor.platformFeeBand?.toObject ? doctor.platformFeeBand.toObject() : doctor.platformFeeBand || {}),
      bandKey: band.bandKey,
      serviceFee: Number(band.serviceFee || 0),
      gstLabel: band.gstLabel || "+ applicable GST",
      manualApprovalRequired: !!band.requiresManualApproval,
      updatedAt: new Date(),
    };

    doctor.clinicProfile = {
      ...(doctor.clinicProfile?.toObject ? doctor.clinicProfile.toObject() : doctor.clinicProfile || {}),
      inPersonEnabled: modes.inperson,
      consultationDays: modes.inperson ? consultationDays : [],
      timingsText: modes.inperson ? (scheduleMode === "custom" ? "Custom timings" : `${startTime} - ${endTime}`) : "",
      slotDurationMins: modes.inperson ? slotDuration : 0,
      patientArrivalWindowMins: modes.inperson ? arrivalWindow : 0,
      maxPatientsPerDay: modes.inperson ? maxPatientsPerDay : 0,
    };

    if (doctor?.verifiedClinicProfile?.name) {
      doctor.verifiedClinicProfile = {
        ...(doctor.verifiedClinicProfile?.toObject ? doctor.verifiedClinicProfile.toObject() : doctor.verifiedClinicProfile || {}),
        consultationDays: modes.inperson ? consultationDays : [],
        timingsText: modes.inperson ? (scheduleMode === "custom" ? "Custom timings" : `${startTime} - ${endTime}`) : "",
        slotDurationMins: modes.inperson ? slotDuration : 0,
        patientArrivalWindowMins: modes.inperson ? arrivalWindow : 0,
        maxPatientsPerDay: modes.inperson ? maxPatientsPerDay : 0,
        inPersonEnabled: modes.inperson,
      };
    }

    doctor.availability = modes.inperson
      ? resolvedAvailability
      : buildAvailabilityFromDashboard({
          consultationDays: [],
          startTime: "",
          endTime: "",
          enabled: false,
        });

    await doctor.save();

    return res.json({
      ok: true,
      doctor: {
        _id: String(doctor._id),
        online: !!doctor.online,
        modes: normalizeDoctorModes(doctor),
        fees: buildDoctorFeeShape(doctor),
        platformBand: formatFrontendPlatformBand(getDoctorCommercialSnapshot(doctor).band),
        clinic: getDoctorClinicForOps(doctor),
        availability: doctor.availability || {},
      },
    });
  } catch (err) {
    const details = err?.errors
      ? Object.fromEntries(
          Object.entries(err.errors).map(([key, value]) => [key, value?.message || "Invalid value"])
        )
      : err?.message || "Unknown error";
    console.error("PATCH /doctors/dashboard/settings error:", err);
    return res.status(500).json({ error: "Failed to update dashboard settings", details });
  }
});

router.post("/clinic-change-requests", doctorAuth, clinicChangeUpload, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.doctorAuth.doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    const lat = Number(req.body?.lat ?? req.body?.coordinates?.lat ?? null);
    const lng = Number(req.body?.lng ?? req.body?.coordinates?.lng ?? null);
    const proofDocument = getUploadedFileMeta(req.file);
    const requestedClinic = {
      verified: false,
      name: asText(req.body?.clinicName || req.body?.name),
      fullAddress: asText(req.body?.addressLine1 || req.body?.fullAddress),
      locality: asText(req.body?.locality),
      city: asText(req.body?.city || doctor.city),
      pincode: asText(req.body?.pin || req.body?.pincode),
      mapLabel: asText(req.body?.mapLabel || req.body?.clinicName || req.body?.name),
      coordinates: {
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
      },
      consultationDays: Array.isArray(req.body?.consultationDays) ? req.body.consultationDays.map(asText).filter(Boolean) : [],
      startTime: asText(req.body?.startTime),
      endTime: asText(req.body?.endTime),
      slotDuration: Number(req.body?.slotDuration || 15),
      arrivalWindow: Number(req.body?.arrivalWindow || 15),
      maxPatientsPerDay: Number(req.body?.maxPatientsPerDay || 24),
    };
    if (!requestedClinic.name || !requestedClinic.fullAddress || !requestedClinic.locality) {
      return res.status(400).json({ error: "Clinic name, address, and locality are required" });
    }
    if (!proofDocument.url) {
      return res.status(400).json({ error: "New clinic proof document is required" });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "New clinic map pin / location is required" });
    }

    const previousClinicSource = doctor.verifiedClinicProfile?.name ? doctor.verifiedClinicProfile : doctor.clinicProfile;
    const request = await ClinicChangeRequest.create({
      doctorId: doctor._id,
      previousClinic: {
        verified: !!previousClinicSource?.verified,
        name: asText(previousClinicSource?.name),
        fullAddress: asText(previousClinicSource?.fullAddress),
        locality: asText(previousClinicSource?.locality),
        city: asText(previousClinicSource?.city || doctor.city),
        pincode: asText(previousClinicSource?.pincode),
        mapLabel: asText(previousClinicSource?.mapLabel || previousClinicSource?.name),
        coordinates: previousClinicSource?.coordinates || {},
        consultationDays: previousClinicSource?.consultationDays || [],
        startTime: "",
        endTime: "",
        slotDuration: Number(previousClinicSource?.slotDurationMins || 15),
        arrivalWindow: Number(previousClinicSource?.patientArrivalWindowMins || 15),
        maxPatientsPerDay: Number(previousClinicSource?.maxPatientsPerDay || 24),
      },
      requestedClinic,
      proofDocument,
      locationCaptureSource: asText(req.body?.locationCaptureSource || "manual_pin") || "manual_pin",
      locationCapturedAt: new Date(),
    });

    doctor.clinicChangeRequestActive = true;
    doctor.latestClinicChangeRequestId = request._id;
    await doctor.save();
    await createDoctorNotification({
      doctorId: doctor._id,
      type: "needs_action",
      title: "Clinic change submitted",
      message: "Clinic change request submitted for re-verification",
      entityType: "ClinicChangeRequest",
      entityId: request._id,
    });
    return res.status(201).json({ request: mapClinicChangeRequestForDashboard(request) });
  } catch (err) {
    console.error("POST /doctors/clinic-change-requests error:", err?.message || err);
    return res.status(500).json({ error: "Failed to submit clinic change request" });
  }
});

router.get("/clinic-change-requests/latest", doctorAuth, async (req, res) => {
  try {
    const request = await ClinicChangeRequest.findOne({ doctorId: req.doctorAuth.doctorId }).sort({ createdAt: -1 }).lean();
    return res.json({ request: mapClinicChangeRequestForDashboard(request) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load clinic change request" });
  }
});

router.put("/me/availability", doctorAuth, async (req, res) => {
  try {
    const availability = req.body?.availability;
    if (!availability || typeof availability !== "object") {
      return res.status(400).json({ error: "availability object is required" });
    }
    const doctor = await Doctor.findById(req.doctorAuth.doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    doctor.availability = availability;
    if (!doctor?.consultModes?.inPerson) {
      doctor.clinicProfile = {
        ...(doctor.clinicProfile || {}),
        slotDurationMins: 0,
        patientArrivalWindowMins: 0,
        maxPatientsPerDay: 0,
        consultationDays: [],
        timingsText: "",
        inPersonEnabled: false,
      };
    }
    await doctor.save();
    res.json({ doctor: mapDoctorPrivate(doctor) });
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

    const doctor = await Doctor.findById(req.doctorAuth.doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    Object.assign(doctor, patch);
    if (!doctor?.consultModes?.audio) doctor.feeCall = 0;
    if (!doctor?.consultModes?.video) doctor.feeVideo = 0;
    if (!doctor?.consultModes?.inPerson) doctor.feeInPerson = 0;
    const band = getPlatformFeeBandFromDoctorFees(
      { audio: doctor.feeCall, video: doctor.feeVideo, inperson: doctor.feeInPerson },
      { audio: doctor?.consultModes?.audio, video: doctor?.consultModes?.video, inperson: doctor?.consultModes?.inPerson }
    );
    doctor.platformFeeBand = {
      bandKey: band.bandKey,
      serviceFee: band.serviceFee,
      gstLabel: band.gstLabel,
      manualApprovalRequired: band.requiresManualApproval,
      updatedAt: new Date(),
    };
    doctor.consultationFee = Math.max(Number(doctor.feeCall || 0), Number(doctor.feeVideo || 0), Number(doctor.feeInPerson || 0));
    await doctor.save();
    res.json({ doctor: mapDoctorPrivate(doctor), platformBand: band });
  } catch (err) {
    console.error("PUT /doctors/me/fees error:", err?.message || err);
    res.status(500).json({ error: "Failed to update fees" });
  }
});

router.put("/me/modes-clinic", doctorAuth, async (req, res) => {
  try {
    const modeAudio = ["yes", "true", "1"].includes(asText(req.body?.modeAudio).toLowerCase()) || req.body?.modeAudio === true;
    const modeVideo = ["yes", "true", "1"].includes(asText(req.body?.modeVideo).toLowerCase()) || req.body?.modeVideo === true;
    const modeInPerson = ["yes", "true", "1"].includes(asText(req.body?.modeInPerson).toLowerCase()) || req.body?.modeInPerson === true;
    const clinicProfile = {
      name: asText(req.body?.clinicName),
      fullAddress: asText(req.body?.clinicAddress),
      locality: asText(req.body?.clinicLocality),
      pincode: asText(req.body?.clinicPincode),
      coordinates: {
        lat: Number(req.body?.clinicLat),
        lng: Number(req.body?.clinicLng),
      },
      slotDurationMins: Number(req.body?.slotDurationMins || 15),
      patientArrivalWindowMins: Number(req.body?.patientArrivalWindowMins || 15),
      maxPatientsPerDay: Number(req.body?.maxPatientsPerDay || 24),
      consultationDays: Array.isArray(req.body?.consultationDays) ? req.body.consultationDays.map(asText).filter(Boolean) : ["mon", "tue", "wed", "thu", "fri"],
      timingsText: asText(req.body?.timingsText),
      inPersonEnabled: !!modeInPerson,
    };

    const doctor = await Doctor.findById(req.doctorAuth.doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    doctor.consultModes = { audio: !!modeAudio, video: !!modeVideo, inPerson: !!modeInPerson };
    if (!modeAudio) doctor.feeCall = 0;
    if (!modeVideo) doctor.feeVideo = 0;
    if (!modeInPerson) doctor.feeInPerson = 0;
    const currentVerified = doctor.verifiedClinicProfile?.name ? doctor.verifiedClinicProfile : doctor.clinicProfile;
    const clinicChanged =
      asText(currentVerified?.name) !== asText(clinicProfile.name) ||
      asText(currentVerified?.fullAddress) !== asText(clinicProfile.fullAddress) ||
      asText(currentVerified?.locality) !== asText(clinicProfile.locality) ||
      asText(currentVerified?.pincode) !== asText(clinicProfile.pincode) ||
      Number(currentVerified?.coordinates?.lat || 0) !== Number(clinicProfile.coordinates?.lat || 0) ||
      Number(currentVerified?.coordinates?.lng || 0) !== Number(clinicProfile.coordinates?.lng || 0);

    if (clinicChanged && doctor.verifiedClinicProfile?.name) {
      const request = await ClinicChangeRequest.create({
        doctorId: doctor._id,
        previousClinic: {
          verified: !!currentVerified?.verified,
          name: asText(currentVerified?.name),
          fullAddress: asText(currentVerified?.fullAddress),
          locality: asText(currentVerified?.locality),
          city: asText(currentVerified?.city || doctor.city),
          pincode: asText(currentVerified?.pincode),
          mapLabel: asText(currentVerified?.mapLabel || currentVerified?.name),
          coordinates: currentVerified?.coordinates || {},
          consultationDays: currentVerified?.consultationDays || [],
          startTime: "",
          endTime: "",
          slotDuration: Number(currentVerified?.slotDurationMins || 15),
          arrivalWindow: Number(currentVerified?.patientArrivalWindowMins || 15),
          maxPatientsPerDay: Number(currentVerified?.maxPatientsPerDay || 24),
        },
        requestedClinic: {
          verified: false,
          name: clinicProfile.name,
          fullAddress: clinicProfile.fullAddress,
          locality: clinicProfile.locality,
          city: asText(req.body?.clinicCity || doctor.city),
          pincode: clinicProfile.pincode,
          mapLabel: asText(req.body?.mapLabel || clinicProfile.name),
          coordinates: clinicProfile.coordinates,
          consultationDays: clinicProfile.consultationDays,
          startTime: "",
          endTime: "",
          slotDuration: clinicProfile.slotDurationMins,
          arrivalWindow: clinicProfile.patientArrivalWindowMins,
          maxPatientsPerDay: clinicProfile.maxPatientsPerDay,
        },
      });
      doctor.clinicChangeRequestActive = true;
      doctor.latestClinicChangeRequestId = request._id;
    } else {
      doctor.clinicProfile = {
        ...(doctor.clinicProfile || {}),
        ...clinicProfile,
        verified: !!doctor.clinicProfile?.verified,
      };
      if (!doctor.verifiedClinicProfile?.name) {
        doctor.verifiedClinicProfile = {
          ...(doctor.verifiedClinicProfile || {}),
          ...doctor.clinicProfile,
          verified: doctor.verificationStatus === "approved",
          city: asText(req.body?.clinicCity || doctor.city),
          mapLabel: asText(req.body?.mapLabel || clinicProfile.name),
        };
      }
    }
    doctor.clinicProfile = {
      ...(doctor.clinicProfile || {}),
      ...clinicProfile,
      city: asText(req.body?.clinicCity || doctor.city),
      mapLabel: asText(req.body?.mapLabel || clinicProfile.name),
    };
    if (!modeInPerson) {
      doctor.clinicProfile.slotDurationMins = 0;
      doctor.clinicProfile.patientArrivalWindowMins = 0;
      doctor.clinicProfile.maxPatientsPerDay = 0;
      doctor.clinicProfile.consultationDays = [];
      doctor.clinicProfile.timingsText = "";
      doctor.availability = buildAvailabilityFromDashboard({ consultationDays: [], startTime: "", endTime: "", enabled: false });
    } else if (Array.isArray(clinicProfile.consultationDays) && clinicProfile.consultationDays.length) {
      const range = parseTimingRangeFromText(clinicProfile.timingsText) || { start: "09:00", end: "13:00" };
      doctor.availability = buildAvailabilityFromDashboard({
        consultationDays: clinicProfile.consultationDays,
        startTime: range.start,
        endTime: range.end,
        enabled: true,
      });
    }
    doctor.clinicName = clinicProfile.name || doctor.clinicName;
    doctor.clinic = clinicProfile.locality || doctor.clinic;
    const band = getPlatformFeeBandFromDoctorFees(
      { audio: doctor.feeCall, video: doctor.feeVideo, inperson: modeInPerson ? doctor.feeInPerson : 0 },
      { audio: modeAudio, video: modeVideo, inperson: modeInPerson }
    );
    doctor.platformFeeBand = {
      bandKey: band.bandKey,
      serviceFee: band.serviceFee,
      gstLabel: band.gstLabel,
      manualApprovalRequired: band.requiresManualApproval,
      updatedAt: new Date(),
    };
    await doctor.save();
    return res.json({ doctor: mapDoctorPrivate(doctor), clinicChangeRequestActive: doctor.clinicChangeRequestActive });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update mode/clinic settings" });
  }
});

router.get("/specialties", async (_req, res) => {
  try {
    await ensureDefaultDoctors();
    const specialties = await Doctor.distinct("specialty", publicDoctorFilter());
    const merged = Array.from(new Set([...MASTER_SPECIALTIES, ...specialties.filter(Boolean)]));
    res.json(["All", ...merged.sort((a, b) => a.localeCompare(b))]);
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
    const mode = normalizeMode(req.query.mode || "video");
    const sort = asText(req.query.sort || "soonest").toLowerCase();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const filter = publicDoctorFilter();
    if (specialty && specialty.toLowerCase() !== "all") filter.specialty = specialty;
    if (city) filter.city = new RegExp(city, "i");
    if (mode === "inperson") {
      filter.$and = [...(filter.$and || []), { $or: [{ "consultModes.inPerson": true }, { consultModes: { $exists: false } }] }];
    } else if (mode === "call") {
      filter.$and = [
        ...(filter.$and || []),
        { $or: [{ "consultModes.audio": true }, { consultModes: { $exists: false } }] },
        { online: true },
      ];
    } else {
      filter.$and = [
        ...(filter.$and || []),
        { $or: [{ "consultModes.video": true }, { consultModes: { $exists: false } }] },
        { online: true },
      ];
    }
    if (q) {
      const re = new RegExp(q, "i");
      filter.$and = [
        ...(filter.$and || []),
        { $or: [{ name: re }, { specialty: re }, { tags: re }, { clinic: re }, { clinicName: re }] },
      ];
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

    res.json({ page, limit, total, hasMore: page * limit < total, doctors: docs.map(mapDoctorPublic) });
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
    const mode = normalizeMode(req.query.mode || "video");
    if (!mongoose.Types.ObjectId.isValid(doctorId)) return res.status(400).json({ error: "Invalid doctor id" });
    if (!VALID_MODES.has(mode)) return res.status(400).json({ error: "mode must be video, inperson, or call" });

    const date = asText(req.query.date);
    const startDate = asText(req.query.startDate || date || new Date().toISOString().slice(0, 10));
    const days = date ? 1 : Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const start = parseISODateOnly(startDate);
    if (!start) return res.status(400).json({ error: "Invalid date/startDate format. Use YYYY-MM-DD" });

    const doctor = await Doctor.findOne({ _id: doctorId, active: true }).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    if ((mode === "video" || mode === "call") && !doctor.online) {
      return res.status(409).json({ error: "Doctor is currently offline for online consultations" });
    }

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
      const list = slots.map((s) => ({ slot: s, available: !occupied.has(s) && !isPastSlot(d, s) }));
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
    const doctor = await Doctor.findOne({ ...publicDoctorFilter(), _id: id }).lean();
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    res.json({ doctor: mapDoctorPublic(doctor) });
  } catch (err) {
    console.error("GET /doctors/:id error:", err?.message || err);
    res.status(500).json({ error: "Failed to load doctor profile" });
  }
});

router.post("/appointments", auth, consultRecordUpload, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;
    const doctorId = asText(req.body?.doctorId);
    const mode = normalizeMode(req.body?.mode || "video");
    const date = asText(req.body?.date);
    const slot = asText(req.body?.slot);
    const patientType = asText(req.body?.patientType || "self").toLowerCase();
    const patientName = asText(req.body?.patientName) || (patientType === "self" ? "Self" : "Family Member");
    const reason = asText(req.body?.reason) || "General consultation";
    const paymentMethod = asText(req.body?.paymentMethod || "");
    const patientSummary = asText(req.body?.patientSummary || "");
    const symptoms = asText(req.body?.symptoms || req.body?.reason || "");
    const patientAttachments = getUploadedFilesMeta(req.files);

    if (!mongoose.Types.ObjectId.isValid(String(userId))) return res.status(401).json({ error: "Invalid user token" });
    if (!mongoose.Types.ObjectId.isValid(doctorId)) return res.status(400).json({ error: "Invalid doctorId" });
    if (!VALID_MODES.has(mode)) return res.status(400).json({ error: "mode must be video, inperson, or call" });
    if (!parseISODateOnly(date) || !slot) return res.status(400).json({ error: "date and slot are required" });
    if (isPastSlot(date, slot)) return res.status(409).json({ error: "Cannot book past slots" });

    const doctor = await Doctor.findById(doctorId);
    if (!doctor || !doctor.active) return res.status(404).json({ error: "Doctor not found" });
    if (doctor.verificationStatus && doctor.verificationStatus !== "approved") {
      return res.status(409).json({ error: "Doctor profile is not approved for booking yet" });
    }
    if ((mode === "video" || mode === "call") && !doctor.online) {
      return res.status(409).json({ error: "Doctor is currently offline for online consultations" });
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
    if (!getDoctorSlotPool(doctor, date, mode).includes(slot)) {
      return res.status(400).json({ error: "Invalid slot for selected doctor/date/mode" });
    }
    if (await isSlotTaken({ doctorId, mode, date, slot })) {
      return res.status(409).json({ error: "Slot already booked" });
    }

    const appointmentAt = buildAppointmentAt(date, slot);
    if (!appointmentAt) return res.status(400).json({ error: "Invalid date/slot combination" });
    const baseFee = mode === "inperson" ? Number(doctor.feeInPerson || 0) : mode === "call" ? Number(doctor.feeCall || 0) : Number(doctor.feeVideo || 0);
    const band = doctor.platformFeeBand?.bandKey ? doctor.platformFeeBand : computePlatformBand(baseFee);
    const fee = bundledFee(baseFee);
    const paymentRef = `CONSULT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

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
      patientSummary,
      symptoms,
      reason,
      patientAttachments,
      fee,
      bundledPriceLabel: mode === "inperson" ? `In-Person Visit Rs ${fee}` : `Consultation Rs ${fee}`,
      platformFeeBandApplied: band,
      paymentMethod,
      paymentStatus: "pending",
      amountPaid: 0,
      status: "pending_payment",
      holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      paymentRef,
      clinicLocationSnapshot: {
        clinicName: asText(doctor?.clinicProfile?.name || doctor?.clinicName || doctor?.clinic || ""),
        locality: asText(doctor?.clinicProfile?.locality || doctor?.city || ""),
        fullAddress: asText(doctor?.clinicProfile?.fullAddress || ""),
        pincode: asText(doctor?.clinicProfile?.pincode || ""),
        mapLabel: asText(doctor?.clinicProfile?.mapLabel || doctor?.clinicProfile?.name || doctor?.clinicName || doctor?.clinic || ""),
        coordinates: doctor?.clinicProfile?.coordinates || {},
      },
      locationUnlockedForPatient: false,
    });

    res.status(201).json({
      appointment,
      paymentIntent: {
        paymentRef,
        amount: fee,
        currency: "INR",
        note: "Complete payment to confirm booking",
      },
    });
  } catch (err) {
    console.error("POST /doctors/appointments error:", err?.message || err);
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

module.exports = router;


