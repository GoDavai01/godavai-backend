const mongoose = require("mongoose");

const bookingItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, trim: true },
    type: { type: String, enum: ["test", "package"], required: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0 },
    reportTime: { type: String, default: "24 hrs", trim: true },
  },
  { _id: false }
);

const attachedFileSchema = new mongoose.Schema(
  {
    fileName: { type: String, default: "", trim: true },
    mimeType: { type: String, default: "", trim: true },
    fileSize: { type: Number, default: 0 },
    fileKey: { type: String, default: "", trim: true },
    fileUrl: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const labBookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [bookingItemSchema], default: [] },
    total: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    whoFor: { type: String, enum: ["self", "family", "new"], default: "self" },
    profileName: { type: String, default: "Self", trim: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    landmark: { type: String, default: "", trim: true },
    cityArea: { type: String, default: "", trim: true },
    date: { type: String, required: true, index: true },
    dateLabel: { type: String, default: "" },
    slot: { type: String, required: true },
    notes: { type: String, default: "", trim: true },
    paymentMethod: { type: String, enum: ["upi", "card", "netbanking", "cash", ""], default: "" },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    transactionId: { type: String, default: "", trim: true },
    paymentRef: { type: String, default: "", trim: true, index: true },
    holdExpiresAt: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: [
        "pending_payment",
        "sample_scheduled",
        "sample_collected",
        "processing",
        "report_ready",
        "completed",
        "cancelled",
        "failed",
      ],
      default: "pending_payment",
      index: true,
    },
    reportEta: { type: String, default: "24 hrs" },
    collectionType: { type: String, default: "Home Sample Collection" },
    processedBy: { type: String, default: "GoDavaii Verified Diagnostic Partner" },
    assignedPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "LabPartner", default: null, index: true },
    assignedPartnerName: { type: String, default: "", trim: true },
    attachedFileName: { type: String, default: null },
    attachedFile: { type: attachedFileSchema, default: () => ({}) },
    sampleCollectedAt: { type: Date, default: null },
    processingStartedAt: { type: Date, default: null },
    reportReadyAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

labBookingSchema.index({ userId: 1, createdAt: -1 });
labBookingSchema.index({ userId: 1, status: 1, createdAt: -1 });
labBookingSchema.index({ date: 1, slot: 1, status: 1 });

module.exports = mongoose.models.LabBooking || mongoose.model("LabBooking", labBookingSchema);
