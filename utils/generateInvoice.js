// uploads/generateInvoice.js
// Page 1: Pharmacy invoice (HSN + CGST/SGST split, compact table, correct totals box)
// Page 2: Platform Fee invoice (18% tax-inclusive)
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
const money = (n) => "₹" + r2(n).toFixed(2);

// Given a GROSS amount (inclusive) and rate%, return base+tax
function splitInclusive(lineTotal, ratePct) {
  const denom = 1 + (ratePct || 0) / 100;
  const base = lineTotal / denom;
  const tax = lineTotal - base;
  return { base, tax };
}

// Amount in words (Indian numbering, rupees only)
function amountInWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return "Zero Rupees";
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
    "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const toWords = (n, s) => (n ? (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "")) + (s ? " " + s : "") : "");
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num / 100000) % 100);
  const thousand = Math.floor((num / 1000) % 100);
  const hundred = Math.floor((num / 100) % 10);
  const rest = Math.floor(num % 100);
  let str = "";
  str += toWords(crore, "Crore");
  str += (str && lakh ? " " : "") + toWords(lakh, "Lakh");
  str += (str && thousand ? " " : "") + toWords(thousand, "Thousand");
  str += (str && hundred ? " " : "") + (hundred ? a[hundred] + " Hundred" : "");
  if (rest) str += (str ? " and " : "") + toWords(rest, "");
  return str + " Rupees";
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
  doc.font("Helvetica-Bold").text(`Invoice Date:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.date || ""}`);
  // Delivery date removed

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

  // Table header line
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  const tableY = doc.y + 8;

  // Column widths that sum to 515px (fit between margins)
  // S.No(30) | Name(170) | HSN(44) | Qty(28) | Taxable(58) | CGST%(32) | CGST(₹)(42) | SGST%(32) | SGST(₹)(42) | Total(₹)(37)  = 515
  const col = {
    sno: 30,
    name: 170,
    hsn: 44,
    qty: 28,
    taxable: 58,
    cgstPct: 32,
    cgstAmt: 42,
    sgstPct: 32,
    sgstAmt: 42,
    total: 37,
    x: 40,
  };

  const x = {
    sno: col.x,
    name: col.x + col.sno,
    hsn: col.x + col.sno + col.name,
    qty: col.x + col.sno + col.name + col.hsn,
    taxable: col.x + col.sno + col.name + col.hsn + col.qty,
    cgstPct: col.x + col.sno + col.name + col.hsn + col.qty + col.taxable,
    cgstAmt: col.x + col.sno + col.name + col.hsn + col.qty + col.taxable + col.cgstPct,
    sgstPct: col.x + col.sno + col.name + col.hsn + col.qty + col.taxable + col.cgstPct + col.cgstAmt,
    sgstAmt: col.x + col.sno + col.name + col.hsn + col.qty + col.taxable + col.cgstPct + col.cgstAmt + col.sgstPct,
    total:   col.x + col.sno + col.name + col.hsn + col.qty + col.taxable + col.cgstPct + col.cgstAmt + col.sgstPct + col.sgstAmt,
  };

  // Header row
  doc.rect(40, tableY, 515, 24).fill(tableHeaderBG).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
    .text("S.No", x.sno, tableY + 6, { width: col.sno, align: "left" })
    .text("Medicine", x.name, tableY + 6, { width: col.name })
    .text("HSN", x.hsn, tableY + 6, { width: col.hsn, align: "center" })
    .text("Qty", x.qty, tableY + 6, { width: col.qty, align: "center" })
    .text("Taxable (₹)", x.taxable, tableY + 6, { width: col.taxable, align: "right" })
    .text("CGST %", x.cgstPct, tableY + 6, { width: col.cgstPct, align: "center" })
    .text("CGST (₹)", x.cgstAmt, tableY + 6, { width: col.cgstAmt, align: "right" })
    .text("SGST %", x.sgstPct, tableY + 6, { width: col.sgstPct, align: "center" })
    .text("SGST (₹)", x.sgstAmt, tableY + 6, { width: col.sgstAmt, align: "right" })
    .text("Total (₹)", x.total, tableY + 6, { width: col.total, align: "right" });

  // Classify all items first
  const items = Array.isArray(order.items) ? order.items : [];
  const cls = await Promise.all(
    items.map(async (it) => {
      try { return await classifyHSNandGST(it); } catch { return null; }
    })
  );

  // Totals
  let grandGross = 0;
  let grandBase = 0;
  let grandCGST = 0;
  let grandSGST = 0;
  let grandIGST = 0; // kept for future inter-state logic (0 for local)

  let rowY = tableY + 24;
  const rowH = 22;
  doc.font("Helvetica").fontSize(9).fillColor("black");

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const qty = Number(it.quantity || 0);
    const unitGross = Number(it.price || 0); // selling price (inclusive) per unit
    const rate = Number((cls[i] && cls[i].gstRate) ?? it.gstRate ?? 12);

    const lineGross = qty * unitGross;              // what customer pays for the line
    const { base: baseIncl, tax: taxIncl } = splitInclusive(lineGross, rate);
    const cgstPct = rate / 2;
    const sgstPct = rate / 2;
    const cgstAmt = taxIncl / 2;
    const sgstAmt = taxIncl / 2;

    grandGross += lineGross;
    grandBase += baseIncl;
    grandCGST += cgstAmt;
    grandSGST += sgstAmt;

    // Render row (single-line; long names are clipped by width)
    doc.text(String(i + 1), x.sno, rowY + 6, { width: col.sno });
    doc.text((it.name || ""), x.name, rowY + 6, { width: col.name });
    doc.text((cls[i]?.hsn ? String(cls[i].hsn) : (it.hsn || "")), x.hsn, rowY + 6, { width: col.hsn, align: "center" });
    doc.text(qty || "", x.qty, rowY + 6, { width: col.qty, align: "center" });
    doc.text(r2(baseIncl).toFixed(2), x.taxable, rowY + 6, { width: col.taxable, align: "right" });
    doc.text(r2(cgstPct).toFixed(1), x.cgstPct, rowY + 6, { width: col.cgstPct, align: "center" });
    doc.text(r2(cgstAmt).toFixed(2), x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "right" });
    doc.text(r2(sgstPct).toFixed(1), x.sgstPct, rowY + 6, { width: col.sgstPct, align: "center" });
    doc.text(r2(sgstAmt).toFixed(2), x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "right" });
    doc.text(r2(lineGross).toFixed(2), x.total, rowY + 6, { width: col.total, align: "right" });

    rowY += rowH;

    // rule lines + page break
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor(lightGrey).lineWidth(0.5).stroke();
    if (rowY > 680) {
      doc.addPage();
      header(doc, "Medicines (contd.)");
      rowY = doc.y + 16;
      // re-draw header row on new page
      doc.rect(40, rowY, 515, 24).fill(tableHeaderBG).stroke();
      doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
        .text("S.No", x.sno, rowY + 6, { width: col.sno, align: "left" })
        .text("Medicine", x.name, rowY + 6, { width: col.name })
        .text("HSN", x.hsn, rowY + 6, { width: col.hsn, align: "center" })
        .text("Qty", x.qty, rowY + 6, { width: col.qty, align: "center" })
        .text("Taxable (₹)", x.taxable, rowY + 6, { width: col.taxable, align: "right" })
        .text("CGST %", x.cgstPct, rowY + 6, { width: col.cgstPct, align: "center" })
        .text("CGST (₹)", x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "right" })
        .text("SGST %", x.sgstPct, rowY + 6, { width: col.sgstPct, align: "center" })
        .text("SGST (₹)", x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "right" })
        .text("Total (₹)", x.total, rowY + 6, { width: col.total, align: "right" });
      rowY += 24;
    }
  }

  // --- Totals box (compact & clear) ---
  const taxableTotal = r2(grandBase);
  const cgstTotal    = r2(grandCGST);
  const sgstTotal    = r2(grandSGST);
  const igstTotal    = r2(grandIGST);
  const gross        = r2(taxableTotal + cgstTotal + sgstTotal + igstTotal);
  const rounded      = Math.round(gross);
  const roundOff     = r2(rounded - gross);
  const grandTotal   = r2(gross + roundOff);

  const summaryX = 300, labelW = 200, valueW = 95;
  doc.font("Helvetica-Bold").fontSize(11);
  let sumY = rowY + 16;

  const line = (label, value) => {
    doc.font("Helvetica-Bold").text(label, summaryX, sumY, { width: labelW, align: "right" });
    doc.font("Helvetica").text(money(value), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });
    sumY += 17;
  };

  line("Items Total (Taxable):", taxableTotal);
  line("CGST (₹) Total:", cgstTotal);
  line("SGST (₹) Total:", sgstTotal);
  line("IGST (₹) Total:", igstTotal);

  // divider
  doc.moveTo(summaryX, sumY + 4).lineTo(summaryX + labelW + valueW + 20, sumY + 4).strokeColor(primary).lineWidth(1).stroke();
  sumY += 12;

  line("Round-off:", roundOff);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(primary)
    .text("Grand Total (₹):", summaryX, sumY, { width: labelW, align: "right" })
    .text(money(grandTotal), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });
  sumY += 22;

  doc.font("Helvetica-Bold").fontSize(10).fillColor("black")
    .text("Amount in Words:", summaryX, sumY, { width: labelW, align: "right" });
  doc.font("Helvetica").fontSize(10)
    .text(amountInWords(grandTotal), summaryX + labelW + 5, sumY, { width: valueW + 20, align: "right" });

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
    grandTotalMedicines: grandTotal,
    taxableMedicines: taxableTotal,
    cgstMedicines: cgstTotal,
    sgstMedicines: sgstTotal,
  };
}

// ---------- Page 2: Platform Fee ----------
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
  doc.font("Helvetica-Bold").text(`Invoice Date:`, rightColX, doc.y, { continued: true }).font("Helvetica").text(` ${order.date || ""}`);

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
  doc.text(money(gross), col.amt, rowY + 6, { width: 75, align: "center" });

  rowY += 22;
  doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#F4F4F4").lineWidth(0.5).stroke();

  // Summary (base + included GST + total)
  const summaryX = 340, labelW = 170, valueW = 95;
  let sumY = rowY + 16;

  const line = (label, value) => {
    doc.font("Helvetica-Bold").fontSize(11).text(label, summaryX, sumY, { width: labelW, align: "right" });
    doc.font("Helvetica").text(money(value), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });
    sumY += 17;
  };

  line("Taxable Value (Platform Fee):", base);
  line("GST @ 18% (included):", tax);

  // Divider + total
  doc.moveTo(summaryX, sumY + 4).lineTo(summaryX + labelW + valueW + 20, sumY + 4).strokeColor(primary).lineWidth(1).stroke();
  sumY += 12;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(primary)
    .text("Platform Fee Total:", summaryX, sumY, { width: labelW, align: "right" })
    .text(money(gross), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

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
