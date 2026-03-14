const mongoose = require("mongoose");

const doctorNotificationSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    type: { type: String, default: "info", trim: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorAppointment", default: null },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    scheduledFor: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    entityType: { type: String, default: "", trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.models.DoctorNotification || mongoose.model("DoctorNotification", doctorNotificationSchema);
