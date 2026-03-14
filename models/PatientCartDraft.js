const mongoose = require("mongoose");

const matchedProductSchema = new mongoose.Schema(
  {
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", default: null },
    medicineMasterId: { type: mongoose.Schema.Types.ObjectId, ref: "MedicineMaster", default: null },
    name: { type: String, default: "", trim: true },
    price: { type: Number, default: 0 },
    mrp: { type: Number, default: 0 },
    qty: { type: Number, default: 0 },
    composition: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const cartItemSchema = new mongoose.Schema(
  {
    prescribedMedicine: { type: String, default: "", trim: true },
    salt: { type: String, default: "", trim: true },
    dosage: { type: String, default: "", trim: true },
    frequency: { type: String, default: "", trim: true },
    duration: { type: String, default: "", trim: true },
    howToTake: { type: String, default: "", trim: true },
    matchedBrand: { type: matchedProductSchema, default: () => ({}) },
    generic: { type: matchedProductSchema, default: () => ({}) },
    genericAvailable: { type: Boolean, default: false },
    savings: { type: Number, default: 0 },
    switchedToGeneric: { type: Boolean, default: false },
    requiresReview: { type: Boolean, default: false },
    sensitive: { type: Boolean, default: false },
  },
  { timestamps: false }
);

const patientCartDraftSchema = new mongoose.Schema(
  {
    prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorPrescription", required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorAppointment", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [cartItemSchema], default: [] },
    totals: {
      brandTotal: { type: Number, default: 0 },
      genericTotal: { type: Number, default: 0 },
      potentialSavings: { type: Number, default: 0 },
    },
    status: { type: String, enum: ["draft", "converted", "expired"], default: "draft", index: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.PatientCartDraft || mongoose.model("PatientCartDraft", patientCartDraftSchema);
