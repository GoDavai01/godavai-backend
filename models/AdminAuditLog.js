const mongoose = require("mongoose");

const adminAuditLogSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null, index: true },
    entityType: { type: String, required: true, trim: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, required: true, trim: true, index: true },
    notes: { type: String, default: "", trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.AdminAuditLog || mongoose.model("AdminAuditLog", adminAuditLogSchema);
