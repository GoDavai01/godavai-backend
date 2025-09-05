// models/PrescriptionOrder.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------------- Sub-schemas (existing) ------------------------- */

// Medicine item sub-schema
const MedicineItemSchema = new Schema(
  {
    medicineName: String,
    brand: String,
    quantity: Number,
    price: Number,
    available: { type: Boolean, default: true },
  },
  { _id: false }
);

const QuoteSchema = new Schema(
  {
    pharmacy: { type: Schema.Types.ObjectId, ref: "Pharmacy" },
    items: [MedicineItemSchema],
    price: Number,
    message: String,
    unavailableItems: [String],
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const TimelineSchema = new Schema(
  {
    status: String,
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* ----------------------------- NEW: AI schema ---------------------------- */

const AIItemSchema = new Schema(
  {
    // e.g., “Dolo 650”, “Amoxicillin”
    name: String,
    // optional normalized API read, e.g., “Paracetamol 650 mg”
    composition: String,
    // e.g., “650 mg”
    strength: String,
    // e.g., “tablet”, “syrup”, “cap”
    form: String,
    // how many units doctor appears to have prescribed
    quantity: Number,
    // 0..1 confidence score from the parser
    confidence: Number,
  },
  { _id: false }
);

/* --------------------------- Main Prescription --------------------------- */

const PrescriptionOrderSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // assignment / routing
    pharmacy: { type: Schema.Types.ObjectId, ref: "Pharmacy" }, // winning pharmacy (if any)
    pharmacyCandidates: [{ type: Schema.Types.ObjectId, ref: "Pharmacy" }], // can quote

    // ---- Added earlier for new assignment logic (kept) ----
    pharmaciesTried: [{ type: Schema.Types.ObjectId, ref: "Pharmacy" }],

    // core order info
    prescriptionUrl: { type: String, required: true },    // primary (first) file – kept for legacy flows
    attachments: { type: [String], default: [] },          // NEW: all file URLs (images/PDFs)
    city: { type: String },
    area: { type: String },
    notes: { type: String },

    // Universal address snapshot for delivery
    address: { type: Schema.Types.Mixed, default: null },

    uploadType: { type: String, enum: ["auto", "manual"] }, // "auto" (system assigns), "manual" (user selects)

    status: {
      type: String,
      enum: [
        "waiting_for_quotes",
        "pending_user_confirm",
        "confirmed",
        "cancelled",
        "processing",
        "dispatched",
        "delivered",
        "split",
        "converted_to_order", // supported
      ],
      default: "waiting_for_quotes",
    },

    // quoting lifecycle
    quotes: [QuoteSchema],
    quoteExpiry: { type: Date },

    // (legacy/simple) quote snapshot
    quote: {
      items: [MedicineItemSchema],
      price: Number,
      message: String,
    },
    quoteTotal: Number,

    // availability & user response
    unavailableItems: [String],
    userResponse: { type: String, enum: ["accepted", "rejected", null], default: null },

    // splitting / lineage
    parentOrder: { type: Schema.Types.ObjectId, ref: "PrescriptionOrder" }, // for split orders
    timeline: [TimelineSchema],

    // temp working quote (kept as-is)
    tempQuote: {
      items: [MedicineItemSchema],
      approxPrice: Number,
      brands: [String],
      message: String,
    },

    // items already fulfilled in a parent/previous split
    alreadyFulfilledItems: [MedicineItemSchema],

    // payments / conversion
    paymentStatus: { type: String, default: "PENDING" },
    paymentDetails: { type: Schema.Types.Mixed, default: {} },
    confirmedAt: { type: Date },
    convertedOrderId: { type: Schema.Types.ObjectId, ref: "Order" },

    /* ------------------------- NEW: AI assist block ------------------------- */
    ai: {
      parser: String,        // which OCR/LLM parser was used (e.g., "tesseract+llm:v1")
      parsedAt: Date,        // when OCR/parse happened
      rawText: String,       // raw text extracted from the image/PDF
      items: [AIItemSchema], // structured AI suggestions
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PrescriptionOrder", PrescriptionOrderSchema);
