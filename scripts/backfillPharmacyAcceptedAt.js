// scripts/backfillPharmacyAcceptedAt.js

const mongoose = require("mongoose");
require("dotenv").config();
const Order = require("../models/Order");

// 1. Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .catch(err => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

async function safeBackfillPharmacyAcceptedAt() {
  try {
    const orders = await Order.find({
      status: { $in: ["processing", "assigned", "accepted", "out_for_delivery", "picked_up", "delivered"] },
      pharmacyAcceptedAt: { $exists: false },
      paymentStatus: { $in: ["PAID", "COD", "PARTIAL_PAID"] }
    });
    if (!orders.length) {
      console.log("No orders to patch.");
      await mongoose.disconnect();
      process.exit(0);
    }

    for (const order of orders) {
      // Use confirmedAt if exists, else createdAt as fallback
      const ts = order.confirmedAt || order.createdAt || new Date();
      order.pharmacyAcceptedAt = ts;
      order.assignmentHistory = order.assignmentHistory || [];
      if (!order.assignmentHistory.find(h => h.status === "pharmacy_accepted"))
        order.assignmentHistory.push({ status: "pharmacy_accepted", at: ts });
      await order.save();
      console.log(`✅ Patched order ${order._id}`);
    }
    console.log(`\nSafe backfill done! ${orders.length} orders updated.\n`);
    await mongoose.disconnect();
    process.exit(0); // Exit after disconnect
  } catch (err) {
    console.error("❌ Error during backfill:", err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Only run if called directly
if (require.main === module) {
  safeBackfillPharmacyAcceptedAt();
}
