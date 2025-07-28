// controllers/orderController.js

const AWS = require('aws-sdk');
// controllers/orderController.js
const s3 = require('../utils/s3-setup');
const generateInvoice = require('../utils/generateInvoice');
const Order = require('../models/Order');
const Pharmacy = require('../models/Pharmacy');
const User = require('../models/User');

exports.markOrderDelivered = async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.status = 'delivered';
    await order.save();

    const pharmacy = await Pharmacy.findById(order.pharmacyId || order.pharmacy);
    const customer = await User.findById(order.customerId || order.userId);

    const invoiceBuffer = await generateInvoice({
      order: {
        invoiceNo: `GV-MED-${order._id}`,
        orderId: order._id,
        date: new Date(order.createdAt).toLocaleDateString(),
        deliveryDate: new Date().toLocaleDateString(),
        items: order.items,
        paymentMode: order.paymentMethod
      },
      pharmacy: {
        name: pharmacy?.name,
        address: pharmacy?.address,
        gstin: pharmacy?.gstin
      },
      customer: {
        name: customer?.name,
        address: order.address
      }
    });

    // --- S3 Upload ---
    const s3Key = `invoices/invoice-${order._id}.pdf`;
    const s3Res = await s3.upload({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: s3Key,
      Body: invoiceBuffer,
      ContentType: 'application/pdf',
       // acl: 'public-read',  // <-- Gone!
    }).promise();

    order.invoiceFile = s3Res.Location;
    await order.save();

    res.status(200).json({ message: 'Order marked as delivered', invoice: order.invoiceFile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
