const PDFDocument = require('pdfkit');

async function generateInvoice({ order, pharmacy, customer }) {
  const doc = new PDFDocument({ margin: 50 });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));

  // --- TEST LINE, REMOVE LATER ---
  doc.fontSize(28).fillColor('red').text('TEST PDF - GODAVAII', 50, 50);

  // --- YOUR EXISTING PDF CODE BELOW ---
  doc
    .fontSize(20)
    .fillColor('black')
    .text('GODAVAII', { align: 'center' })
    .fontSize(14)
    .text('Invoice for Medicine Purchase', { align: 'center' })
    .moveDown();

  doc
    .fontSize(11)
    .text(`Invoice No: ${order.invoiceNo || ''}`)
    .text(`Order ID: ${order.orderId || ''}`)
    .text(`Order Date: ${order.date || ''}`)
    .text(`Delivery Date: ${order.deliveryDate || ''}`)
    .moveDown();

  doc
    .text(`Pharmacy: ${pharmacy?.name || ''}`)
    .text(`Address: ${pharmacy?.address || ''}`)
    .text(`GSTIN: ${pharmacy?.gstin || ''}`)
    .moveDown();

  doc
    .text(`Customer: ${customer?.name || ''}`)
    .text(`Address: ${customer?.address || ''}`)
    .moveDown();

  doc.text('--------------------------------------------------------------');
  doc.text('| S.No | Medicine Name       | Qty | Price |   Total   |');
  doc.text('--------------------------------------------------------------');

  let subtotal = 0;
  (order.items || []).forEach((item, i) => {
    const total = (item.quantity || 0) * (item.price || 0);
    subtotal += total;
    doc.text(
      `|  ${i + 1}   | ${String(item.name || '').padEnd(20)} |  ${item.quantity || 0}  | ₹${item.price || 0}  | ₹${total.toFixed(2)} |`
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

  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
    doc.on('error', reject);
  });
}

module.exports = generateInvoice;
