// models/Medicine.js
const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  brand: { type: String, default: "", trim: true },

  composition: { type: String, default: "", trim: true },
  company: { type: String, default: "", trim: true },

  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0, max: 100 },
  stock: { type: Number, default: 0, min: 0 },
  img: { type: String, trim: true },
  images: { type: [String], default: [] },
  category: { type: [String], default: ["Miscellaneous"] },
  type: { type: String, default: "Tablet" },
  trending: { type: Boolean, default: false },
  pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" },
  description: { type: String, trim: true },
}, { timestamps: true });

module.exports = mongoose.model("Medicine", MedicineSchema);
