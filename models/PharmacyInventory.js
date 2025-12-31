// models/PharmacyInventory.js (FULLY REPLACEABLE - CommonJS)
const mongoose = require("mongoose");

const PharmacyInventorySchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      required: true,
    },

    medicineMasterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MedicineMaster",
      required: true,
    },

    // pharmacy overrides (sirf is pharmacy ke liye)
    sellingPrice: { type: Number, default: 0 },
    mrp: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    stockQty: { type: Number, default: 0 },

    // optional: pharmacy can override images too
    images: [{ type: String }],

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// prevent duplicates per pharmacy per master medicine
PharmacyInventorySchema.index({ pharmacyId: 1, medicineMasterId: 1 }, { unique: true });

// ✅ Prevent OverwriteModelError in dev/hot reload:
module.exports =
  mongoose.models.PharmacyInventory || mongoose.model("PharmacyInventory", PharmacyInventorySchema);
