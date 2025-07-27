const PDFDocument = require('pdfkit');

function getPrintableAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  const ignore = ["lat", "lng", "coordinates"];
  return Object.entries(addr)
    .filter(([k, v]) => v && !ignore.includes(k) && typeof v !== "object")
    .map(([k, v]) => v)
    .join(", ");
}

async function generateInvoice({ order, pharmacy, customer }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));

  // Colors
  const primary = "#13C0A2";
  const lightGrey = "#F4F4F4";
  const tableHeaderBG = "#eafaf3";

  // Header
  doc
    .fontSize(22)
    .fillColor(primary)
    .font('Helvetica-Bold')
    .text('GODAVAII', { align: 'left' });
  doc.moveDown(0.2)
    .fontSize(12)
    .fillColor('black')
    .font('Helvetica')
    .text('Invoice for Medicine Purchase', { align: 'left' });

  // Draw a top line
  doc.moveDown(0.5)
    .moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(lightGrey).lineWidth(1).stroke();
  
  // Invoice/Order/Date/Pharmacy
  doc.moveDown(0.7)
    .fontSize(10)
    .fillColor('black')
    .font('Helvetica');

  // Left column: Invoice
  const startY = doc.y;
  doc.text(`Invoice No:`, 40, startY, { continued: true, font: "Helvetica-Bold" }).font('Helvetica').text(` ${order.invoiceNo || ''}`);
  doc.text(`Order ID:`, 40, doc.y, { continued: true, font: "Helvetica-Bold" }).font('Helvetica').text(` ${order.orderId || ''}`);
  doc.text(`Order Date:`, 40, doc.y, { continued: true, font: "Helvetica-Bold" }).font('Helvetica').text(` ${order.date || ''}`);
  doc.text(`Delivery Date:`, 40, doc.y, { continued: true, font: "Helvetica-Bold" }).font('Helvetica').text(` ${order.deliveryDate || ''}`);

  // Right column: Pharmacy
  const rightColX = 320;
  doc.font('Helvetica-Bold').text(`Pharmacy:`, rightColX, startY);
  doc.font('Helvetica').text(`${pharmacy?.name || ''}`, rightColX + 70, startY);
  doc.font('Helvetica-Bold').text(`Address:`, rightColX, doc.y);
  doc.font('Helvetica').text(`${pharmacy?.address || ''}`, rightColX + 70, doc.y);
  doc.font('Helvetica-Bold').text(`GSTIN:`, rightColX, doc.y);
  doc.font('Helvetica').text(`${pharmacy?.gstin || ''}`, rightColX + 70, doc.y);

  // Customer
  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').text(`Customer:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${customer?.name || ''}`);
  doc.font('Helvetica-Bold').text(`Address:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${getPrintableAddress(customer?.address)}`);

  // Draw section line before table
  doc.moveDown(0.6)
    .moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  // Items Table
  let tableY = doc.y + 8;
  const colXs = [50, 90, 260, 320, 400];
  // Table Header BG
  doc.rect(40, tableY, 515, 22).fill(tableHeaderBG).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(primary)
    .text('S.No', colXs[0], tableY + 6, { width: 35 })
    .text('Medicine Name', colXs[1], tableY + 6, { width: 170 })
    .text('Qty', colXs[2], tableY + 6, { width: 40, align: 'center' })
    .text('Price', colXs[3], tableY + 6, { width: 60, align: 'center' })
    .text('Total', colXs[4], tableY + 6, { width: 60, align: 'center' });

  // Table Rows
  let subtotal = 0;
  let rowY = tableY + 22;
  doc.font('Helvetica').fontSize(10).fillColor('black');
  (order.items || []).forEach((item, i) => {
    const total = (item.quantity || 0) * (item.price || 0);
    subtotal += total;
    doc.text(i + 1, colXs[0], rowY + 6, { width: 35 });
    doc.text(item.name || '', colXs[1], rowY + 6, { width: 170 });
    doc.text(item.quantity || '', colXs[2], rowY + 6, { width: 40, align: 'center' });
    doc.text('₹' + (item.price || 0), colXs[3], rowY + 6, { width: 60, align: 'center' });
    doc.text('₹' + total.toFixed(2), colXs[4], rowY + 6, { width: 60, align: 'center' });
    rowY += 22;
    // Optionally: draw horizontal line after each row
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor(lightGrey).lineWidth(0.5).stroke();
  });

  // Summary on the right
  const summaryX = 350, labelW = 110, valueW = 60;
  const gst = +(subtotal * 0.05).toFixed(2);
  const grandTotal = +(subtotal + gst).toFixed(2);

  doc.font('Helvetica-Bold').fontSize(11);
  let sumY = rowY + 16;
  doc.text('Subtotal:', summaryX, sumY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text('₹' + subtotal.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });
  sumY += 17;
  doc.font('Helvetica-Bold').text('GST (5%):', summaryX, sumY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text('₹' + gst.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });
  sumY += 10;
  doc.moveTo(summaryX, sumY + 15).lineTo(summaryX + labelW + valueW + 20, sumY + 15).strokeColor(primary).lineWidth(1).stroke();
  sumY += 22;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(primary)
    .text('Total Amount:', summaryX, sumY, { width: labelW, align: 'right' })
    .text('₹' + grandTotal.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });

  // Payment mode (left, below table)
  doc.font('Helvetica').fontSize(10).fillColor('black')
    .text(`Payment Mode: ${order.paymentMode || ''}`, 40, sumY + 28);

  // Footer - bottom aligned
  doc.fontSize(8)
    .fillColor('black')
    .text('Note: This invoice is issued by the pharmacy.', 40, 730)
    .text('Godavaii acts only as a facilitator for orders and delivery.', 40, 742);

  doc.fontSize(10)
    .fillColor(primary)
    .font('Helvetica-Bold')
    .text('Thank you for choosing GODAVAII', 40, 760, { align: 'center' })
    .fontSize(9)
    .fillColor('black')
    .font('Helvetica')
    .text('www.godavaii.in | +91-XXXXXXXXXX', { align: 'center' });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });
}

module.exports = generateInvoice;
