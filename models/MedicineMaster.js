import mongoose from "mongoose";

const MedicineMasterSchema = new mongoose.Schema(
  {
    // same fields like pharmacy medicine form
    name: { type: String, required: true, trim: true },

    brand: { type: String, trim: true },          // branded only
    composition: { type: String, trim: true },    // salts / composition
    company: { type: String, trim: true },

    price: { type: Number, default: 0 },          // base/default selling price
    mrp: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },

    category: { type: [String], default: [] },
    type: { type: String, default: "Tablet" },
    customType: { type: String, default: "" },

    prescriptionRequired: { type: Boolean, default: false },

    productKind: { type: String, enum: ["branded", "generic"], default: "branded" },

    hsn: { type: String, default: "3004" },
    gstRate: { type: Number, default: 5 },

    packCount: { type: Number, default: 0 },
    packUnit: { type: String, default: "" },

    images: [{ type: String }],

    description: { type: String, default: "" },

    status: {
      type: String,
      enum: ["approved", "pending", "rejected"],
      default: "approved",
    },

    createdByType: {
      type: String,
      enum: ["admin", "pharmacy"],
      default: "admin",
    },

    createdByPharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      default: null,
    },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("MedicineMaster", MedicineMasterSchema);
