const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  brand: { type: String, default: "", trim: true },

  // NEW
  composition: { type: String, default: "", trim: true }, // e.g., "Paracetamol 650 mg"
  company: { type: String, default: "", trim: true },     // e.g., "Micro Labs"

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
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("Medicine", MedicineSchema);
