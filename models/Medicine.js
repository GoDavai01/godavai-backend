// models/Medicine.js
const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    brand: { type: String, default: "", trim: true },

    productKind: { type: String, enum: ["branded", "generic"], default: "branded", index: true },

    composition: { type: String, default: "", trim: true },

    // NEW: normalized composition key for exact, order-independent lookups
    compositionKey: { type: String, default: "", index: true },  // <-- ADD THIS

    company: { type: String, default: "", trim: true },

    price: { type: Number, min: 0, required: function () { return this.status !== "draft"; } },
    mrp:   { type: Number, min: 0, required: function () { return this.status !== "draft"; } },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    stock: { type: Number, default: 0, min: 0 },

    img: { type: String, trim: true },
    images: { type: [String], default: [] },

    category: { type: [String], default: ["Miscellaneous"] },
    type: { type: String, default: "Tablet" },

    hsn: { type: String, trim: true, default: "" },
    gstRate: { type: Number, enum: [0, 5, 12, 18], default: 5 }, // keep if you want

    packCount: { type: Number, min: 0, default: 0 },
    packUnit: {
      type: String,
      trim: true,
      default: "",
      enum: ["", "tablets", "capsules", "ml", "g", "units", "sachets", "drops"]
    },

    prescriptionRequired: { type: Boolean, default: false },
    trending: { type: Boolean, default: false },

    pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" },

    description: { type: String, trim: true },

    // 🔴 Fix: allow “unavailable” + add available flag
    available: { type: Boolean, default: true }, // <-- ADD THIS
    status: { type: String, enum: ["draft", "active", "unavailable"], default: "active" }, // <-- FIX
  },
  { timestamps: true }
);

/* Indexes */
MedicineSchema.index({ name: 1 });
MedicineSchema.index({ brand: 1 });
MedicineSchema.index({ company: 1 });
MedicineSchema.index({ composition: 1 });
// already added: compositionKey above

// compound for alternatives
MedicineSchema.index(
  { pharmacy: 1, compositionKey: 1, productKind: 1, stock: 1 },  // <-- swap composition -> compositionKey
  { name: "pharmacy_compKey_kind_stock" }
);

module.exports = mongoose.model("Medicine", MedicineSchema);
