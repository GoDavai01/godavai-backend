const PDFDocument = require('pdfkit');

async function generateInvoice({ order, pharmacy, customer }) {
  const doc = new PDFDocument({ margin: 40 });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));

  // Header
  doc.fontSize(24).fillColor('#13C0A2').text('GODAVAII', { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(13).fillColor('black').text('Invoice for Medicine Purchase', { align: 'center' });
  doc.moveDown(1.5);

  // Invoice & Pharmacy Info (two columns)
  doc.fontSize(10).fillColor('black');
  doc.text(`Invoice No: ${order.invoiceNo || ''}`, 40, 110);
  doc.text(`Order ID: ${order.orderId || ''}`);
  doc.text(`Order Date: ${order.date || ''}`);
  doc.text(`Delivery Date: ${order.deliveryDate || ''}`);

  let y = doc.y + 7;
  doc.text(`Pharmacy: ${pharmacy?.name || ''}`, 340, 110);
  doc.text(`Address: ${pharmacy?.address || ''}`, 340);
  doc.text(`GSTIN: ${pharmacy?.gstin || ''}`, 340);

  doc.moveDown(1.2);
  doc.text(`Customer: ${customer?.name || ''}`);
  // Format address prettily if it's an object
  doc.text(
    `Address: ${typeof customer?.address === 'string' ? customer.address :
      [customer?.address?.line1, customer?.address?.line2, customer?.address?.city, customer?.address?.state, customer?.address?.pincode]
      .filter(Boolean).join(', ')
    }`
  );
  doc.moveDown(0.5);

  // Table Header
  doc.moveDown(0.7);
  let tableTop = doc.y + 7;
  doc.font('Helvetica-Bold');
  doc.rect(40, tableTop, 520, 20).fill('#F0F0F0').stroke();
  doc.fillColor('#13C0A2').text('S.No', 50, tableTop + 4, { width: 30, align: 'left' });
  doc.text('Medicine Name', 90, tableTop + 4, { width: 170, align: 'left' });
  doc.text('Qty', 270, tableTop + 4, { width: 35, align: 'center' });
  doc.text('Price', 320, tableTop + 4, { width: 60, align: 'center' });
  doc.text('Total', 400, tableTop + 4, { width: 70, align: 'center' });
  doc.font('Helvetica').fillColor('black');

  // Table Rows
  let subtotal = 0;
  (order.items || []).forEach((item, i) => {
    const y = tableTop + 24 + i * 20;
    const total = (item.quantity || 0) * (item.price || 0);
    subtotal += total;
    doc.text(i + 1, 50, y, { width: 30 });
    doc.text(item.name || '', 90, y, { width: 170 });
    doc.text(item.quantity || '', 270, y, { width: 35, align: 'center' });
    doc.text('₹' + (item.price || 0), 320, y, { width: 60, align: 'center' });
    doc.text('₹' + total.toFixed(2), 400, y, { width: 70, align: 'center' });
  });

  let yBottom = tableTop + 24 + (order.items?.length || 1) * 20 + 12;
  doc.moveTo(40, yBottom).lineTo(560, yBottom).stroke();

  // Summary
  const gst = +(subtotal * 0.05).toFixed(2);
  const grandTotal = +(subtotal + gst).toFixed(2);
  doc.font('Helvetica-Bold');
  doc.text('Subtotal:', 330, yBottom + 8, { width: 100, align: 'right' });
  doc.text('₹' + subtotal.toFixed(2), 440, yBottom + 8, { width: 70, align: 'right' });
  doc.font('Helvetica');
  doc.text('GST (5%):', 330, yBottom + 26, { width: 100, align: 'right' });
  doc.text('₹' + gst.toFixed(2), 440, yBottom + 26, { width: 70, align: 'right' });
  doc.moveTo(330, yBottom + 44).lineTo(560, yBottom + 44).stroke();
  doc.font('Helvetica-Bold').fontSize(13);
  doc.text('Total Amount:', 330, yBottom + 48, { width: 100, align: 'right' });
  doc.text('₹' + grandTotal.toFixed(2), 440, yBottom + 48, { width: 70, align: 'right' });

  // Payment mode
  doc.font('Helvetica').fontSize(10);
  doc.text(`Payment Mode: ${order.paymentMode || ''}`, 40, yBottom + 80);

  // Footer
  doc.fontSize(8)
    .text('Note: This invoice is issued by the pharmacy.', 40, yBottom + 100)
    .text('Godavaii acts only as a facilitator for orders and delivery.', 40, yBottom + 112);
  doc.fontSize(10)
    .fillColor('#13C0A2')
    .text('Thank you for choosing GODAVAII', 40, yBottom + 130, { align: 'center' })
    .fontSize(9)
    .fillColor('black')
    .text('www.godavaii.in | +91-XXXXXXXXXX', { align: 'center' });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });
}

module.exports = generateInvoice;
