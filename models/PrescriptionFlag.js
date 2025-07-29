const mongoose = require('mongoose');
const FlagSchema = new mongoose.Schema({
  prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "PrescriptionOrder" },
  aiMedicines: [],
  flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reason: String,
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('PrescriptionFlag', FlagSchema);
