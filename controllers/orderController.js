// controllers/orderController.js
const path = require('path');
const fs = require('fs');

const Order = require('../models/Order');
const Pharmacy = require('../models/Pharmacy');
const User = require('../models/User');

// Helper to require a file if it exists (tries uploads/ then utils/)
function reqMaybe(...segments) {
  const p = path.resolve(__dirname, ...segments);
  if (fs.existsSync(p) || fs.existsSync(p + '.js')) return require(p);
  return null;
}

const s3 =
  reqMaybe('..', 'uploads', 's3-setup') ||
  reqMaybe('..', 'utils', 's3-setup');

const generateInvoice =
  reqMaybe('..', 'uploads', 'generateInvoice') ||
  reqMaybe('..', 'utils', 'generateInvoice');

if (!s3) throw new Error('Cannot find s3-setup.js in uploads/ or utils/');
if (!generateInvoice) throw new Error('Cannot find generateInvoice.js in uploads/ or utils/');

exports.markOrderDelivered = async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    order.status = "delivered";
    await order.save();

    const pharmacy = await Pharmacy.findById(order.pharmacyId || order.pharmacy);
    const customer = await User.findById(order.customerId || order.userId);

    // Company details for Platform Fee page
    const company = {
      name: process.env.COMPANY_NAME || "Karniva Private Limited (GoDavaii)",
      address: process.env.COMPANY_ADDRESS || "Sector 62, Noida, Uttar Pradesh",
      gstin: process.env.COMPANY_GSTIN || "",
    };

    // Platform fee shown is gross (tax-inclusive)
    const platformFeeGross =
      Number(order?.fees?.platform?.gross) ||
      Number(order?.platformFee) ||
      Number(process.env.PLATFORM_FEE_GROSS || 10);

    const invoiceBuffer = await generateInvoice({
      order: {
        invoiceNo: `GV-MED-${order._id}`,
        orderId: order._id,
        date: new Date(order.createdAt).toLocaleDateString(),
        deliveryDate: new Date().toLocaleDateString(),
        items: order.items,
        paymentMode: order.paymentMethod,
      },
      pharmacy: {
        name: pharmacy?.name,
        address: pharmacy?.address,
        gstin: pharmacy?.gstin,
      },
      customer: {
        name: customer?.name,
        address: order.address,
      },
      company,
      platformFeeGross,
    });

    // Upload to S3
    const s3Key = `invoices/invoice-${order._id}.pdf`;
    const s3Res = await s3.upload({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: s3Key,
      Body: invoiceBuffer,
      ContentType: "application/pdf",
    }).promise();

    order.invoiceFile = s3Res.Location;
    await order.save();

    res.status(200).json({ message: "Order marked as delivered", invoice: order.invoiceFile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
