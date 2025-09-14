// uploads/generateInvoice.js
const PDFDocument = require('pdfkit');
const axios = require('axios'); // optional: used only if GST inference API is configured

function getPrintableAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  if (addr.formatted) return addr.formatted;
  if (addr.fullAddress) return addr.fullAddress;
  const mainParts = [addr.addressLine, addr.floor, addr.area, addr.city].filter(Boolean);
  if (mainParts.length) return mainParts.join(", ");
  const ignore = ["lat", "lng", "coordinates"];
  const rest = Object.entries(addr)
    .filter(([k, v]) => v && !ignore.includes(k) && typeof v !== "object")
    .map(([k, v]) => v);
  if (rest.length) return rest.join(", ");
  return JSON.stringify(addr);
}

// --- GST helpers -------------------------------------------------------------

// Try to infer GST rate per item.
// Priority: explicit item.gstRate -> AI endpoint (optional) -> heuristics -> default 12
async function inferGstRate(item) {
  // 1) explicit on item
  if (typeof item.gstRate === "number") return item.gstRate;

  // 2) external mini-AI (optional)
  const apiUrl = process.env.GST_INFER_API_URL; // you can point this to your GPT-4o mini function
  const apiKey = process.env.GST_INFER_API_KEY;
  if (apiUrl) {
    try {
      const resp = await axios.post(apiUrl, {
        name: item.name,
        brand: item.brand,
        category: item.category,
        hsn: item.hsn,
      }, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        timeout: 2000
      });
      const r = Number(resp.data?.gstRate);
      if (!Number.isNaN(r) && r >= 0 && r <= 28) return r;
    } catch (_) {}
  }

  // 3) heuristic keywords (very small, harmless defaults)
  const name = `${item.name || ""} ${item.brand || ""} ${Array.isArray(item.category)? item.category.join(" ") : (item.category || "")}`.toLowerCase();
  const low5 = ["insulin", "vaccine", "syrup for children", "dialysis", "anti-cancer", "anti cancer", "life-saving"].some(k => name.includes(k));
  if (low5) return 5;

  // Many common formulations retail at 12% slab
  const typical12 = ["tablet", "capsule", "syrup", "ointment", "drop", "injection", "antibiotic", "paracetamol", "ibuprofen", "antacid", "vitamin", "supplement", "bandage", "gauze", "pain"];
  if (typical12.some(k => name.includes(k))) return 12;

  // fallback
  return 12;
}

// Given a tax-inclusive lineTotal and rate, split into base and tax
function splitInclusive(lineTotal, ratePct) {
  const denom = 1 + ratePct / 100;
  const base = lineTotal / denom;
  const tax = lineTotal - base;
  return { base, tax };
}

// Round to 2 decimals safely
function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// --- PDF helpers -------------------------------------------------------------

function header(doc, titleLeft, subtitleLeft) {
  const primary = "#13C0A2";
  const lightGrey = "#F4F4F4";
  doc.fontSize(22).fillColor(primary).font('Helvetica-Bold').text('GODAVAII', { align: 'left' });
  if (subtitleLeft) {
    doc.moveDown(0.2);
    doc.fontSize(12).fillColor('black').font('Helvetica').text(subtitleLeft, { align: 'left' });
  }
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(lightGrey).lineWidth(1).stroke();
}

async function pageMedicines(doc, { order, pharmacy, customer }) {
  const primary = "#13C0A2";
  const lightGrey = "#F4F4F4";
  const tableHeaderBG = "#eafaf3";

  header(doc, 'GODAVAII', 'Invoice for Medicine Purchase');

  // Invoice & Pharmacy Info (two columns)
  doc.moveDown(0.7).fontSize(10).fillColor('black').font('Helvetica');
  const startY = doc.y;
  doc.font('Helvetica-Bold').text(`Invoice No:`, 40, startY, { continued: true }).font('Helvetica').text(` ${order.invoiceNo || ''}`);
  doc.font('Helvetica-Bold').text(`Order ID:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${order.orderId || ''}`);
  doc.font('Helvetica-Bold').text(`Order Date:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${order.date || ''}`);
  doc.font('Helvetica-Bold').text(`Delivery Date:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${order.deliveryDate || ''}`);

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

  // Section line
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  // Table Header
  let tableY = doc.y + 8;
  // columns: SNo | Medicine | Qty | Price | Total
  const colXs = [50, 90, 260, 330, 410];
  doc.rect(40, tableY, 515, 22).fill(tableHeaderBG).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(primary)
    .text('S.No', colXs[0], tableY + 6, { width: 35 })
    .text('Medicine Name', colXs[1], tableY + 6, { width: 170 })
    .text('Qty', colXs[2], tableY + 6, { width: 50, align: 'center' })
    .text('Price', colXs[3], tableY + 6, { width: 70, align: 'center' })
    .text('Total', colXs[4], tableY + 6, { width: 70, align: 'center' });

  // Table Rows + GST inference
  let subtotalIncl = 0;
  let rowY = tableY + 22;
  doc.font('Helvetica').fontSize(10).fillColor('black');

  const rateBuckets = {}; // { '5': {base, tax}, '12': {base, tax}, ... }
  const items = Array.isArray(order.items) ? order.items : [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const qty = Number(it.quantity || 0);
    const price = Number(it.price || 0);
    const lineTotal = qty * price;

    // infer GST rate for this item (async allowed inside loop)
    const rate = await inferGstRate(it);
    const { base, tax } = splitInclusive(lineTotal, rate);
    const key = String(rate);
    if (!rateBuckets[key]) rateBuckets[key] = { base: 0, tax: 0 };
    rateBuckets[key].base += base;
    rateBuckets[key].tax += tax;

    subtotalIncl += lineTotal;

    // draw row
    doc.text(i + 1, colXs[0], rowY + 6, { width: 35 });
    doc.text((it.name || ''), colXs[1], rowY + 6, { width: 170 });
    doc.text(qty || '', colXs[2], rowY + 6, { width: 50, align: 'center' });
    doc.text('Rs.' + (price || 0), colXs[3], rowY + 6, { width: 70, align: 'center' });
    doc.text('Rs.' + lineTotal.toFixed(2), colXs[4], rowY + 6, { width: 70, align: 'center' });

    rowY += 22;

    // page break if needed
    if (rowY > 680) {
      doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor(lightGrey).lineWidth(0.5).stroke();
      await new Promise(res => { doc.addPage(); res(); });
      // reprint a tiny header for continuity
      doc.fontSize(12).fillColor(primary).font('Helvetica-Bold').text('Medicines (contd.)', 40, 50);
      rowY = 80;
    } else {
      doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor(lightGrey).lineWidth(0.5).stroke();
    }
  }

  // Summary (right)
  const summaryX = 330, labelW = 150, valueW = 80;
  const totalMedicinesTax = r2(Object.values(rateBuckets).reduce((s, v) => s + v.tax, 0));
  const taxableMedicines = r2(Object.values(rateBuckets).reduce((s, v) => s + v.base, 0));
  const medicinesGross = r2(taxableMedicines + totalMedicinesTax); // equals subtotalIncl (subject to rounding)

  doc.font('Helvetica-Bold').fontSize(11);
  let sumY = rowY + 16;
  doc.text('Taxable Value (Medicines):', summaryX, sumY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text('Rs.' + taxableMedicines.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });
  sumY += 17;
  doc.font('Helvetica-Bold').text('GST on Medicines (exact):', summaryX, sumY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text('Rs.' + totalMedicinesTax.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });
  sumY += 10;

  // Show breakup by rate
  Object.keys(rateBuckets).sort((a,b)=>Number(a)-Number(b)).forEach(rateStr => {
    const b = rateBuckets[rateStr];
    sumY += 14;
    doc.font('Helvetica').fillColor('#333')
      .text(`• GST @ ${rateStr}%:`, summaryX, sumY, { width: labelW, align: 'right' });
    doc.text('Rs.' + r2(b.tax).toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });
  });

  sumY += 16;
  doc.moveTo(summaryX, sumY + 15).lineTo(summaryX + labelW + valueW + 20, sumY + 15).strokeColor(primary).lineWidth(1).stroke();
  sumY += 22;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(primary)
    .text('Medicines Total:', summaryX, sumY, { width: labelW, align: 'right' })
    .text('Rs.' + medicinesGross.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });

  // Payment + Footers
  doc.moveDown(1.0);
  doc.font('Helvetica').fontSize(10).fillColor('black')
    .text(`Payment Mode: ${order.paymentMode || ''}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor('#E0E0E0').lineWidth(1).stroke();
  doc.fontSize(8).fillColor('#888')
    .text('Note: This invoice page is issued by the pharmacy for medicines.', 40, 730)
    .text('Godavaii acts as a facilitator for orders and delivery.', 40, 742);

  // Thank you
  doc.fontSize(10).fillColor(primary).font('Helvetica-Bold')
    .text('Thank you for choosing GODAVAII', 40, 760, { align: 'center' });
  doc.fontSize(9).fillColor('black').font('Helvetica')
    .text('www.godavaii.com | support@godavaii.com', { align: 'center' });

  return { medicinesGross, taxableMedicines, totalMedicinesTax, rateBuckets };
}

function pagePlatformFee(doc, { order, company, platformFeeGross }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#eafaf3";

  doc.addPage();
  header(doc, 'GODAVAII', 'Platform Fee Tax Invoice');

  // Left: Company
  doc.moveDown(0.7).fontSize(10).fillColor('black').font('Helvetica');
  const startY = doc.y;
  doc.font('Helvetica-Bold').text(`Supplier:`, 40, startY);
  const cY = doc.y;
  doc.font('Helvetica').text(`${company?.name || 'Karniva Private Limited (GoDavaii)'}`, 110, startY);
  doc.text(`${company?.address || 'Sector 62, Noida, Uttar Pradesh'}`, 110, doc.y);
  doc.font('Helvetica-Bold').text(`GSTIN:`, 40, doc.y, { continued: true }).font('Helvetica').text(` ${company?.gstin || ''}`);

  // Right: Invoice identifiers
  const rightColX = 320;
  let y = startY;
  doc.font('Helvetica-Bold').text(`Invoice No:`, rightColX, y, { continued: true }).font('Helvetica').text(` ${order.invoiceNo || ''}-PF`);
  doc.font('Helvetica-Bold').text(`Order ID:`, rightColX, doc.y, { continued: true }).font('Helvetica').text(` ${order.orderId || ''}`);
  doc.font('Helvetica-Bold').text(`Order Date:`, rightColX, doc.y, { continued: true }).font('Helvetica').text(` ${order.date || ''}`);
  doc.font('Helvetica-Bold').text(`Delivery Date:`, rightColX, doc.y, { continued: true }).font('Helvetica').text(` ${order.deliveryDate || ''}`);

  // Section line
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  // Single line item: Platform Fee (tax-inclusive)
  const gross = Number(platformFeeGross || 0);
  const { base, tax } = splitInclusive(gross, 18);

  // Table Header
  let tableY = doc.y + 8;
  const colXs = [50, 90, 360, 430];
  doc.rect(40, tableY, 515, 22).fill(tableHeaderBG).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(primary)
    .text('S.No', colXs[0], tableY + 6, { width: 35 })
    .text('Description', colXs[1], tableY + 6, { width: 250 })
    .text('GST %', colXs[2], tableY + 6, { width: 60, align: 'center' })
    .text('Amount (Incl. GST)', colXs[3], tableY + 6, { width: 110, align: 'center' });

  let rowY = tableY + 22;
  doc.font('Helvetica').fontSize(10).fillColor('black');
  doc.text(1, colXs[0], rowY + 6, { width: 35 });
  doc.text('Platform / Convenience Fee (tax inclusive)', colXs[1], rowY + 6, { width: 250 });
  doc.text('18%', colXs[2], rowY + 6, { width: 60, align: 'center' });
  doc.text('Rs.' + gross.toFixed(2), colXs[3], rowY + 6, { width: 110, align: 'center' });
  rowY += 22;
  doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor('#F4F4F4').lineWidth(0.5).stroke();

  // Summary (right)
  const summaryX = 330, labelW = 150, valueW = 80;
  let sumY = rowY + 16;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('black')
    .text('Taxable Value (Platform Fee):', summaryX, sumY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text('Rs.' + r2(base).toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });

  sumY += 17;
  doc.font('Helvetica-Bold').text('GST @ 18% (included):', summaryX, sumY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text('Rs.' + r2(tax).toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });

  sumY += 10;
  doc.moveTo(summaryX, sumY + 15).lineTo(summaryX + labelW + valueW + 20, sumY + 15).strokeColor(primary).lineWidth(1).stroke();
  sumY += 22;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(primary)
    .text('Platform Fee Total:', summaryX, sumY, { width: labelW, align: 'right' })
    .text('Rs.' + r2(gross).toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: 'right' });

  // Payment + Footers
  doc.moveDown(1.0);
  doc.font('Helvetica').fontSize(10).fillColor('black')
    .text(`Payment Mode: ${order.paymentMode || ''}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor('#E0E0E0').lineWidth(1).stroke();
  doc.fontSize(8).fillColor('#888')
    .text('Note: This invoice page is issued by GoDavaii for platform/service fee.', 40, 730)
    .text('For medicines, please refer to the previous page issued by the pharmacy.', 40, 742);

  doc.fontSize(10).fillColor(primary).font('Helvetica-Bold')
    .text('Thank you for choosing GODAVAII', 40, 760, { align: 'center' });
  doc.fontSize(9).fillColor('black').font('Helvetica')
    .text('www.godavaii.com | support@godavaii.com', { align: 'center' });
}

async function generateInvoice({ order, pharmacy, customer, company, platformFeeGross }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));

  // Page 1: Medicines (issued by pharmacy)
  await pageMedicines(doc, { order, pharmacy, customer });

  // Page 2: Platform Fee (issued by GoDavaii)
  await pagePlatformFee(doc, { order, company, platformFeeGross });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });
}

module.exports = generateInvoice;
