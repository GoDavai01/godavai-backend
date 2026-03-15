const mongoose = require("mongoose");

const doctorAppointmentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    doctorName: { type: String, default: "" },
    specialty: { type: String, default: "" },
    mode: { type: String, enum: ["video", "inperson", "call", "audio"], required: true, index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    dateLabel: { type: String, default: "" },
    slot: { type: String, required: true, index: true },
    appointmentAt: { type: Date, required: true, index: true },
    patientType: { type: String, enum: ["self", "family", "new"], default: "self" },
    patientName: { type: String, default: "Self" },
    patientSummary: { type: String, default: "" },
    symptoms: { type: String, default: "" },
    reason: { type: String, default: "" },
    patientAttachments: {
      type: [
        {
          url: { type: String, default: "", trim: true },
          fileName: { type: String, default: "", trim: true },
          mimeType: { type: String, default: "", trim: true },
          size: { type: Number, default: 0 },
          category: { type: String, default: "medical_record", trim: true },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    fee: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ["upi", "card", "netbanking", "cash", ""], default: "" },
    paymentStatus: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending", index: true },
    transactionId: { type: String, default: "" },
    paymentRef: { type: String, default: "" },
    amountPaid: { type: Number, default: 0 },
    refundStatus: { type: String, enum: ["none", "initiated", "completed", "failed"], default: "none" },
    refundedAt: { type: Date, default: null },
    bundledPriceLabel: { type: String, default: "" },
    platformFeeBandApplied: {
      bandKey: { type: String, default: "", trim: true },
      serviceFee: { type: Number, default: 0 },
      gstLabel: { type: String, default: "", trim: true },
      manualApprovalRequired: { type: Boolean, default: false },
    },
    clinicLocationSnapshot: {
      clinicName: { type: String, default: "", trim: true },
      locality: { type: String, default: "", trim: true },
      fullAddress: { type: String, default: "", trim: true },
      pincode: { type: String, default: "", trim: true },
      mapLabel: { type: String, default: "", trim: true },
      coordinates: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },
    locationUnlockedForPatient: { type: Boolean, default: false },
    clinicRevealAllowed: { type: Boolean, default: false, index: true },
    reminderStates: {
      reminder30SentAt: { type: Date, default: null },
      reminder10SentAt: { type: Date, default: null },
      reminderNowSentAt: { type: Date, default: null },
    },
    reminderKeysSent: { type: [String], default: [] },
    consultRoomId: { type: String, default: "", trim: true, index: true },
    consultSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsultSession", default: null },
    joinedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    callState: { type: String, enum: ["not_started", "ready", "live", "ended"], default: "not_started", index: true },
    doctorNotes: { type: String, default: "" },
    internalNotes: { type: String, default: "" },
    doctorAction: {
      type: String,
      enum: ["none", "accepted", "rescheduled", "rejected", "cancelled"],
      default: "none",
      index: true,
    },
    doctorActionAt: { type: Date, default: null },
    rescheduledAt: { type: Date, default: null },
    prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorPrescription", default: null },
    prescription: {
      fileUrl: { type: String, default: "", trim: true },
      fileName: { type: String, default: "", trim: true },
      notes: { type: String, default: "", trim: true },
      uploadedAt: { type: Date, default: null },
      uploadedByDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", default: null },
    },
    holdExpiresAt: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ["pending_payment", "confirmed", "pending", "accepted", "upcoming", "live_now", "completed", "cancelled", "rejected", "no_show", "refunded"],
      default: "pending_payment",
      index: true,
    },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: "" },
  },
  { timestamps: true }
);

doctorAppointmentSchema.index({ doctorId: 1, date: 1, slot: 1, mode: 1, status: 1 });
doctorAppointmentSchema.index({ userId: 1, appointmentAt: 1, createdAt: -1 });

module.exports = mongoose.models.DoctorAppointment || mongoose.model("DoctorAppointment", doctorAppointmentSchema);

