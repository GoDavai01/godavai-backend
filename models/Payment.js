const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
  deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryPartner' },
  totalAmount: { type: Number, required: true },
  paymentMethod: { type: String, required: true, trim: true }, // Added trim
  pharmacyAmount: { type: Number, required: true },
  deliveryAmount: { type: Number, required: true },
  adminAmount: { type: Number, required: true },
  commissionDetails: { type: Object, default: {} }, // Added default
  paymentGatewayDetails: { type: Object, default: {} }, // Added default
  status: { type: String, enum: ['pending', 'paid', 'settled', 'refunded'], default: 'pending', trim: true },
  coupon: { type: Object, default: {} }, // Added default
}, { timestamps: true }); // createdAt + updatedAt

module.exports = mongoose.model('Payment', PaymentSchema);
