// controllers/orderController.js

const path = require('path');
const fs = require('fs');
const generateInvoice = require('../utils/generateInvoice'); // ✅ your invoice util
const Order = require('../models/Order');
const Pharmacy = require('../models/Pharmacy');
const User = require('../models/User');

exports.markOrderDelivered = async (req, res) => {
  try {
    const orderId = req.params.id;

    // 1. Fetch order, pharmacy, customer
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.status = 'Delivered';
    await order.save();

    const pharmacy = await Pharmacy.findById(order.pharmacyId);
    const customer = await User.findById(order.customerId);

    // 2. Ensure uploads/invoices directory exists
    const invoicesDir = path.join(__dirname, '..', 'uploads', 'invoices');
    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir, { recursive: true });
    }

    // 3. Generate invoice file path
    const invoiceFile = `invoice-${order._id}.pdf`;
    const savePath = path.join(invoicesDir, invoiceFile);

    // 4. Generate the invoice PDF
    generateInvoice({
      order: {
        invoiceNo: `GV-MED-${order._id}`,
        orderId: order._id,
        date: new Date(order.createdAt).toLocaleDateString(),
        deliveryDate: new Date().toLocaleDateString(),
        items: order.items, // Should contain [{ name, qty, price }]
        paymentMode: order.paymentMethod
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

    // 5. Save public invoice path to DB (so frontend can access via /invoices/...)
    order.invoiceFile = `/invoices/${invoiceFile}`;
    await order.save();

    res.status(200).json({ message: 'Order marked as delivered', invoice: order.invoiceFile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
