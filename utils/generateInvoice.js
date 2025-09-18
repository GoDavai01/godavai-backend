// uploads/generateInvoice.js
// Page 1: Pharmacy invoice (compact table with "Item(s) Total" final row)
// Page 2: Platform Fee invoice (18% tax-inclusive)
// Footer contact shows email (support@godavaii.com)

const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
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

let CURRENCY_SYMBOL = "Rs.";
const money = (n) => CURRENCY_SYMBOL + r2(n).toFixed(2);

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

function setupFonts(doc) {
  // Try to use Noto Sans (has ₹); else fallback to Helvetica and use "Rs."
  try {
    const regular = path.join(__dirname, "fonts", "NotoSans-Regular.ttf");
    const bold = path.join(__dirname, "fonts", "NotoSans-Bold.ttf");
    if (fs.existsSync(regular) && fs.existsSync(bold)) {
      doc.registerFont("Body", regular);
      doc.registerFont("Bold", bold);
      CURRENCY_SYMBOL = "₹";
    } else {
      doc.registerFont("Body", "Helvetica");
      doc.registerFont("Bold", "Helvetica-Bold");
      CURRENCY_SYMBOL = "Rs.";
    }
  } catch {
    doc.registerFont("Body", "Helvetica");
    doc.registerFont("Bold", "Helvetica-Bold");
    CURRENCY_SYMBOL = "Rs.";
  }
}

function header(doc, subtitleLeft) {
  const primary = "#13C0A2";
  const lightGrey = "#F4F4F4";
  doc.font("Bold").fontSize(22).fillColor(primary).text("GODAVAII", { align: "left" });
  if (subtitleLeft) {
    doc.moveDown(0.2);
    doc.font("Body").fontSize(12).fillColor("black").text(subtitleLeft, { align: "left" });
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
  doc.moveDown(0.7).font("Body").fontSize(10).fillColor("black");
  const startY = doc.y;

  // Left column
  doc.font("Bold").text(`Invoice No:`, 40, startY, { continued: true }).font("Body").text(` ${order.invoiceNo || ""}`);
  doc.font("Bold").text(`Order ID:`, 40, doc.y, { continued: true }).font("Body").text(` ${order.orderId || ""}`);
  doc.font("Bold").text(`Invoice Date:`, 40, doc.y, { continued: true }).font("Body").text(` ${order.date || ""}`);

  // Right column
  const rightColX = 320;
  let pharmacyY = startY;
  doc.font("Bold").text(`Pharmacy:`, rightColX, pharmacyY);
  doc.font("Body").text(`${pharmacy?.name || ""}`, rightColX + 80, pharmacyY);
  pharmacyY = doc.y;
  doc.font("Bold").text(`Address:`, rightColX, pharmacyY);
  doc.font("Body").text(`${pharmacy?.address || ""}`, rightColX + 80, pharmacyY);
  pharmacyY = doc.y;
  doc.font("Bold").text(`GSTIN:`, rightColX, pharmacyY);
  doc.font("Body").text(`${pharmacy?.gstin || ""}`, rightColX + 80, pharmacyY);

  // Customer
  doc.moveDown(1.2);
  doc.font("Bold").text(`Customer:`, 40, doc.y, { continued: true }).font("Body").text(` ${order.customerName || customer?.name || ""}`);
  doc.font("Bold").text(`Address:`, 40, doc.y, { continued: true }).font("Body").text(` ${getPrintableAddress(order.customerAddress || customer?.address)}`);

  // Table header line
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  const tableY = doc.y + 8;

  // Column widths that sum to 515px (fit between margins)
  // S.No(30) | Name(170) | HSN(44) | Qty(28) | Taxable₹(58) | CGST%(32) | CGST₹(42) | SGST%(32) | SGST₹(42) | Total₹(37)  = 515
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

  // Header row (taller to avoid text touching edges)
  const headerH = 26;
  doc.rect(40, tableY, 515, headerH).fill(tableHeaderBG).stroke();
  doc.font("Bold").fontSize(9).fillColor(primary)
    .text("S.No",      x.sno,     tableY + 7, { width: col.sno, align: "left" })
    .text("Medicine",  x.name,    tableY + 7, { width: col.name })
    .text("HSN",       x.hsn,     tableY + 7, { width: col.hsn, align: "center" })
    .text("Qty",       x.qty,     tableY + 7, { width: col.qty, align: "center" })
    .text("Taxable ₹", x.taxable, tableY + 7, { width: col.taxable, align: "right" })
    .text("CGST %",    x.cgstPct, tableY + 7, { width: col.cgstPct, align: "center" })
    .text("CGST ₹",    x.cgstAmt, tableY + 7, { width: col.cgstAmt, align: "right" })
    .text("SGST %",    x.sgstPct, tableY + 7, { width: col.sgstPct, align: "center" })
    .text("SGST ₹",    x.sgstAmt, tableY + 7, { width: col.sgstAmt, align: "right" })
    .text("Total ₹",   x.total,   tableY + 7, { width: col.total, align: "right" });

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
  let grandIGST = 0;

  let rowY = tableY + headerH;
  const rowH = 22;
  doc.font("Body").fontSize(9).fillColor("black");

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

    // Render row
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
      doc.rect(40, rowY, 515, headerH).fill(tableHeaderBG).stroke();
      doc.font("Bold").fontSize(9).fillColor(primary)
        .text("S.No",      x.sno,     rowY + 7, { width: col.sno, align: "left" })
        .text("Medicine",  x.name,    rowY + 7, { width: col.name })
        .text("HSN",       x.hsn,     rowY + 7, { width: col.hsn, align: "center" })
        .text("Qty",       x.qty,     rowY + 7, { width: col.qty, align: "center" })
        .text("Taxable ₹", x.taxable, rowY + 7, { width: col.taxable, align: "right" })
        .text("CGST %",    x.cgstPct, rowY + 7, { width: col.cgstPct, align: "center" })
        .text("CGST ₹",    x.cgstAmt, rowY + 7, { width: col.cgstAmt, align: "right" })
        .text("SGST %",    x.sgstPct, rowY + 7, { width: col.sgstPct, align: "center" })
        .text("SGST ₹",    x.sgstAmt, rowY + 7, { width: col.sgstAmt, align: "right" })
        .text("Total ₹",   x.total,   rowY + 7, { width: col.total, align: "right" });
      rowY += headerH;
    }
  }

  // --- "Item(s) Total" final row inside the table ---
  // Totals
  const taxableTotal = r2(grandBase);
  const cgstTotal    = r2(grandCGST);
  const sgstTotal    = r2(grandSGST);
  const igstTotal    = r2(grandIGST);
  const gross        = r2(taxableTotal + cgstTotal + sgstTotal + igstTotal);
  const rounded      = Math.round(gross);
  const roundOff     = r2(rounded - gross);
  const grandTotal   = r2(gross + roundOff);

  // If the last row is too low, push to next page before totals row
  if (rowY > 680) {
    doc.addPage();
    header(doc, "Medicines (contd.)");
    rowY = doc.y + 16;
  }

  // Background bar for totals row
  doc.rect(40, rowY, 515, rowH).fill("#F7F7F7").strokeColor("#E0E0E0").lineWidth(0.5).stroke();
  doc.font("Bold").fontSize(9).fillColor("black")
    .text("Item(s) Total", x.name, rowY + 6, { width: col.name + col.hsn + col.qty, align: "left" });
  doc.font("Bold")
    .text(r2(taxableTotal).toFixed(2), x.taxable, rowY + 6, { width: col.taxable, align: "right" })
    .text(r2(cgstTotal).toFixed(2),    x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "right" })
    .text(r2(sgstTotal).toFixed(2),    x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "right" })
    .text(r2(grandGross).toFixed(2),   x.total,   rowY + 6, { width: col.total,   align: "right" });

  rowY += rowH;

  // --- Bottom area: Amount in Words (left) + Round-off & Grand Total (right) ---
  // Divider line
  doc.moveTo(40, rowY + 8).lineTo(555, rowY + 8).strokeColor(primary).lineWidth(1).stroke();

  // Left: Amount in words
  doc.font("Bold").fontSize(10).fillColor("black")
    .text("Amount in Words:", 40, rowY + 16, { width: 200, align: "left" });
  doc.font("Body").fontSize(10)
    .text(amountInWords(grandTotal), 40, rowY + 16, { width: 280, align: "left", continued: false });

  // Right: Round-off + Grand Total
  const rightX = 320, labelW = 200, valueW = 95;
  doc.font("Bold").fontSize(11)
    .text("Round-off:", rightX, rowY + 14, { width: labelW, align: "right" });
  doc.font("Body").text(money(roundOff), rightX + labelW + 5, rowY + 14, { width: valueW, align: "right" });
  doc.font("Bold").fontSize(13).fillColor(primary)
    .text("Grand Total (₹):", rightX, rowY + 34, { width: labelW, align: "right" });
  doc.font("Bold").fillColor(primary)
    .text(money(grandTotal), rightX + labelW + 5, rowY + 34, { width: valueW, align: "right" });

  // Payment + footer
  doc.moveDown(2.0);
  doc.font("Body").fontSize(10).fillColor("black")
    .text(`Payment Mode: ${order.paymentMode || ""}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  doc.fontSize(8).font("Body").fillColor("#888")
    .text("Note: This invoice page is issued by the pharmacy for medicines.", 40, 730)
    .text("GoDavaii acts as a facilitator for orders and delivery.", 40, 742);

  doc.fontSize(10).fillColor(primary).font("Bold")
    .text("Thank you for choosing GODAVAII", 40, 760, { align: "center" });
  doc.fontSize(9).fillColor("black").font("Body")
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
  doc.moveDown(0.7).font("Body").fontSize(10).fillColor("black");
  const startY = doc.y;
  doc.font("Bold").text(`Platform (Service Provider):`, 40, startY);
  doc.font("Body")
    .text(`${company?.name || "Karniva Private Limited (GoDavaii)"}`, 220, startY)
    .text(`${company?.address || "Sector 62, Noida, Uttar Pradesh"}`, 220, doc.y);
  doc.font("Bold").text(`GSTIN:`, 40, doc.y, { continued: true }).font("Body").text(` ${company?.gstin || ""}`);

  // Right: IDs & dates
  const rightColX = 320;
  let y = startY;
  doc.font("Bold").text(`Invoice No:`, rightColX, y, { continued: true }).font("Body").text(` ${order.invoiceNo || ""}-PF`);
  doc.font("Bold").text(`Order ID:`, rightColX, doc.y, { continued: true }).font("Body").text(` ${order.orderId || ""}`);
  doc.font("Bold").text(`Invoice Date:`, rightColX, doc.y, { continued: true }).font("Body").text(` ${order.date || ""}`);

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
  doc.font("Bold").fontSize(10).fillColor(primary)
    .text("S.No", col.sno, tY + 6, { width: 35 })
    .text("Description", col.desc, tY + 6, { width: 300 })
    .text("GST %", col.gst, tY + 6, { width: 50, align: "center" })
    .text("Amount (Incl. GST)", col.amt, tY + 6, { width: 75, align: "center" });

  // Row
  let rowY = tY + 22;
  doc.font("Body").fontSize(10).fillColor("black");
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
    doc.font("Bold").fontSize(11).text(label, summaryX, sumY, { width: labelW, align: "right" });
    doc.font("Body").text(money(value), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });
    sumY += 17;
  };

  line("Taxable Value (Platform Fee):", base);
  line("GST @ 18% (included):", tax);

  // Divider + total
  doc.moveTo(summaryX, sumY + 4).lineTo(summaryX + labelW + valueW + 20, sumY + 4).strokeColor(primary).lineWidth(1).stroke();
  sumY += 12;
  doc.font("Bold").fontSize(13).fillColor(primary)
    .text("Platform Fee Total:", summaryX, sumY, { width: labelW, align: "right" })
    .text(money(gross), summaryX + labelW + 5, sumY, { width: valueW, align: "right" });

  // Payment + footer
  doc.moveDown(1.0);
  doc.font("Body").fontSize(10).fillColor("black")
    .text(`Payment Mode: ${order.paymentMode || ""}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  doc.fontSize(8).fillColor("#888").font("Body")
    .text("Note: This invoice page is issued by GoDavaii for platform/service fee.", 40, 730)
    .text("For medicines, please refer to the previous page issued by the pharmacy.", 40, 742);

  doc.fontSize(10).fillColor(primary).font("Bold")
    .text("Thank you for choosing GODAVAII", 40, 760, { align: "center" });
  doc.fontSize(9).fillColor("black").font("Body")
    .text("www.godavaii.com | support@godavaii.com", { align: "center" });
}

// ---------- Main ----------
async function generateInvoice({ order, pharmacy, customer, company, platformFeeGross }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  setupFonts(doc); // ensure rupee glyph / sensible fallback

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
