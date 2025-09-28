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

    // Mark delivered
    order.status = "delivered";
    await order.save();

    // Related docs
    const pharmacyDoc = await Pharmacy.findById(order.pharmacyId || order.pharmacy).lean();
    const customerDoc = await User.findById(order.customerId || order.userId).lean();

    // Prefer actual delivery address for invoice & POS
    const deliveryAddress =
      order.deliveryAddress ||
      order.customerAddress ||
      order.address ||
      customerDoc?.address ||
      null;

    // Company details for Platform Fee page (fill envs if you have them)
    const company = {
      legalName: process.env.COMPANY_LEGAL_NAME || "Karniva Private Limited",
      tradeName: process.env.COMPANY_TRADE_NAME || "GoDavaii",
      address: process.env.COMPANY_ADDRESS || "A-44.45 Sector 62, Noida, Uttar Pradesh",
      gstin: process.env.COMPANY_GSTIN || "",
      cin: process.env.COMPANY_CIN || "U73100UP2025PTC233175",
      pan: process.env.COMPANY_PAN || "AAMCK2072P",
      email: process.env.COMPANY_EMAIL || "support@godavaii.com",
      phone: process.env.COMPANY_PHONE || "",
      website: process.env.COMPANY_WEBSITE || "www.godavaii.com",
      termsUrl: process.env.COMPANY_TERMS_URL || "",
      signatoryName: process.env.COMPANY_SIGNATORY_NAME || "Authorized Signatory",
      signatoryTitle: process.env.COMPANY_SIGNATORY_TITLE || "Authorized Signatory",
      // Optional images (absolute path or buffer) if you want a logo/seal/signature on page 2:
      // sealImage: process.env.COMPANY_SEAL_IMAGE_PATH,
      // signatureImage: process.env.COMPANY_SIGNATURE_IMAGE_PATH,

      // Optional toggles used by generator:
      // showHSNSummary: true,
      // signPage1: true,
      // preferHSN: false, hsnForService: "999799", sac: "999799"
    };

    // Platform fee (gross, tax-inclusive)
    const platformFeeGross =
      Number(order?.fees?.platform?.gross) ||
      Number(order?.platformFee) ||
      Number(process.env.PLATFORM_FEE_GROSS || 10);

    // Build payloads for the PDF
    const invoiceBuffer = await generateInvoice({
      order: {
        invoiceNo: `GV-MED-${order._id}`,
        orderId: order._id,
        date: new Date(order.createdAt).toLocaleDateString(),
        deliveryDate: new Date().toLocaleDateString(),
        items: order.items || [],
        paymentMode: order.paymentMethod || order.payment_mode || "",
        paymentRef: order.paymentRef || order.payment_reference || "",

        // Prefer delivery address and pass customer fields used by the generator
        deliveryAddress,
        customerName: order.customerName || customerDoc?.name || "",
        customerGSTIN: order.customerGSTIN || customerDoc?.gstin || "",
        customerAddress: order.customerAddress || order.address || customerDoc?.address || null,
      },

      // Include legalEntityName + Retail Drug License so it renders under GSTIN
      pharmacy: {
        name: pharmacyDoc?.name || "",
        legalEntityName: pharmacyDoc?.legalEntityName || "",
        address: pharmacyDoc?.address || pharmacyDoc?.location?.formatted || "",
        gstin: pharmacyDoc?.gstin || "",

        // Retailer only (you said no wholesaler): generator will pick this up and show a single "Drug License No."
        drugLicenseRetail: pharmacyDoc?.drugLicenseRetail || "",
        // If you ever store alternate keys in future, generator also supports these:
        // drugLicense20B: pharmacyDoc?.drugLicense20B,
        // drugLicense: pharmacyDoc?.drugLicense,
        // drugLicence: pharmacyDoc?.drugLicence,
      },

      customer: {
        name: customerDoc?.name || order.customerName || "",
        address: deliveryAddress || customerDoc?.address || "",
        gstin: customerDoc?.gstin || "",
      },

      company,
      platformFeeGross,
    });

    // Upload PDF to S3
    const s3Key = `invoices/invoice-${order._id}.pdf`;
    const s3Res = await s3.upload({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: s3Key,
      Body: invoiceBuffer,
      ContentType: "application/pdf",
    }).promise();

    order.invoiceFile = s3Res.Location;
    await order.save();

    return res.status(200).json({
      message: "Order marked as delivered",
      invoice: order.invoiceFile
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
