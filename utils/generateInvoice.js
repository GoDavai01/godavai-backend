// uploads/generateInvoice.js
// Page 1: Product (pharmacy) invoice – compact table + inline Amount in Words
// Page 2: Platform Fee invoice – compact table (auto IGST when POS != Supplier state)
// Contact: support@godavaii.com

const PDFDocument = require("pdfkit");
const { classifyHSNandGST } = require("../utils/tax/taxClassifier");

// -------------------- small utils --------------------
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtINR = (n) => (r2(n)).toFixed(2);          // table cells
const money  = (n) => "INR " + (r2(n)).toFixed(2); // narrative text

function getPrintableAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  if (addr.formatted) return addr.formatted;
  if (addr.fullAddress) return addr.fullAddress;
  const main = [addr.addressLine, addr.floor, addr.area, addr.city, addr.state, addr.pincode]
    .filter(Boolean);
  if (main.length) return main.join(", ");
  const ignore = ["lat", "lng", "coordinates"];
  const rest = Object.entries(addr)
    .filter(([k, v]) => v && !ignore.includes(k) && typeof v !== "object")
    .map(([, v]) => v);
  return rest.length ? rest.join(", ") : JSON.stringify(addr);
}

// Split GST when the line price is tax-inclusive
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

// -------------------- state / POS helpers --------------------
const STATE_CODES = {
  "andhra pradesh":"37","arunachal pradesh":"12","assam":"18","bihar":"10","chhattisgarh":"22",
  "goa":"30","gujarat":"24","haryana":"06","himachal pradesh":"02","jammu and kashmir":"01",
  "jharkhand":"20","karnataka":"29","kerala":"32","madhya pradesh":"23","maharashtra":"27",
  "manipur":"14","meghalaya":"17","mizoram":"15","nagaland":"13","odisha":"21","punjab":"03",
  "rajasthan":"08","sikkim":"11","tamil nadu":"33","telangana":"36","tripura":"16",
  "uttar pradesh":"09","uttarakhand":"05","west bengal":"19","andaman and nicobar islands":"35",
  "chandigarh":"04","dadra and nagar haveli and daman and diu":"26","delhi":"07","lakshadweep":"31",
  "puducherry":"34","ladakh":"38"
};
const toLower = (s) => String(s || "").trim().toLowerCase();
const titleCase = (s) => toLower(s).split(" ").map(w => w ? w[0].toUpperCase()+w.slice(1) : "").join(" ");
function findStateName(text) {
  const s = toLower(text || "");
  for (const name of Object.keys(STATE_CODES)) if (s.includes(name)) return name;
  return "";
}
function inferState(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return findStateName(addr);
  const fields = [
    addr.state, addr.stateName, addr.region, addr.city, addr.district,
    addr.addressLine, addr.area, addr.formatted, addr.fullAddress
  ].filter(Boolean);
  for (const f of fields) {
    const hit = findStateName(f);
    if (hit) return hit;
  }
  return "";
}

// ============================================================
// Page 1: Pharmacy products (Goods => HSN)
// ============================================================
async function pageMedicines(doc, { order, pharmacy, customer }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#EAF7F2";
  const lightGrey = "#EAEAEA";

  header(doc, "Invoice for Medicine Purchase");

  // Invoice & Pharmacy Info (no overlapping: fixed widths)
  doc.moveDown(0.7).font("Helvetica").fontSize(10).fillColor("black");
  const startY = doc.y;

  // Left column (fixed width)
  const LEFT_W = 240;
  doc.font("Helvetica-Bold").text(`Invoice No:`, 40, startY, { continued: true }).font("Helvetica").text(` ${order.invoiceNo || ""}`, { width: LEFT_W });
  doc.font("Helvetica-Bold").text(`Order ID:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.orderId || ""}`, { width: LEFT_W });
  doc.font("Helvetica-Bold").text(`Invoice Date:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.date || ""}`, { width: LEFT_W });

  // Right column (separate block to avoid overlap)
  const rightColX = 320;
  let pharmacyY = startY;
  doc.font("Helvetica-Bold").text(`Pharmacy:`, rightColX, pharmacyY);
  doc.font("Helvetica").text(`${pharmacy?.name || ""}`, rightColX + 80, pharmacyY, { width: 190 });
  pharmacyY = doc.y;
  doc.font("Helvetica-Bold").text(`Address:`, rightColX, pharmacyY);
  doc.font("Helvetica").text(`${pharmacy?.address || ""}`, rightColX + 80, pharmacyY, { width: 190 });
  pharmacyY = doc.y;
  doc.font("Helvetica-Bold").text(`GSTIN:`, rightColX, pharmacyY);
  doc.font("Helvetica").text(`${pharmacy?.gstin || ""}`, rightColX + 80, pharmacyY, { width: 190 });

  // Customer (appears on both pages)
  doc.moveDown(1.2);
  doc.font("Helvetica-Bold").text(`Customer:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.customerName || customer?.name || ""}`);
  doc.font("Helvetica-Bold").text(`Address:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${getPrintableAddress(order.customerAddress || customer?.address)}`);
  if (order.customerGSTIN) {
    doc.font("Helvetica-Bold").text(`Customer GSTIN:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.customerGSTIN}`);
  }

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

  // Header (two-line labels)
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

    // CENTER align for Taxable/CGST/SGST as requested
    doc.text(fmtINR(base),      x.taxable, rowY + 6, { width: col.taxable, align: "center" });
    doc.text(cgstPct.toFixed(1),x.cgstPct, rowY + 6, { width: col.cgstPct, align: "center" });
    doc.text(fmtINR(cgstAmt),   x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "center" });
    doc.text(sgstPct.toFixed(1),x.sgstPct, rowY + 6, { width: col.sgstPct, align: "center" });
    doc.text(fmtINR(sgstAmt),   x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "center" });

    // Keep total right-aligned for readability
    doc.text(fmtINR(lineGross), x.total,   rowY + 6, { width: col.total, align: "right" });

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
  doc.rect(40, rowY, 515, 22).fill("#F7F7F7").strokeColor("#E0E0E0").lineWidth(0.5).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("black")
    .text("Item(s) Total", x.name, rowY + 6, { width: col.name + col.hsn + col.qty, align: "left" });
  doc.font("Helvetica-Bold")
    .text(fmtINR(baseSum),  x.taxable, rowY + 6, { width: col.taxable, align: "center" })
    .text(fmtINR(cgstSum),  x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "center" })
    .text(fmtINR(sgstSum),  x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "center" })
    .text(fmtINR(grossSum), x.total,   rowY + 6, { width: col.total,   align: "right" });

  rowY += 22;

  // Bottom: Amount in Words (inline, left)
  doc.moveTo(40, rowY + 8).lineTo(555, rowY + 8).strokeColor(primary).lineWidth(1).stroke();
  const words = amountInWords(grossSum);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("black")
    .text("Amount in Words: ", 40, rowY + 16, { continued: true });
  doc.font("Helvetica").fontSize(10).text(words);

  // Payment + footer
  doc.moveDown(1.2);
  if (order.paymentRef) {
    doc.font("Helvetica").fontSize(10).text(`Payment Ref: ${order.paymentRef}`);
  }
  doc.font("Helvetica").fontSize(10)
    .text(`Payment Mode: ${formatPaymentMode(order.paymentMode)}`, 40, doc.y);

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  doc.fontSize(8).fillColor("#888").font("Helvetica")
    .text("Note: This invoice page is issued by the pharmacy for medicines.", 40, 730)
    .text("GoDavaii acts as a facilitator for orders and delivery.", 40, 742)
    .text("This is a system-generated invoice and does not require a signature.", 40, 754);
  doc.fontSize(10).fillColor(primary).font("Helvetica-Bold")
    .text("Thank you for choosing GODAVAII", 40, 770, { align: "center" });
  doc.fontSize(9).fillColor("black").font("Helvetica")
    .text("www.godavaii.com | support@godavaii.com", { align: "center" });
}

// ============================================================
// Page 2: Platform Fee (Service => SAC; auto IGST based on POS)
// ============================================================
function pagePlatformFee(doc, { order, company = {}, platformFeeGross }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#EAF7F2";

  doc.addPage();
  header(doc, "Platform Fee Tax Invoice");

  // ---------- Supplier (GoDavaii) ----------
  doc.moveDown(0.7).font("Helvetica").fontSize(10).fillColor("black");
  const startY = doc.y;

  const legalName  = company.legalName || "Karniva Private Limited";
  const tradeName  = company.tradeName || "GoDavaii";
  const dispName   = `${legalName} (${tradeName})`;
  const cin        = company.cin || "";            // e.g., U12345UP2025PTCxxxxx
  const pan        = company.pan || "";            // e.g., ABCDE1234F
  const gstin      = company.gstin || "";          // e.g., 09ABCDE1234F1Z5
  const address    = company.address || "Sector 62, Noida, Uttar Pradesh";
  const email      = company.email || "support@godavaii.com";
  const phone      = company.phone || "";          // optional
  const website    = company.website || "www.godavaii.com";

  // Left block (labels)
  const LEFT_LABEL_W = 200;
  const RIGHT_VAL_W  = 315;

  let y = startY;
  doc.font("Helvetica-Bold").text("Platform (Service Provider):", 40, y, { width: LEFT_LABEL_W });
  doc.font("Helvetica").text(dispName, 40 + LEFT_LABEL_W, y, { width: RIGHT_VAL_W });
  y = doc.y;
  doc.font("Helvetica-Bold").text("Address:", 40, y, { width: LEFT_LABEL_W });
  doc.font("Helvetica").text(address, 40 + LEFT_LABEL_W, y, { width: RIGHT_VAL_W });
  y = doc.y;
  if (cin) {
    doc.font("Helvetica-Bold").text("CIN:", 40, y, { width: LEFT_LABEL_W, continued: true })
       .font("Helvetica").text(" " + cin);
    y = doc.y;
  }
  if (pan) {
    doc.font("Helvetica-Bold").text("PAN:", 40, y, { width: LEFT_LABEL_W, continued: true })
       .font("Helvetica").text(" " + pan);
    y = doc.y;
  }
  if (gstin) {
    doc.font("Helvetica-Bold").text("GSTIN:", 40, y, { width: LEFT_LABEL_W, continued: true })
       .font("Helvetica").text(" " + gstin);
    y = doc.y;
  }

  // ---------- Right: Invoice IDs & POS ----------
  const rightColX = 320;
  let ry = startY;
  doc.font("Helvetica-Bold").text(`Invoice No:`, rightColX, ry, { width: 110, continued: true })
     .font("Helvetica").text(` ${(order.invoiceNo || "")}-PF`, { width: 160 });
  doc.font("Helvetica-Bold").text(`Order ID:`, rightColX, doc.y, { width: 110, continued: true })
     .font("Helvetica").text(` ${order.orderId || ""}`, { width: 160 });
  doc.font("Helvetica-Bold").text(`Invoice Date:`, rightColX, doc.y, { width: 110, continued: true })
     .font("Helvetica").text(` ${order.date || ""}`, { width: 160 });

  // POS detection
  const supplierState = findStateName(address) || findStateName(company.state) || "uttar pradesh";
  const posState =
    findStateName(order?.deliveryAddress?.state) ||
    inferState(order?.deliveryAddress) ||
    inferState(order?.customerAddress) ||
    "uttar pradesh";

  const isInterState = (order?.isInterState !== undefined)
    ? !!order.isInterState
    : (supplierState && posState && supplierState !== posState);

  const posCode = STATE_CODES[posState] || "";
  doc.font("Helvetica-Bold").text(`Place of Supply:`, rightColX, doc.y, { width: 110, continued: true })
     .font("Helvetica").text(` ${titleCase(posState)}${posCode ? " (" + posCode + ")" : ""}`, { width: 160 });

  // Customer block (requested on Platform page too)
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").text(`Customer:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.customerName || ""}`);
  doc.font("Helvetica-Bold").text(`Customer Address:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${getPrintableAddress(order.customerAddress)}`);
  if (order.customerGSTIN) {
    doc.font("Helvetica-Bold").text(`Customer GSTIN:`, 40, doc.y, { continued: true }).font("Helvetica").text(` ${order.customerGSTIN}`);
  }

  // Section line
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  // ---------- Table ----------
  const tY = doc.y + 8;
  const headerH = 30;

  // Common measures
  const gross = Number(platformFeeGross || 0);
  const GST_RATE = 18;
  const { base: taxableBase, tax: includedTax } = splitInclusive(gross, GST_RATE);

  // Choose SAC/HSN label and code (services should be SAC)
  const useHSN = !!company.preferHSN;
  const codeLabel = useHSN ? "HSN" : "SAC";
  const codeValue = (useHSN ? (company.hsnForService || "9997") : (company.sac || "9969"));

  // Layouts WITHOUT Qty (as requested) and with "Total INR"
  if (isInterState) {
    // IGST layout: S.No | Description | SAC | Taxable INR | IGST % | IGST INR | Total INR
    const col = { sno: 30, desc: 235, code: 60, taxable: 70, igstPct: 32, igstAmt: 44, total: 44 };
    const x = {
      sno: 40,
      desc: 40 + col.sno,
      code: 40 + col.sno + col.desc,
      taxable: 40 + col.sno + col.desc + col.code,
      igstPct: 40 + col.sno + col.desc + col.code + col.taxable,
      igstAmt: 40 + col.sno + col.desc + col.code + col.taxable + col.igstPct,
      total:   40 + col.sno + col.desc + col.code + col.taxable + col.igstPct + col.igstAmt,
    };

    doc.rect(40, tY, 515, headerH).fill(tableHeaderBG).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
      .text("S.No",          x.sno,     tY + 7, { width: col.sno, align: "left" })
      .text("Description",   x.desc,    tY + 7, { width: col.desc })
      .text(codeLabel,       x.code,    tY + 7, { width: col.code, align: "center" })
      .text("Taxable\nINR",  x.taxable, tY + 5, { width: col.taxable, align: "center" })
      .text("IGST\n%",       x.igstPct, tY + 5, { width: col.igstPct, align: "center" })
      .text("IGST\nINR",     x.igstAmt, tY + 5, { width: col.igstAmt, align: "center" })
      .text("Total\nINR",    x.total,   tY + 5, { width: col.total, align: "center" });

    let rowY = tY + headerH;
    const rowH = 22;
    doc.font("Helvetica").fontSize(9).fillColor("black");
    doc.text("1", x.sno, rowY + 6, { width: col.sno });
    doc.text("Platform/Delivery Fee (tax inclusive)", x.desc, rowY + 6, { width: col.desc });
    doc.text(String(codeValue), x.code, rowY + 6, { width: col.code, align: "center" });
    doc.text(fmtINR(taxableBase), x.taxable, rowY + 6, { width: col.taxable, align: "center" });
    doc.text(GST_RATE.toFixed(1), x.igstPct, rowY + 6, { width: col.igstPct, align: "center" });
    doc.text(fmtINR(includedTax), x.igstAmt, rowY + 6, { width: col.igstAmt, align: "center" });
    doc.text(fmtINR(gross), x.total, rowY + 6, { width: col.total, align: "right" });

    rowY += rowH;
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#E0E0E0").lineWidth(0.5).stroke();
  } else {
    // CGST + SGST layout: S.No | Description | SAC | Taxable INR | CGST % | CGST INR | SGST % | SGST INR | Total INR
    const col = { sno: 30, desc: 200, code: 60, taxable: 70, cgstPct: 32, cgstAmt: 44, sgstPct: 32, sgstAmt: 44, total: 43 };
    const x = {
      sno: 40,
      desc: 40 + col.sno,
      code: 40 + col.sno + col.desc,
      taxable: 40 + col.sno + col.desc + col.code,
      cgstPct: 40 + col.sno + col.desc + col.code + col.taxable,
      cgstAmt: 40 + col.sno + col.desc + col.code + col.taxable + col.cgstPct,
      sgstPct: 40 + col.sno + col.desc + col.code + col.taxable + col.cgstPct + col.cgstAmt,
      sgstAmt: 40 + col.sno + col.desc + col.code + col.taxable + col.cgstPct + col.cgstAmt + col.sgstPct,
      total:   40 + col.sno + col.desc + col.code + col.taxable + col.cgstPct + col.cgstAmt + col.sgstPct + col.sgstAmt,
    };

    doc.rect(40, tY, 515, headerH).fill(tableHeaderBG).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
      .text("S.No",          x.sno,     tY + 7, { width: col.sno, align: "left" })
      .text("Description",   x.desc,    tY + 7, { width: col.desc })
      .text(codeLabel,       x.code,    tY + 7, { width: col.code, align: "center" })
      .text("Taxable\nINR",  x.taxable, tY + 5, { width: col.taxable, align: "center" })
      .text("CGST\n%",       x.cgstPct, tY + 5, { width: col.cgstPct, align: "center" })
      .text("CGST\nINR",     x.cgstAmt, tY + 5, { width: col.cgstAmt, align: "center" })
      .text("SGST\n%",       x.sgstPct, tY + 5, { width: col.sgstPct, align: "center" })
      .text("SGST\nINR",     x.sgstAmt, tY + 5, { width: col.sgstAmt, align: "center" })
      .text("Total\nINR",    x.total,   tY + 5, { width: col.total, align: "center" });

    const halfTax = includedTax / 2;

    let rowY = tY + headerH;
    const rowH = 22;
    doc.font("Helvetica").fontSize(9).fillColor("black");
    doc.text("1", x.sno, rowY + 6, { width: col.sno });
    doc.text("Platform/Delivery Fee (tax inclusive)", x.desc, rowY + 6, { width: col.desc });
    doc.text(String(codeValue), x.code, rowY + 6, { width: col.code, align: "center" });
    doc.text(fmtINR(taxableBase), x.taxable, rowY + 6, { width: col.taxable, align: "center" });
    doc.text((GST_RATE/2).toFixed(1), x.cgstPct, rowY + 6, { width: col.cgstPct, align: "center" });
    doc.text(fmtINR(halfTax), x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "center" });
    doc.text((GST_RATE/2).toFixed(1), x.sgstPct, rowY + 6, { width: col.sgstPct, align: "center" });
    doc.text(fmtINR(halfTax), x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "center" });
    doc.text(fmtINR(gross), x.total, rowY + 6, { width: col.total, align: "right" });

    rowY += rowH;
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#E0E0E0").lineWidth(0.5).stroke();
  }

  // Notes line (regulatory niceties)
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(9)
    .text("Tax is charged on a tax-inclusive basis. Reverse Charge: No.", 40, doc.y);

  // Payment + footer
  doc.moveDown(0.6);
  if (order.paymentRef) {
    doc.font("Helvetica").fontSize(10).text(`Payment Ref: ${order.paymentRef}`);
  }
  doc.font("Helvetica").fontSize(10)
    .text(`Payment Mode: ${formatPaymentMode(order.paymentMode)}`, 40, doc.y);

  // Contact/footer with compliance
  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  const contactLine = [website, email, phone].filter(Boolean).join(" | ");
  doc.fontSize(8).fillColor("#888").font("Helvetica")
    .text("Note: This invoice page is issued by GoDavaii for platform/service fee.", 40, 730)
    .text("For medicines, please refer to the previous page issued by the pharmacy.", 40, 742)
    .text("This is a system-generated invoice and does not require a signature.", 40, 754);
  if (contactLine) doc.fontSize(9).fillColor("black").text(contactLine, 40, 768, { align: "center" });
  doc.fontSize(10).fillColor(primary).font("Helvetica-Bold")
    .text("Thank you for choosing GODAVAII", 40, 784, { align: "center" });
}

// ============================================================
// Main
// ============================================================
async function generateInvoice({ order = {}, pharmacy = {}, customer = {}, company = {}, platformFeeGross = 0 }) {
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
