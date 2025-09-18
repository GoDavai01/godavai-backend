// uploads/generateInvoice.js
// Page 1: Product (pharmacy) invoice – compact table + inline Amount in Words
// Page 2: Platform Fee invoice – compact table (no extra summary box)
// Contact: support@godavaii.com

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
const fmtINR = (n) => (r2(n)).toFixed(2);          // table cells
const money  = (n) => "INR " + (r2(n)).toFixed(2); // narrative text

function splitInclusive(lineTotal, ratePct) {
  const denom = 1 + (ratePct || 0) / 100;
  const base = lineTotal / denom;
  const tax = lineTotal - base;
  return { base, tax };
}

// Amount in words (Indian numbering; rupees only)
function amountInWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return "Zero Rupees Only";
  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const tw = (n,s)=>n?(n<20?a[n]:b[Math.floor(n/10)]+(n%10?" "+a[n%10]:""))+(s?" "+s:""):"";
  const c = Math.floor(num/1e7), l = Math.floor((num/1e5)%100), t = Math.floor((num/1e3)%100), h = Math.floor((num/100)%10), r = Math.floor(num%100);
  let s = "";
  s += tw(c,"Crore");
  s += (s&&l?" ":"")+tw(l,"Lakh");
  s += (s&&t?" ":"")+tw(t,"Thousand");
  s += (s&&h?" ":"")+(h? a[h]+" Hundred":"");
  if (r) s += (s?" and ":"")+tw(r,"");
  return s+" Rupees Only";
}

function header(doc, subtitleLeft) {
  const primary = "#13C0A2";
  const lightGrey = "#F1F1F1";
  doc.font("Helvetica-Bold").fontSize(22).fillColor(primary).text("GODAVAII", { align: "left" });
  if (subtitleLeft) {
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(12).fillColor("black").text(subtitleLeft, { align: "left" });
  }
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(lightGrey).lineWidth(1).stroke();
}

function formatPaymentMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (["cod","cash_on_delivery","cash on delivery"].includes(m)) return "CASH ON DELIVERY";
  if (m.includes("upi")) return "UPI";
  if (["card","cards","debit","credit"].includes(m)) return "CARD";
  if (["netbanking","net_banking","nb"].includes(m)) return "NET BANKING";
  return m ? m.toUpperCase() : "";
}

// ---------- Page 1: Pharmacy products ----------
async function pageMedicines(doc, { order, pharmacy, customer }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#EAF7F2";
  const lightGrey = "#EAEAEA";

  header(doc, "Invoice for Medicine Purchase");

  // Invoice & Pharmacy Info
  doc.moveDown(0.7).font("Helvetica").fontSize(10).fillColor("black");
  const startY = doc.y;

  // Left
  doc.font("Helvetica-Bold").text(`Invoice No:`, 40, startY, { continued: true }).font("Helvetica").text(` ${order.invoiceNo || ""}`);
  doc.font("Helvetica-Bold").text(`Order ID:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.orderId || ""}`);
  doc.font("Helvetica-Bold").text(`Invoice Date:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.date || ""}`);

  // Right
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
  doc.font("Helvetica-Bold").text(`Customer:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.customerName || customer?.name || ""}`);
  doc.font("Helvetica-Bold").text(`Address:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${getPrintableAddress(order.customerAddress || customer?.address)}`);

  // Table header rule
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  const tableY = doc.y + 8;

  // Column widths (sum = 515)
  // S.No(30) | Product(170) | HSN(44) | Qty(28) | Taxable INR(60) | CGST %(32) | CGST INR(44) | SGST %(32) | SGST INR(44) | Total INR(31)
  const col = {
    sno: 30, name: 170, hsn: 44, qty: 28, taxable: 60,
    cgstPct: 32, cgstAmt: 44, sgstPct: 32, sgstAmt: 44, total: 31, x: 40,
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

  // Header (two-line labels for INR and %)
  const headerH = 28;
  doc.rect(40, tableY, 515, headerH).fill(tableHeaderBG).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
    .text("S.No",        x.sno,     tableY + 6, { width: col.sno,   align: "left" })
    .text("Product",     x.name,    tableY + 6, { width: col.name })
    .text("HSN",         x.hsn,     tableY + 6, { width: col.hsn,   align: "center" })
    .text("Qty",         x.qty,     tableY + 6, { width: col.qty,   align: "center" })
    .text("Taxable\nINR",x.taxable, tableY + 4, { width: col.taxable, align: "center" })
    .text("CGST\n%",     x.cgstPct, tableY + 4, { width: col.cgstPct, align: "center" })
    .text("CGST\nINR",   x.cgstAmt, tableY + 4, { width: col.cgstAmt, align: "center" })
    .text("SGST\n%",     x.sgstPct, tableY + 4, { width: col.sgstPct, align: "center" })
    .text("SGST\nINR",   x.sgstAmt, tableY + 4, { width: col.sgstAmt, align: "center" })
    .text("Total\nINR",  x.total,   tableY + 4, { width: col.total, align: "center" });

  // Classify items
  const items = Array.isArray(order.items) ? order.items : [];
  const cls = await Promise.all(items.map(async (it) => { try { return await classifyHSNandGST(it); } catch { return null; } }));

  // Totals
  let grossSum = 0, baseSum = 0, cgstSum = 0, sgstSum = 0;

  let rowY = tableY + headerH;
  const rowH = 22;
  doc.font("Helvetica").fontSize(9).fillColor("black");

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const qty = Number(it.quantity || 0);
    const unitGross = Number(it.price || 0);
    const rate = Number((cls[i] && cls[i].gstRate) ?? it.gstRate ?? 12);

    const lineGross = qty * unitGross;
    const { base, tax } = splitInclusive(lineGross, rate);
    const cgstPct = rate / 2, sgstPct = rate / 2;
    const cgstAmt = tax / 2,  sgstAmt = tax / 2;

    grossSum += lineGross; baseSum += base; cgstSum += cgstAmt; sgstSum += sgstAmt;

    doc.text(String(i + 1), x.sno, rowY + 6, { width: col.sno });
    doc.text((it.name || ""), x.name, rowY + 6, { width: col.name });
    doc.text((cls[i]?.hsn ? String(cls[i].hsn) : (it.hsn || "")), x.hsn, rowY + 6, { width: col.hsn, align: "center" });
    doc.text(qty || "", x.qty, rowY + 6, { width: col.qty, align: "center" });
    doc.text(fmtINR(base), x.taxable, rowY + 6, { width: col.taxable, align: "right" });
    doc.text(cgstPct.toFixed(1), x.cgstPct, rowY + 6, { width: col.cgstPct, align: "center" });
    doc.text(fmtINR(cgstAmt), x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "right" });
    doc.text(sgstPct.toFixed(1), x.sgstPct, rowY + 6, { width: col.sgstPct, align: "center" });
    doc.text(fmtINR(sgstAmt), x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "right" });
    doc.text(fmtINR(lineGross), x.total, rowY + 6, { width: col.total, align: "right" });

    rowY += rowH;
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor(lightGrey).lineWidth(0.5).stroke();

    if (rowY > 680) {
      doc.addPage(); header(doc, "Medicines (contd.)"); rowY = doc.y + 16;
      doc.rect(40, rowY, 515, headerH).fill(tableHeaderBG).stroke();
      doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
        .text("S.No", x.sno, rowY + 6, { width: col.sno })
        .text("Product", x.name, rowY + 6, { width: col.name })
        .text("HSN", x.hsn, rowY + 6, { width: col.hsn, align: "center" })
        .text("Qty", x.qty, rowY + 6, { width: col.qty, align: "center" })
        .text("Taxable\nINR", x.taxable, rowY + 4, { width: col.taxable, align: "center" })
        .text("CGST\n%", x.cgstPct, rowY + 4, { width: col.cgstPct, align: "center" })
        .text("CGST\nINR", x.cgstAmt, rowY + 4, { width: col.cgstAmt, align: "center" })
        .text("SGST\n%", x.sgstPct, rowY + 4, { width: col.sgstPct, align: "center" })
        .text("SGST\nINR", x.sgstAmt, rowY + 4, { width: col.sgstAmt, align: "center" })
        .text("Total\nINR", x.total, rowY + 4, { width: col.total, align: "center" });
      rowY += headerH;
    }
  }

  // Item(s) Total row
  if (rowY > 680) { doc.addPage(); header(doc, "Medicines (contd.)"); rowY = doc.y + 16; }
  doc.rect(40, rowY, 515, rowH).fill("#F7F7F7").strokeColor("#E0E0E0").lineWidth(0.5).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("black")
    .text("Item(s) Total", x.name, rowY + 6, { width: col.name + col.hsn + col.qty, align: "left" });
  doc.font("Helvetica-Bold")
    .text(fmtINR(baseSum),  x.taxable, rowY + 6, { width: col.taxable, align: "right" })
    .text(fmtINR(cgstSum),  x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "right" })
    .text(fmtINR(sgstSum),  x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "right" })
    .text(fmtINR(grossSum), x.total,   rowY + 6, { width: col.total,   align: "right" });

  rowY += rowH;

  // Bottom: Amount in Words (inline, left)
  doc.moveTo(40, rowY + 8).lineTo(555, rowY + 8).strokeColor(primary).lineWidth(1).stroke();
  const words = amountInWords(grossSum);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("black")
    .text("Amount in Words: ", 40, rowY + 16, { continued: true });
  doc.font("Helvetica").fontSize(10).text(words);

  // Payment + footer
  doc.moveDown(1.8);
  doc.font("Helvetica").fontSize(10).fillColor("black")
    .text(`Payment Mode: ${formatPaymentMode(order.paymentMode)}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  doc.fontSize(8).fillColor("#888").font("Helvetica")
    .text("Note: This invoice page is issued by the pharmacy for medicines.", 40, 730)
    .text("GoDavaii acts as a facilitator for orders and delivery.", 40, 742);
  doc.fontSize(10).fillColor(primary).font("Helvetica-Bold")
    .text("Thank you for choosing GODAVAII", 40, 760, { align: "center" });
  doc.fontSize(9).fillColor("black").font("Helvetica")
    .text("www.godavaii.com | support@godavaii.com", { align: "center" });
}

// ---------- Page 2: Platform Fee (compact box) ----------
function pagePlatformFee(doc, { order, company, platformFeeGross }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#EAF7F2";

  doc.addPage();
  header(doc, "Platform Fee Tax Invoice");

  // Left: Company (service provider)
  doc.moveDown(0.7).font("Helvetica").fontSize(10).fillColor("black");
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

  // Table header (S.No | Description | HSN (SAC) | Qty | Taxable INR | CGST % | CGST INR | SGST % | SGST INR | Line Total INR)
  const tY = doc.y + 8;
  const col = {
    sno: 30, desc: 190, hsn: 60, qty: 28, taxable: 60, cgstPct: 32, cgstAmt: 44, sgstPct: 32, sgstAmt: 44, total: 35
  };
  const x = {
    sno: 40,
    desc: 40 + col.sno,
    hsn: 40 + col.sno + col.desc,
    qty: 40 + col.sno + col.desc + col.hsn,
    taxable: 40 + col.sno + col.desc + col.hsn + col.qty,
    cgstPct: 40 + col.sno + col.desc + col.hsn + col.qty + col.taxable,
    cgstAmt: 40 + col.sno + col.desc + col.hsn + col.qty + col.taxable + col.cgstPct,
    sgstPct: 40 + col.sno + col.desc + col.hsn + col.qty + col.taxable + col.cgstPct + col.cgstAmt,
    sgstAmt: 40 + col.sno + col.desc + col.hsn + col.qty + col.taxable + col.cgstPct + col.cgstAmt + col.sgstPct,
    total:   40 + col.sno + col.desc + col.hsn + col.qty + col.taxable + col.cgstPct + col.cgstAmt + col.sgstPct + col.sgstAmt,
  };

  const headerH = 28;
  doc.rect(40, tY, 515, headerH).fill(tableHeaderBG).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
    .text("S.No",          x.sno,     tY + 6, { width: col.sno })
    .text("Description",   x.desc,    tY + 6, { width: col.desc })
    .text("HSN (SAC)",     x.hsn,     tY + 6, { width: col.hsn, align: "center" })
    .text("Qty",           x.qty,     tY + 6, { width: col.qty, align: "center" })
    .text("Taxable\nINR",  x.taxable, tY + 4, { width: col.taxable, align: "center" })
    .text("CGST\n%",       x.cgstPct, tY + 4, { width: col.cgstPct, align: "center" })
    .text("CGST\nINR",     x.cgstAmt, tY + 4, { width: col.cgstAmt, align: "center" })
    .text("SGST\n%",       x.sgstPct, tY + 4, { width: col.sgstPct, align: "center" })
    .text("SGST\nINR",     x.sgstAmt, tY + 4, { width: col.sgstAmt, align: "center" })
    .text("Line Total\nINR", x.total, tY + 4, { width: col.total, align: "center" });

  // Row (assume intra-state by default → CGST+SGST; set order.isInterState = true to switch to IGST)
  const gross = Number(platformFeeGross || 0);
  const GST_RATE = 18;
  const { base, tax } = splitInclusive(gross, GST_RATE);
  const isInterState = !!order?.isInterState;

  const cgstPct = isInterState ? 0 : GST_RATE / 2;
  const sgstPct = isInterState ? 0 : GST_RATE / 2;
  const cgstAmt = isInterState ? 0 : tax / 2;
  const sgstAmt = isInterState ? 0 : tax / 2;

  let rowY = tY + headerH;
  const rowH = 22;
  doc.font("Helvetica").fontSize(9).fillColor("black");
  doc.text("1", x.sno, rowY + 6, { width: col.sno });
  doc.text("Platform/Delivery Fee", x.desc, rowY + 6, { width: col.desc });
  doc.text("9969", x.hsn, rowY + 6, { width: col.hsn, align: "center" }); // 9969 covers other support services; change if you classify differently
  doc.text("1", x.qty, rowY + 6, { width: col.qty, align: "center" });
  doc.text(fmtINR(base), x.taxable, rowY + 6, { width: col.taxable, align: "right" });
  doc.text(cgstPct.toFixed(1), x.cgstPct, rowY + 6, { width: col.cgstPct, align: "center" });
  doc.text(fmtINR(cgstAmt), x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "right" });
  doc.text(sgstPct.toFixed(1), x.sgstPct, rowY + 6, { width: col.sgstPct, align: "center" });
  doc.text(fmtINR(sgstAmt), x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "right" });
  doc.text(fmtINR(gross), x.total, rowY + 6, { width: col.total, align: "right" });

  // underline
  rowY += rowH;
  doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#E0E0E0").lineWidth(0.5).stroke();

  // Payment + footer
  doc.moveDown(1.0);
  doc.font("Helvetica").fontSize(10).fillColor("black")
    .text(`Payment Mode: ${formatPaymentMode(order.paymentMode)}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  doc.fontSize(8).fillColor("#888").font("Helvetica")
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
