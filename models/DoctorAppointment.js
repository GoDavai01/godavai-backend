const mongoose = require("mongoose");

const doctorAppointmentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    doctorName: { type: String, default: "" },
    specialty: { type: String, default: "" },
    mode: { type: String, enum: ["video", "inperson", "call"], required: true, index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    dateLabel: { type: String, default: "" },
    slot: { type: String, required: true, index: true },
    appointmentAt: { type: Date, required: true, index: true },
    patientType: { type: String, enum: ["self", "family", "new"], default: "self" },
    patientName: { type: String, default: "Self" },
    reason: { type: String, default: "" },
    fee: { type: Number, default: 0 },
    status: { type: String, enum: ["confirmed", "cancelled", "completed"], default: "confirmed", index: true },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: "" },
  },
  { timestamps: true }
);

doctorAppointmentSchema.index({ doctorId: 1, date: 1, slot: 1, mode: 1, status: 1 });
doctorAppointmentSchema.index({ userId: 1, appointmentAt: 1, createdAt: -1 });

module.exports = mongoose.models.DoctorAppointment || mongoose.model("DoctorAppointment", doctorAppointmentSchema);
