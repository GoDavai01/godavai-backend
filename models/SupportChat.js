// models/SupportChat.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'bot', 'admin'], required: true },
  text: { type: String, required: true },
  time: { type: Date, default: Date.now }
}, { _id: false }); // Prevents extra _id for each message

const SupportChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  status: { type: String, enum: ['bot', 'pending_admin', 'closed'], default: 'bot' }, // escalation
  messages: [MessageSchema],
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true }); // createdAt, updatedAt auto

module.exports = mongoose.model('SupportChat', SupportChatSchema);
