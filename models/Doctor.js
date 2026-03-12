const mongoose = require("mongoose");

const daySchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    start: { type: String, default: "09:00" },
    end: { type: String, default: "13:00" },
  },
  { _id: false }
);

const availabilitySchema = new mongoose.Schema(
  {
    mon: { type: daySchema, default: () => ({}) },
    tue: { type: daySchema, default: () => ({}) },
    wed: { type: daySchema, default: () => ({}) },
    thu: { type: daySchema, default: () => ({}) },
    fri: { type: daySchema, default: () => ({}) },
    sat: { type: daySchema, default: () => ({ enabled: false }) },
    sun: { type: daySchema, default: () => ({ enabled: false }) },
  },
  { _id: false }
);

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true, index: true },
    phone: { type: String, trim: true, default: "" },
    passwordHash: { type: String, default: "" },
    clinicName: { type: String, default: "" },
    experience: { type: Number, default: 0 },
    licenseNumber: { type: String, trim: true, default: "" },
    specialty: { type: String, required: true, trim: true, index: true },
    rating: { type: Number, default: 4.5 },
    exp: { type: Number, default: 5 },
    languages: { type: [String], default: ["English"] },
    city: { type: String, default: "Delhi", index: true },
    feeVideo: { type: Number, default: 499 },
    feeInPerson: { type: Number, default: 799 },
    feeCall: { type: Number, default: 399 },
    clinic: { type: String, default: "" },
    tags: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    availability: { type: availabilitySchema, default: () => ({}) },
    isPortalDoctor: { type: Boolean, default: false, index: true },
    onboardingStep: { type: Number, default: 1 },
    onboardingCompletedAt: { type: Date, default: null },
    verificationStatus: {
      type: String,
      enum: ["pending_verification", "approved", "rejected", "needs_more_info", "suspended"],
      default: "pending_verification",
      index: true,
    },
    verificationNotes: { type: String, default: "", trim: true },
    verificationReviewedAt: { type: Date, default: null },
    verificationReviewedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    doctorOtpVerified: { type: Boolean, default: false },
    consultModes: {
      audio: { type: Boolean, default: true },
      video: { type: Boolean, default: true },
      inPerson: { type: Boolean, default: false },
    },
    consultationFee: { type: Number, default: 499 },
    platformFeeBand: {
      bandKey: { type: String, default: "0_500", trim: true },
      serviceFee: { type: Number, default: 19 },
      gstLabel: { type: String, default: "+ applicable GST", trim: true },
      manualApprovalRequired: { type: Boolean, default: false },
      updatedAt: { type: Date, default: Date.now },
    },
    commercialTermsAcceptedAt: { type: Date, default: null },
    consents: {
      registeredDoctorConfirmed: { type: Boolean, default: false },
      verificationConsent: { type: Boolean, default: false },
      teleconsultTermsConsent: { type: Boolean, default: false },
      platformFeeTermsConsent: { type: Boolean, default: false },
    },
    documents: {
      registrationNumber: { type: String, default: "", trim: true },
      registrationCertificateUrl: { type: String, default: "", trim: true },
      mbbsDegreeUrl: { type: String, default: "", trim: true },
      specialistDegreeUrl: { type: String, default: "", trim: true },
      panUrl: { type: String, default: "", trim: true },
      bankProofUrl: { type: String, default: "", trim: true },
      clinicProofUrl: { type: String, default: "", trim: true },
      specialistRequired: { type: Boolean, default: false },
    },
    clinicProfile: {
      name: { type: String, default: "", trim: true },
      fullAddress: { type: String, default: "", trim: true },
      locality: { type: String, default: "", trim: true },
      pincode: { type: String, default: "", trim: true },
      coordinates: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
      patientArrivalWindowMins: { type: Number, default: 15 },
      slotDurationMins: { type: Number, default: 15 },
      maxPatientsPerDay: { type: Number, default: 24 },
      consultationDays: { type: [String], default: ["mon", "tue", "wed", "thu", "fri"] },
      timingsText: { type: String, default: "", trim: true },
      inPersonEnabled: { type: Boolean, default: false },
    },
    // Optional per-day slot override { "2026-03-08": { video: [...], inperson: [...], call: [...] } }
    slotOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

doctorSchema.index({ name: "text", specialty: "text", tags: "text" });

module.exports = mongoose.models.Doctor || mongoose.model("Doctor", doctorSchema);
