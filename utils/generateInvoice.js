// uploads/generateInvoice.js
// Page 1: Pharmacy invoice (HSN + CGST/SGST split, price math fixed)
// Page 2: Platform Fee invoice (unchanged, tax-inclusive 18%)
// Footer contact shows email (support@godavaii.com)

const PDFDocument = require("pdfkit");
const { classifyHSNandGST } = require("../utils/tax/taxClassifier");

// ---------- helpers ----------
function getPrintableAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  if (addr.formatted) return addr.formatted;
  if (addr.fullAddress) return addr.fullAddress;
  const main = [addr.addressLine, addr.floor, addr.area, addr.city].filter(Boolean);
  if (main.length) return main.join(", ");
  const ignore = ["lat", "lng", "coordinates"];
  const rest = Object.entries(addr)
    .filter(([k, v]) => v && !ignore.includes(k) && typeof v !== "object")
    .map(([, v]) => v);
  return rest.length ? rest.join(", ") : JSON.stringify(addr);
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Given a GROSS line amount (inclusive) and rate%, return base+tax
function splitInclusive(lineTotal, ratePct) {
  const denom = 1 + (ratePct || 0) / 100;
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

// ---------- Page 1: Medicines (pharmacy invoice) ----------
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
  // Delivery date removed (30-min delivery; same-day)

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

  const tableY = doc.y + 8;

  // New columns (fits 515px width):
  // S.No | Medicine | Qty | Taxable(₹) | HSN | CGST% | CGST(₹) | SGST% | SGST(₹) | Total(₹)
  const col = {
    sno: 44,
    name: 135,
    qty: 28,
    taxable: 56,
    hsn: 46,
    cgstPct: 34,
    cgstAmt: 46,
    sgstPct: 34,
    sgstAmt: 46,
    total: 56,
    x: 40,
  };

  // Precompute absolute x positions
  const x = {
    sno: col.x,
    name: col.x + col.sno,
    qty: col.x + col.sno + col.name,
    taxable: col.x + col.sno + col.name + col.qty,
    hsn: col.x + col.sno + col.name + col.qty + col.taxable,
    cgstPct: col.x + col.sno + col.name + col.qty + col.taxable + col.hsn,
    cgstAmt: col.x + col.sno + col.name + col.qty + col.taxable + col.hsn + col.cgstPct,
    sgstPct: col.x + col.sno + col.name + col.qty + col.taxable + col.hsn + col.cgstPct + col.cgstAmt,
    sgstAmt: col.x + col.sno + col.name + col.qty + col.taxable + col.hsn + col.cgstPct + col.cgstAmt + col.sgstPct,
    total:   col.x + col.sno + col.name + col.qty + col.taxable + col.hsn + col.cgstPct + col.cgstAmt + col.sgstPct + col.sgstAmt,
  };

  // Header row
  doc.rect(40, tableY, 515, 24).fill(tableHeaderBG).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
    .text("S.No", x.sno, tableY + 6, { width: col.sno, align: "left" })
    .text("Medicine", x.name, tableY + 6, { width: col.name })
    .text("Qty", x.qty, tableY + 6, { width: col.qty, align: "center" })
    .text("Taxable (₹)", x.taxable, tableY + 6, { width: col.taxable, align: "right" })
    .text("HSN", x.hsn, tableY + 6, { width: col.hsn, align: "center" })
    .text("CGST %", x.cgstPct, tableY + 6, { width: col.cgstPct, align: "center" })
    .text("CGST (₹)", x.cgstAmt, tableY + 6, { width: col.cgstAmt, align: "right" })
    .text("SGST %", x.sgstPct, tableY + 6, { width: col.sgstPct, align: "center" })
    .text("SGST (₹)", x.sgstAmt, tableY + 6, { width: col.sgstAmt, align: "right" })
    .text("Total (₹)", x.total, tableY + 6, { width: col.total, align: "right" });

  // Classify all items first
  const items = Array.isArray(order.items) ? order.items : [];
  const cls = await Promise.all(items.map(async (it) => {
    try { return await classifyHSNandGST(it); } catch { return null; }
  }));

  // Totals
  let grandGross = 0;
  let grandBase = 0;
  let grandCGST = 0;
  let grandSGST = 0;

  let rowY = tableY + 24;
  doc.font("Helvetica").fontSize(9).fillColor("black");

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const qty = Number(it.quantity || 0);
    const unitGross = Number(it.price || 0);      // user-entered selling price (inclusive)
    const rate = Number((cls[i] && cls[i].gstRate) ?? it.gstRate ?? 12);

    const lineGross = qty * unitGross;            // what customer pays for the line
    const { base: baseIncl, tax: taxIncl } = splitInclusive(lineGross, rate);
    const cgstPct = rate / 2;
    const sgstPct = rate / 2;
    const cgstAmt = taxIncl / 2;
    const sgstAmt = taxIncl / 2;

    grandGross += lineGross;
    grandBase += baseIncl;
    grandCGST += cgstAmt;
    grandSGST += sgstAmt;

    // Render row
    doc.text(String(i + 1), x.sno, rowY + 6, { width: col.sno });
    doc.text((it.name || ""), x.name, rowY + 6, { width: col.name });
    doc.text(qty || "", x.qty, rowY + 6, { width: col.qty, align: "center" });
    doc.text(r2(baseIncl).toFixed(2), x.taxable, rowY + 6, { width: col.taxable, align: "right" });

    const decided = cls[i] || {};
    const hsn = decided.hsn ? String(decided.hsn) : "";
    doc.text(hsn, x.hsn, rowY + 6, { width: col.hsn, align: "center" });

    doc.text(r2(cgstPct).toFixed(1), x.cgstPct, rowY + 6, { width: col.cgstPct, align: "center" });
    doc.text(r2(cgstAmt).toFixed(2), x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "right" });
    doc.text(r2(sgstPct).toFixed(1), x.sgstPct, rowY + 6, { width: col.sgstPct, align: "center" });
    doc.text(r2(sgstAmt).toFixed(2), x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "right" });
    doc.text(r2(lineGross).toFixed(2), x.total, rowY + 6, { width: col.total, align: "right" });

    rowY += 22;

    // rule lines + page break
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor(lightGrey).lineWidth(0.5).stroke();
    if (rowY > 680) {
      doc.addPage();
      doc.fontSize(12).fillColor(primary).font("Helvetica-Bold").text("Medicines (contd.)", 40, 50);
      rowY = 80;
    }
  }

  // Summary block (right) – like Zomato style
  const summaryX = 290, labelW = 210, valueW = 95;
  const taxableMedicines = r2(grandBase);
  const totalCGST = r2(grandCGST);
  const totalSGST = r2(grandSGST);
  const medicinesGross = r2(grandGross);

  doc.font("Helvetica-Bold").fontSize(11);
  let sumY = rowY + 16;

  doc.text("Net Taxable Value:", summaryX, sumY, { width: labelW, align: "right" });
  doc.font("Helvetica").text("Rs." + taxableMedicines.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  sumY += 17;
  doc.font("Helvetica-Bold").text("CGST (INR):", summaryX, sumY, { width: labelW, align: "right" });
  doc.font("Helvetica").text("Rs." + totalCGST.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  sumY += 17;
  doc.font("Helvetica-Bold").text("SGST (INR):", summaryX, sumY, { width: labelW, align: "right" });
  doc.font("Helvetica").text("Rs." + totalSGST.toFixed(2), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  sumY += 10;
  doc.moveTo(summaryX, sumY + 15).lineTo(summaryX + labelW + valueW + 20, sumY + 15).strokeColor(primary).lineWidth(1).stroke();
  sumY += 22;

  doc.font("Helvetica-Bold").fontSize(13).fillColor(primary)
    .text("Grand Total:", summaryX, sumY, { width: labelW, align: "right" })
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

  return {
    medicinesGross,
    taxableMedicines,
    totalMedicinesTax: r2(totalCGST + totalSGST),
  };
}

// ---------- Page 2: Platform Fee (unchanged) ----------
function pagePlatformFee(doc, { order, company, platformFeeGross }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#eafaf3";

  doc.addPage();
  header(doc, "Platform Fee Tax Invoice");

  // Left: Company (platform/service provider)
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
  // Delivery date removed

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
