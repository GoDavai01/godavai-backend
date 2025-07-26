const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// You can pass UPLOADS_DIR from your main app, or set a default here for standalone use:
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const invoicesDir = path.join(UPLOADS_DIR, 'invoices');

// Ensure the invoices directory exists
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
}

function generateInvoice({ order, pharmacy, customer, savePath }) {
  // If savePath is not given, auto-generate one
  if (!savePath) {
    const fileName = `invoice_${order.invoiceNo || order.orderId || Date.now()}.pdf`;
    savePath = path.join(invoicesDir, fileName);
  }

  // Log where invoice will be saved
  console.log("Generating invoice at:", savePath);

  const doc = new PDFDocument({ margin: 50 });

  doc.pipe(fs.createWriteStream(savePath));

  // Header
  doc
    .fontSize(20)
    .text('GODAVAII', { align: 'center' })
    .fontSize(14)
    .text('Invoice for Medicine Purchase', { align: 'center' })
    .moveDown();

  // Order details
  doc
    .fontSize(11)
    .text(`Invoice No: ${order.invoiceNo || ''}`)
    .text(`Order ID: ${order.orderId || ''}`)
    .text(`Order Date: ${order.date || ''}`)
    .text(`Delivery Date: ${order.deliveryDate || ''}`)
    .moveDown();

  // Pharmacy details
  doc
    .text(`Pharmacy: ${pharmacy.name || ''}`)
    .text(`Address: ${pharmacy.address || ''}`)
    .text(`GSTIN: ${pharmacy.gstin || ''}`)
    .moveDown();

  // Customer details
  doc
    .text(`Customer: ${customer.name || ''}`)
    .text(`Address: ${customer.address || ''}`)
    .moveDown();

  // Items Table Header
  doc.text('--------------------------------------------------------------');
  doc.text('| S.No | Medicine Name       | Qty | Price |   Total   |');
  doc.text('--------------------------------------------------------------');

  let subtotal = 0;
  (order.items || []).forEach((item, i) => {
    const total = (item.qty || 0) * (item.price || 0);
    subtotal += total;
    doc.text(
      `|  ${i + 1}   | ${String(item.name || '').padEnd(20)} |  ${item.qty || 0}  | ₹${item.price || 0}  | ₹${total.toFixed(2)} |`
    );
  });

  const gst = +(subtotal * 0.05).toFixed(2);
  const grandTotal = +(subtotal + gst).toFixed(2);

  doc.text('--------------------------------------------------------------');
  doc.text(`Subtotal: ₹${subtotal.toFixed(2)}`);
  doc.text(`GST (5%): ₹${gst.toFixed(2)}`);
  doc.text('--------------------------------------------------------------');
  doc.text(`Total Amount: ₹${grandTotal.toFixed(2)}`);
  doc.text('--------------------------------------------------------------');

  doc.text(`Payment Mode: ${order.paymentMode || ''}`);
  doc.moveDown();

  doc
    .fontSize(9)
    .text('Note: This invoice is issued by the pharmacy.')
    .text('Godavaii acts only as a facilitator for orders and delivery.');

  doc
    .moveDown()
    .fontSize(10)
    .text('Thank you for choosing GODAVAII', { align: 'center' })
    .text('www.godavaii.in | +91-XXXXXXXXXX', { align: 'center' });

  doc.end();

  // Optional: Return the path for further use
  return savePath;
}

module.exports = generateInvoice;
