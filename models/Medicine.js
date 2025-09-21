const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    brand: { type: String, default: "", trim: true },

    // NEW: branded vs generic
    productKind: { type: String, enum: ["branded", "generic"], default: "branded", index: true },

    composition: { type: String, default: "", trim: true },
    company: { type: String, default: "", trim: true },

    // required unless status === 'draft'
    price: {
      type: Number,
      min: 0,
      required: function () { return this.status !== "draft"; }
    },
    mrp: {
      type: Number,
      min: 0,
      required: function () { return this.status !== "draft"; }
    },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    stock: { type: Number, default: 0, min: 0 },

    img: { type: String, trim: true },
    images: { type: [String], default: [] },

    category: { type: [String], default: ["Miscellaneous"] },
    type: { type: String, default: "Tablet" },

    // NEW: taxation (kept server-side; do NOT show to customers)
    hsn: { type: String, trim: true, default: "" },              // e.g., "3004"
    gstRate: { type: Number, enum: [0, 5, 12, 18], default: 5 }, // keep default 0 to be safe

    // NEW: pack size
    packCount: { type: Number, min: 0, default: 0 },             // e.g., 10
    packUnit: {                                                  // e.g., "tablets", "ml", "capsules"
      type: String,
      trim: true,
      default: "",
      enum: ["", "tablets", "capsules", "ml", "g", "units", "sachets", "drops"]
    },

    prescriptionRequired: { type: Boolean, default: false },

    trending: { type: Boolean, default: false },

    pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" },

    description: { type: String, trim: true },

    status: { type: String, enum: ["draft", "active"], default: "active" },
  },
  { timestamps: true }
);

/* ---------- Indexes for faster search ---------- */
MedicineSchema.index({ name: 1 });
MedicineSchema.index({ brand: 1 });
MedicineSchema.index({ company: 1 });
MedicineSchema.index({ composition: 1 });

// Compound index: speeds up alternatives lookups inside a pharmacy
MedicineSchema.index(
  { pharmacy: 1, composition: 1, productKind: 1, stock: 1 },
  { name: "pharmacy_comp_kind_stock" }
);

module.exports = mongoose.model("Medicine", MedicineSchema);
