const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateInvoice({ order, pharmacy, customer, savePath }) {
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
    .text(`Invoice No: ${order.invoiceNo}`)
    .text(`Order ID: ${order.orderId}`)
    .text(`Order Date: ${order.date}`)
    .text(`Delivery Date: ${order.deliveryDate}`)
    .moveDown();

  // Pharmacy
  doc
    .text(`Pharmacy: ${pharmacy.name}`)
    .text(`Address: ${pharmacy.address}`)
    .text(`GSTIN: ${pharmacy.gstin}`)
    .moveDown();

  // Customer
  doc
    .text(`Customer: ${customer.name}`)
    .text(`Address: ${customer.address}`)
    .moveDown();

  // Items
  doc.text('--------------------------------------------------------------');
  doc.text('| S.No | Medicine Name       | Qty | Price |   Total   |');
  doc.text('--------------------------------------------------------------');

  let subtotal = 0;
  order.items.forEach((item, i) => {
    const total = item.qty * item.price;
    subtotal += total;
    doc.text(
      `|  ${i + 1}   | ${item.name.padEnd(20)} |  ${item.qty}  | ₹${item.price}  | ₹${total.toFixed(2)} |`
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

  doc.text(`Payment Mode: ${order.paymentMode}`);
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
}

module.exports = generateInvoice;
