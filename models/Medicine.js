const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  brand: { type: String, default: "", trim: true },
  price: { type: Number, required: true, min: 0 },    // No negative prices!
  mrp: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0, max: 100 }, // Percentage or fixed? Set max if percentage
  stock: { type: Number, default: 0, min: 0 },
  img: { type: String, trim: true },  // Image URL
  category: { type: String, default: "Miscellaneous", trim: true },
  trending: { type: Boolean, default: false },
  pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" },
  description: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true }); // Adds updatedAt, keeps createdAt

module.exports = mongoose.model("Medicine", MedicineSchema);
