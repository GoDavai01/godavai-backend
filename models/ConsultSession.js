const mongoose = require("mongoose");

const consultSessionSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorAppointment", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    roomId: { type: String, required: true, trim: true, index: true },
    mode: { type: String, enum: ["video", "inperson", "call", "audio"], required: true, index: true },
    state: { type: String, enum: ["ready", "live", "ended"], default: "ready", index: true },
    joinedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    doctorNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ConsultSession || mongoose.model("ConsultSession", consultSessionSchema);
