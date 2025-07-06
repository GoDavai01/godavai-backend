// patchPayments.js

const mongoose = require('mongoose');
const Payment = require('./models/Payment');
const Order = require('./models/Order');

async function patchDeliveryPartnerIds() {
  try {
    await mongoose.connect(
      process.env.MONGO_URI ||
      "mongodb+srv://pg19pururvaagarwal:Pururva%4017@akarv.ohy8ebq.mongodb.net/medicineApp?retryWrites=true&w=majority&appName=Akarv",
      { useNewUrlParser: true, useUnifiedTopology: true }
    );

    const orders = await Order.find({ deliveryPartner: { $ne: null } });
    let updated = 0;
    for (const order of orders) {
      const res = await Payment.updateOne(
        { orderId: order._id },
        { $set: { deliveryPartnerId: order.deliveryPartner } }
      );
      if (res.modifiedCount > 0) updated++;
    }
    console.log(`✅ Patched payment records: ${updated} updated`);
  } catch (err) {
    console.error("❌ Patch failed:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

patchDeliveryPartnerIds();
