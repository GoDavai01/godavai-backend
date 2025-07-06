// controllers/paymentsController.js
const Payment = require("../models/Payment");
const Order = require("../models/Order");

async function createPaymentRecord(orderId, paymentDetails = {}, couponUsed = null) {
  const order = await Order.findById(orderId);
  if (!order) throw new Error("Order not found!");

  // Example commission logic
  const commission = 0.1; // 10% to admin (can fetch from DB/admin config)
  const deliveryFee = 30; // or use order.deliveryFee if variable

  const totalAmount = order.total;
  const adminAmount = totalAmount * commission;
  const deliveryAmount = deliveryFee;
  const pharmacyAmount = totalAmount - adminAmount - deliveryAmount;

  // Prevent division by zero (should not happen, but just in case)
  const pharmacyCommission = totalAmount ? 1 - commission - (deliveryFee / totalAmount) : 0;

  const payment = await Payment.create({
    orderId: order._id,
    userId: order.userId,
    pharmacyId: order.pharmacy,
    deliveryPartnerId: order.deliveryPartner,
    totalAmount,
    paymentMethod: order.paymentMethod || paymentDetails.method || "cod",
    pharmacyAmount,
    deliveryAmount,
    adminAmount,
    commissionDetails: {
      pharmacyCommission,
      adminCommission: commission,
      deliveryFlat: deliveryFee
    },
    paymentGatewayDetails: paymentDetails,
    status: (order.paymentMethod === "cod" ? "pending" : "paid"),
    coupon: couponUsed
  });

  return payment;
}

module.exports = { createPaymentRecord };
