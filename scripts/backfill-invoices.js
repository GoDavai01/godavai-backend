// scripts/backfill-invoices.js
const mongoose = require('mongoose');
const path = require('path');
const Order = require('../models/Order');
const Pharmacy = require('../models/Pharmacy');
const User = require('../models/User');
const generateInvoice = require('../utils/generateInvoice');

mongoose.connect('mongodb://localhost:27017/yourdbname');

(async function () {
  const orders = await Order.find({
    status: { $in: ['Delivered', 'delivered', 3] },
    $or: [{ invoiceFile: { $exists: false } }, { invoiceFile: null }, { invoiceFile: "" }]
  });

  for (const order of orders) {
    const pharmacy = await Pharmacy.findById(order.pharmacy);
    const customer = await User.findById(order.userId);

    const invoiceFile = `invoice-${order._id}.pdf`;
    const savePath = path.join(__dirname, '..', 'invoices', invoiceFile);

    generateInvoice({
      order: {
        invoiceNo: `GV-MED-${order._id}`,
        orderId: order._id,
        date: new Date(order.createdAt).toLocaleDateString(),
        deliveryDate: new Date(order.deliveredAt || order.updatedAt || new Date()).toLocaleDateString(),
        items: order.items.map(i => ({ name: i.name, qty: i.quantity, price: i.price })),
        paymentMode: order.paymentMethod || "Unknown"
      },
      pharmacy: {
        name: pharmacy.name,
        address: pharmacy.address,
        gstin: pharmacy.gstin
      },
      customer: {
        name: customer.name,
        address: customer.address
      },
      savePath
    });

    order.invoiceFile = `/invoices/${invoiceFile}`;
    await order.save();
    console.log('Invoice generated for order', order._id);
  }
  process.exit();
})();
