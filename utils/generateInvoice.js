// uploads/generateInvoice.js
// Two-page PDF invoice:
//   Page 1: Medicines (issued by pharmacy) — per-item GST with buckets
//   Page 2: Platform Fee (issued by GoDavaii) — tax-inclusive 18%
// Footer contact shows email (support@godavaii.com)

const PDFDocument = require("pdfkit");
const { classifyHSNandGST } = require("../utils/tax/taxClassifier");

// ---------- helpers ----------
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
    .map(([, v]) => v);
  if (rest.length) return rest.join(", ");
  return JSON.stringify(addr);
}

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function splitInclusive(lineTotal, ratePct) {
  const denom = 1 + ratePct / 100;
  const base = lineTotal / denom;
  const tax = lineTotal - base;
  return { base, tax };
}

function header(doc, subtitleLeft) {
  const primary = "#13C0A2";
  const lightGrey = "#F4F4F4";
  doc.fontSize(22).fillColor(primary).font("Helvetica-Bold").text("GODAVAII", { align: "left" });
  if (subtitleLeft) {
    doc.moveDown(0.2);
    doc.fontSize(12).fillColor("black").font("Helvetica").text(subtitleLeft, { align: "left" });
  }
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(lightGrey).lineWidth(1).stroke();
}

// ---------- Page 1: Medicines ----------
async function pageMedicines(doc, { order, pharmacy, customer }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#eafaf3";
  const lightGrey = "#F4F4F4";

  header(doc, "Invoice for Medicine Purchase");

  // Invoice & Pharmacy Info (two columns)
  doc.moveDown(0.7).fontSize(10).fillColor("black").font("Helvetica");
  const startY = doc.y;

  // Left column
  doc.font("Helvetica-Bold").text(`Invoice No:`, 40, startY, { continued: true }).font("Helvetica").text(` ${order.invoiceNo || ""}`);
  doc.font("Helvetica-Bold").text(`Order ID:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.orderId || ""}`);
  doc.font("Helvetica-Bold").text(`Order Date:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.date || ""}`);
  doc.font("Helvetica-Bold").text(`Delivery Date:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.deliveryDate || ""}`);

  // Right column
  const rightColX = 320;
  let pharmacyY = startY;
  doc.font("Helvetica-Bold").text(`Pharmacy:`, rightColX, pharmacyY);
  doc.font("Helvetica").text(`${pharmacy?.name || ""}`, rightColX + 80, pharmacyY);
  pharmacyY = doc.y;
  doc.font("Helvetica-Bold").text(`Address:`, rightColX, pharmacyY);
  doc.font("Helvetica").text(`${pharmacy?.address || ""}`, rightColX + 80, pharmacyY);
  pharmacyY = doc.y;
  doc.font("Helvetica-Bold").text(`GSTIN:`, rightColX, pharmacyY);
  doc.font("Helvetica").text(`${pharmacy?.gstin || ""}`, rightColX + 80, pharmacyY);

  // Customer
  doc.moveDown(1.2);
  doc.font("Helvetica-Bold").text(`Customer:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${customer?.name || ""}`);
  doc.font("Helvetica-Bold").text(`Address:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${getPrintableAddress(customer?.address)}`);

  // Table header
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  let tableY = doc.y + 8;
  // Columns: S.No | Medicine (w/ HSN) | Qty | Price | GST% | Total (Incl.)
  const col = {
    sno: 50,
    name: 90,
    qty: 310,
    price: 360,
    gst: 430,
    total: 480,
  };
  doc.rect(40, tableY, 515, 22).fill(tableHeaderBG).stroke();
  doc.font("Helvetica-Bold").fontSize(10).fillColor(primary)
    .text("S.No", col.sno, tableY + 6, { width: 30 })
    .text("Medicine", col.name, tableY + 6, { width: 210 })
    .text("Qty", col.qty, tableY + 6, { width: 40, align: "center" })
    .text("Price", col.price, tableY + 6, { width: 60, align: "center" })
    .text("GST %", col.gst, tableY + 6, { width: 40, align: "center" })
    .text("Total", col.total, tableY + 6, { width: 60, align: "center" });

  // Classify all items first (parallel), then render rows
  const items = Array.isArray(order.items) ? order.items : [];
  const cls = await Promise.all(
    items.map(async (it) => {
      try { return await classifyHSNandGST(it); } catch { return null; }
    })
  );

  let subtotalIncl = 0;
  let rowY = tableY + 22;
  const rateBuckets = {}; // { '5': {base, tax}, '12': {...}, ... }

  doc.font("Helvetica").fontSize(10).fillColor("black");

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const qty = Number(it.quantity || 0);
    const price = Number(it.price || 0);
    const lineTotal = qty * price;
    const decided = cls[i] || {};
    const rate = Number(decided.gstRate ?? it.gstRate ?? 12);
    const { base, tax } = splitInclusive(lineTotal, rate);
    const key = String(rate);
    if (!rateBuckets[key]) rateBuckets[key] = { base: 0, tax: 0 };
    rateBuckets[key].base += base;
    rateBuckets[key].tax += tax;

    subtotalIncl += lineTotal;

    // Row render
    doc.text(i + 1, col.sno, rowY + 6, { width: 30, align: "left" });

    const nameCell =
      (it.name || "") + (decided.hsn ? ` (HSN ${decided.hsn})` : "");
    doc.text(nameCell, col.name, rowY + 6, { width: 210 });

    doc.text(qty || "", col.qty, rowY + 6, { width: 40, align: "center" });
    doc.text("Rs." + (price || 0), col.price, rowY + 6, { width: 60, align: "center" });
    doc.text(String(rate) + "%", col.gst, rowY + 6, { width: 40, align: "center" });
    doc.text("Rs." + lineTotal.toFixed(2), col.total, rowY + 6, { width: 60, align: "center" });

    rowY += 22;

    // rule lines + page break
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor(lightGrey).lineWidth(0.5).stroke();
    if (rowY > 680) {
      doc.addPage();
      doc.fontSize(12).fillColor(primary).font("Helvetica-Bold").text("Medicines (contd.)", 40, 50);
      rowY = 80;
    }
  }

  // Summary (right)
  const summaryX = 320, labelW = 180, valueW = 85;
  const totalMedicinesTax = r2(Object.values(rateBuckets).reduce((s, v) => s + v.tax, 0));
  const taxableMedicines = r2(Object.values(rateBuckets).reduce((s, v) => s + v.base, 0));
  const medicinesGross = r2(taxableMedicines + totalMedicinesTax);

  doc.font("Helvetica-Bold").fontSize(11);
  let sumY = rowY + 16;
  doc.text("Taxable Value (Medicines):", summaryX, sumY, { width: labelW, align: "right" });
  doc.font("Helvetica").text("Rs." + taxableMedicines.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });
  sumY += 17;
  doc.font("Helvetica-Bold").text("GST on Medicines (exact):", summaryX, sumY, { width: labelW, align: "right" });
  doc.font("Helvetica").text("Rs." + totalMedicinesTax.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  // Rate-wise breakup
  const rates = Object.keys(rateBuckets).map(Number).sort((a,b)=>a-b);
  sumY += 8;
  doc.font("Helvetica").fillColor("#333");
  for (const r of rates) {
    const b = rateBuckets[String(r)];
    sumY += 14;
    doc.text(`• GST @ ${r}%:`, summaryX, sumY, { width: labelW, align: "right" });
    doc.text("Rs." + r2(b.tax).toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });
  }

  sumY += 16;
  doc.moveTo(summaryX, sumY + 15).lineTo(summaryX + labelW + valueW + 20, sumY + 15).strokeColor(primary).lineWidth(1).stroke();
  sumY += 22;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(primary)
    .text("Medicines Total:", summaryX, sumY, { width: labelW, align: "right" })
    .text("Rs." + medicinesGross.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  // Payment + footer
  doc.moveDown(1.0);
  doc.font("Helvetica").fontSize(10).fillColor("black")
    .text(`Payment Mode: ${order.paymentMode || ""}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  doc.fontSize(8).fillColor("#888")
    .text("Note: This invoice page is issued by the pharmacy for medicines.", 40, 730)
    .text("GoDavaii acts as a facilitator for orders and delivery.", 40, 742);

  doc.fontSize(10).fillColor(primary).font("Helvetica-Bold")
    .text("Thank you for choosing GODAVAII", 40, 760, { align: "center" });
  doc.fontSize(9).fillColor("black").font("Helvetica")
    .text("www.godavaii.com | support@godavaii.com", { align: "center" });

  return { medicinesGross, taxableMedicines, totalMedicinesTax };
}

// ---------- Page 2: Platform Fee ----------
function pagePlatformFee(doc, { order, company, platformFeeGross }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#eafaf3";

  doc.addPage();
  header(doc, "Platform Fee Tax Invoice");

  // Left: Company (you are a platform/service provider, not a pharmacy)
  doc.moveDown(0.7).fontSize(10).fillColor("black").font("Helvetica");
  const startY = doc.y;
  doc.font("Helvetica-Bold").text(`Platform (Service Provider):`, 40, startY);
  doc.font("Helvetica")
    .text(`${company?.name || "Karniva Private Limited (GoDavaii)"}`, 220, startY)
    .text(`${company?.address || "Sector 62, Noida, Uttar Pradesh"}`, 220, doc.y);
  doc.font("Helvetica-Bold").text(`GSTIN:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${company?.gstin || ""}`);

  // Right: IDs & dates
  const rightColX = 320;
  let y = startY;
  doc.font("Helvetica-Bold").text(`Invoice No:`, rightColX, y, { continued: true }).font("Helvetica").text(` ${order.invoiceNo || ""}-PF`);
  doc.font("Helvetica-Bold").text(`Order ID:`, rightColX, doc.y, { continued: true }).font("Helvetica").text(` ${order.orderId || ""}`);
  doc.font("Helvetica-Bold").text(`Order Date:`, rightColX, doc.y, { continued: true }).font("Helvetica").text(` ${order.date || ""}`);
  doc.font("Helvetica-Bold").text(`Delivery Date:`, rightColX, doc.y, { continued: true }).font("Helvetica").text(` ${order.deliveryDate || ""}`);

  // Section line
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  // Line item (tax inclusive 18%)
  const gross = Number(platformFeeGross || 0);
  const { base, tax } = splitInclusive(gross, 18);

  // Table header
  const tY = doc.y + 8;
  const col = { sno: 50, desc: 90, gst: 420, amt: 480 };
  doc.rect(40, tY, 515, 22).fill(tableHeaderBG).stroke();
  doc.font("Helvetica-Bold").fontSize(10).fillColor(primary)
    .text("S.No", col.sno, tY + 6, { width: 35 })
    .text("Description", col.desc, tY + 6, { width: 300 })
    .text("GST %", col.gst, tY + 6, { width: 50, align: "center" })
    .text("Amount (Incl. GST)", col.amt, tY + 6, { width: 75, align: "center" });

  // Row
  let rowY = tY + 22;
  doc.font("Helvetica").fontSize(10).fillColor("black");
  doc.text(1, col.sno, rowY + 6, { width: 35 });
  doc.text("Platform Fee (tax inclusive)", col.desc, rowY + 6, { width: 300 });
  doc.text("18%", col.gst, rowY + 6, { width: 50, align: "center" });
  doc.text("Rs." + gross.toFixed(2), col.amt, rowY + 6, { width: 75, align: "center" });

  rowY += 22;
  doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#F4F4F4").lineWidth(0.5).stroke();

  // Summary (right) — tuned widths to avoid any overlap/wrap
  const summaryX = 340, labelW = 170, valueW = 95;
  let sumY = rowY + 16;

  doc.font("Helvetica-Bold").fontSize(11)
    .text("Taxable Value (Platform Fee):", summaryX, sumY, { width: labelW, align: "right" });
  doc.font("Helvetica").text("Rs." + r2(base).toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  sumY += 17;
  doc.font("Helvetica-Bold")
    .text("GST @ 18% (included):", summaryX, sumY, { width: labelW, align: "right" });
  doc.font("Helvetica").text("Rs." + r2(tax).toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  sumY += 10;
  doc.moveTo(summaryX, sumY + 15).lineTo(summaryX + labelW + valueW + 20, sumY + 15).strokeColor(primary).lineWidth(1).stroke();
  sumY += 22;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(primary)
    .text("Platform Fee Total:", summaryX, sumY, { width: labelW, align: "right" })
    .text("Rs." + r2(gross).toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  // Payment + footer
  doc.moveDown(1.0);
  doc.font("Helvetica").fontSize(10).fillColor("black")
    .text(`Payment Mode: ${order.paymentMode || ""}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  doc.fontSize(8).fillColor("#888")
    .text("Note: This invoice page is issued by GoDavaii for platform/service fee.", 40, 730)
    .text("For medicines, please refer to the previous page issued by the pharmacy.", 40, 742);

  doc.fontSize(10).fillColor(primary).font("Helvetica-Bold")
    .text("Thank you for choosing GODAVAII", 40, 760, { align: "center" });
  doc.fontSize(9).fillColor("black").font("Helvetica")
    .text("www.godavaii.com | support@godavaii.com", { align: "center" });
}

// ---------- Main ----------
async function generateInvoice({ order, pharmacy, customer, company, platformFeeGross }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  await pageMedicines(doc, { order, pharmacy, customer });
  pagePlatformFee(doc, { order, company, platformFeeGross });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });
}

module.exports = generateInvoice;