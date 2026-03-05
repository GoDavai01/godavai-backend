const mongoose = require("mongoose");

const aiMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    text: { type: String, default: "" },
    ts: { type: Date, default: Date.now },
  },
  { _id: false }
);

const aiAttachmentSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    url: { type: String, default: "" },
    type: { type: String, default: "" },
    extractedText: { type: String, default: "" },
  },
  { _id: false }
);

const aiSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    whoFor: { type: String, enum: ["self", "family", "new"], default: "self" },
    whoForLabel: { type: String, default: "" },
    language: { type: String, enum: ["hinglish", "hi", "en"], default: "hinglish" },
    focus: { type: String, enum: ["auto", "symptom", "medicine", "rx", "lab"], default: "auto" },
    messages: { type: [aiMessageSchema], default: [] },
    attachments: { type: [aiAttachmentSchema], default: [] },
  },
  { timestamps: true }
);

aiSessionSchema.index({ userId: 1, updatedAt: -1 });
aiSessionSchema.index({ userId: 1, whoFor: 1, whoForLabel: 1, updatedAt: -1 });

module.exports = mongoose.models.AiSession || mongoose.model("AiSession", aiSessionSchema);

