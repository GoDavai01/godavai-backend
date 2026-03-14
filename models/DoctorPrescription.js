const mongoose = require("mongoose");

const medicineRowSchema = new mongoose.Schema(
  {
    prescribed: { type: String, required: true, trim: true },
    salt: { type: String, default: "", trim: true },
    dosage: { type: String, default: "", trim: true },
    frequency: { type: String, default: "", trim: true },
    duration: { type: String, default: "", trim: true },
    howToTake: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const doctorPrescriptionSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorAppointment", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    diagnosis: { type: String, default: "", trim: true },
    complaint: { type: String, default: "", trim: true },
    precautions: { type: String, default: "", trim: true },
    testsAdvised: { type: [String], default: [] },
    followUpDate: { type: Date, default: null },
    medicines: { type: [medicineRowSchema], default: [] },
    branding: {
      type: String,
      default: "GoDavaii Rx",
      trim: true,
    },
    sentToPatient: { type: Boolean, default: false, index: true },
    sentToPatientAt: { type: Date, default: null },
    cartDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "PatientCartDraft", default: null },
  },
  { timestamps: true }
);

doctorPrescriptionSchema.index({ doctorId: 1, createdAt: -1 });
doctorPrescriptionSchema.index({ patientId: 1, createdAt: -1 });

module.exports =
  mongoose.models.DoctorPrescription || mongoose.model("DoctorPrescription", doctorPrescriptionSchema);
