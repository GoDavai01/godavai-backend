const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    brand: { type: String, default: "", trim: true },

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

// If you prefer a single text index instead, comment the four above and use:
// MedicineSchema.index({
//   name: "text",
//   brand: "text",
//   company: "text",
//   composition: "text",
// });

module.exports = mongoose.model("Medicine", MedicineSchema);
