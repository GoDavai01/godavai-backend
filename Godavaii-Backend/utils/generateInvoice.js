const PDFDocument = require('pdfkit');

function getPrintableAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  if (addr.formatted) return addr.formatted;
  if (addr.fullAddress) return addr.fullAddress;
  // Try addressLine, floor, area, city
  const mainParts = [addr.addressLine, addr.floor, addr.area, addr.city].filter(Boolean);
  if (mainParts.length) return mainParts.join(", ");
  // Try everything except lat/lng/coordinates/object fields
  const ignore = ["lat", "lng", "coordinates"];
  const rest = Object.entries(addr)
    .filter(([k, v]) => v && !ignore.includes(k) && typeof v !== "object")
    .map(([k, v]) => v);
  if (rest.length) return rest.join(", ");
  return JSON.stringify(addr);
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
  doc.fontSize(22).fillColor(primary).font('Helvetica-Bold').text('GODAVAII', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor('black').font('Helvetica').text('Invoice for Medicine Purchase', { align: 'left' });

  // Draw a top line
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(lightGrey).lineWidth(1).stroke();

  // Invoice & Pharmacy Info (two columns)
  doc.moveDown(0.7).fontSize(10).fillColor('black').font('Helvetica');
  const startY = doc.y;
  doc.font('Helvetica-Bold').text(`Invoice No:`, 40, startY, { continued: true }).font('Helvetica').text(` ${order.invoiceNo || ''}`);
  doc.font('Helvetica-Bold').text(`Order ID:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${order.orderId || ''}`);
  doc.font('Helvetica-Bold').text(`Order Date:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${order.date || ''}`);
  doc.font('Helvetica-Bold').text(`Delivery Date:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${order.deliveryDate || ''}`);

  // Right column: Pharmacy
  const rightColX = 320;
  let pharmacyY = startY;
  doc.font('Helvetica-Bold').text(`Pharmacy:`, rightColX, pharmacyY);
  doc.font('Helvetica').text(`${pharmacy?.name || ''}`, rightColX + 70, pharmacyY);
  pharmacyY = doc.y;
  doc.font('Helvetica-Bold').text(`Address:`, rightColX, pharmacyY);
  doc.font('Helvetica').text(`${pharmacy?.address || ''}`, rightColX + 70, pharmacyY);
  pharmacyY = doc.y;
  doc.font('Helvetica-Bold').text(`GSTIN:`, rightColX, pharmacyY);
  doc.font('Helvetica').text(`${pharmacy?.gstin || ''}`, rightColX + 70, pharmacyY);

  // Customer
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').text(`Customer:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${customer?.name || ''}`);
  doc.font('Helvetica-Bold').text(`Address:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${getPrintableAddress(customer?.address)}`);

  // Draw section line before table
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  // Table Header
  let tableY = doc.y + 8;
  const colXs = [50, 90, 260, 320, 400];
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
    doc.text('Rs.' + (item.price || 0), colXs[3], rowY + 6, { width: 60, align: 'center' });
    doc.text('Rs.' + total.toFixed(2), colXs[4], rowY + 6, { width: 60, align: 'center' });
    rowY += 22;
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor(lightGrey).lineWidth(0.5).stroke();
  });

  // Summary on the right
  const summaryX = 350, labelW = 110, valueW = 60;
  const gst = +(subtotal * 0.05).toFixed(2);
  const grandTotal = +(subtotal + gst).toFixed(2);

  doc.font('Helvetica-Bold').fontSize(11);
  let sumY = rowY + 16;
  doc.text('Subtotal:', summaryX, sumY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text('Rs.' + subtotal.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });
  sumY += 17;
  doc.font('Helvetica-Bold').text('GST (5%):', summaryX, sumY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text('Rs.' + gst.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });
  sumY += 10;
  doc.moveTo(summaryX, sumY + 15).lineTo(summaryX + labelW + valueW + 20, sumY + 15).strokeColor(primary).lineWidth(1).stroke();
  sumY += 22;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(primary)
    .text('Total Amount:', summaryX, sumY, { width: labelW, align: 'right' })
    .text('Rs.' + grandTotal.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });

  // Print order note if present
  if (order.notes) {
    doc.moveDown(1.2);
    doc.fontSize(9).fillColor('#00897b').font('Helvetica-Bold').text('Order Note:', 40, doc.y);
    doc.fontSize(9).fillColor('#333').font('Helvetica').text(order.notes, 100, doc.y, { width: 400 });
  }

  // Payment mode
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(10).fillColor('black')
    .text(`Payment Mode: ${order.paymentMode || ''}`, 40, doc.y);

  // Footer - faint separator, small, light font, left-aligned
  doc.moveTo(40, 720).lineTo(555, 720).strokeColor('#E0E0E0').lineWidth(1).stroke();
  doc.fontSize(8).fillColor('#888')
    .text('Note: This invoice is issued by the pharmacy.', 40, 730)
    .text('Godavaii acts only as a facilitator for orders and delivery.', 40, 742);

  // Centered thanks and site info at bottom
  doc.fontSize(10).fillColor(primary).font('Helvetica-Bold')
    .text('Thank you for choosing GODAVAII', 40, 760, { align: 'center' });
  doc.fontSize(9).fillColor('black').font('Helvetica')
    .text('www.godavaii.in | +91-XXXXXXXXXX', { align: 'center' });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });
}

module.exports = generateInvoice;
