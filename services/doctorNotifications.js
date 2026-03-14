const EventEmitter = require("events");
const mongoose = require("mongoose");
const DoctorNotification = require("../models/DoctorNotification");
const DoctorAppointment = require("../models/DoctorAppointment");
const Notification = require("../models/Notification");

const emitter = global.__GODAVAI_DOCTOR_NOTIFICATION_EMITTER__ || new EventEmitter();
global.__GODAVAI_DOCTOR_NOTIFICATION_EMITTER__ = emitter;

function emitDoctorNotification(doctorId, payload) {
  if (!doctorId) return;
  emitter.emit(`doctor:${String(doctorId)}`, payload);
}

async function createDoctorNotification({ doctorId, type, title, message, bookingId = null, meta = {}, entityType = "", entityId = null, scheduledFor = null }) {
  const notification = await DoctorNotification.create({
    doctorId,
    type,
    title,
    message,
    bookingId,
    meta,
    entityType,
    entityId,
    scheduledFor,
    sentAt: new Date(),
  });
  emitDoctorNotification(doctorId, notification.toObject());
  return notification;
}

async function createPatientNotification({ userId, title, message }) {
  return Notification.create({ userId, title, message, read: false });
}

function streamDoctorNotifications(req, res, doctorId) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const channel = `doctor:${String(doctorId)}`;
  const onMessage = (payload) => {
    res.write(`event: doctor-notification\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 25000);

  emitter.on(channel, onMessage);
  req.on("close", () => {
    clearInterval(keepAlive);
    emitter.off(channel, onMessage);
  });
}

async function sendReminderForAppointment(appointment, reminderType) {
  if (!appointment?.doctorId) return;
  const reminderTitles = {
    reminder_30: "Consult starts in 30 minutes",
    reminder_10: "Consult starts in 10 minutes",
    reminder_now: "Consult is starting now",
  };
  const reminderMessages = {
    reminder_30: `${appointment.patientName || "Patient"} • ${appointment.slot} • ${appointment.mode}`,
    reminder_10: `${appointment.patientName || "Patient"} • ${appointment.slot} • ${appointment.mode}`,
    reminder_now: `${appointment.patientName || "Patient"} is ready for ${appointment.mode}`,
  };
  await createDoctorNotification({
    doctorId: appointment.doctorId,
    type: reminderType,
    title: reminderTitles[reminderType],
    message: reminderMessages[reminderType],
    bookingId: appointment._id,
    entityType: "DoctorAppointment",
    entityId: appointment._id,
    scheduledFor: appointment.appointmentAt,
  });
}

function bootstrapDoctorReminderScheduler() {
  if (global.__GODAVAI_DOCTOR_REMINDER_SCHEDULER__) return;
  global.__GODAVAI_DOCTOR_REMINDER_SCHEDULER__ = setInterval(async () => {
    try {
      const now = new Date();
      const nextWindow = new Date(now.getTime() + 31 * 60 * 1000);
      const appointments = await DoctorAppointment.find({
        appointmentAt: { $gte: new Date(now.getTime() - 2 * 60 * 1000), $lte: nextWindow },
        status: { $in: ["confirmed", "pending", "accepted", "upcoming", "live_now"] },
        paymentStatus: "paid",
      })
        .select("_id doctorId patientName slot mode appointmentAt reminderKeysSent")
        .lean();

      for (const appointment of appointments) {
        const diffMins = Math.round((new Date(appointment.appointmentAt).getTime() - now.getTime()) / 60000);
        const sent = Array.isArray(appointment.reminderKeysSent) ? appointment.reminderKeysSent : [];
        const toSend = [];
        if (diffMins <= 30 && diffMins > 10 && !sent.includes("reminder_30")) toSend.push("reminder_30");
        if (diffMins <= 10 && diffMins > 0 && !sent.includes("reminder_10")) toSend.push("reminder_10");
        if (diffMins <= 0 && diffMins >= -2 && !sent.includes("reminder_now")) toSend.push("reminder_now");
        if (!toSend.length) continue;

        for (const reminderType of toSend) {
          await sendReminderForAppointment(appointment, reminderType);
        }
        await DoctorAppointment.updateOne(
          { _id: appointment._id },
          { $addToSet: { reminderKeysSent: { $each: toSend } } }
        );
      }
    } catch (err) {
      console.error("doctor reminder scheduler error:", err?.message || err);
    }
  }, 60000);
}

module.exports = {
  createDoctorNotification,
  createPatientNotification,
  streamDoctorNotifications,
  bootstrapDoctorReminderScheduler,
};
