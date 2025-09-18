// uploads/generateInvoice.js
// Page 1: Product (pharmacy) invoice – compact table + inline Amount in Words
// Page 2: Platform Fee invoice – compact table (auto IGST when POS != Supplier state), with signature
// Contact: support@godavaii.com

const PDFDocument = require("pdfkit");
const { classifyHSNandGST } = require("../utils/tax/taxClassifier");

// -------------------- small utils --------------------
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtINR = (n) => (r2(n)).toFixed(2);
const money  = (n) => "INR " + (r2(n)).toFixed(2);

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

// GST split for tax-inclusive amounts
function splitInclusive(lineTotal, ratePct) {
  const denom = 1 + (ratePct || 0) / 100;
  const base = lineTotal / denom;
  const tax = lineTotal - base;
  return { base, tax };
}

// Amount in words (Indian numbering)
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

// ------- layout helpers (prevent overlap) -------
function drawKV(doc, {x, y, label, value, labelW, colW, gapY = 3}) {
  const valX = x + labelW;
  const valW = Math.max(20, colW - labelW);
  const lh = doc.heightOfString(label || "", { width: labelW });
  const vh = doc.heightOfString(String(value || ""), { width: valW });
  const h = Math.max(lh, vh);
  doc.font("Helvetica-Bold").text(label || "", x, y, { width: labelW });
  doc.font("Helvetica").text(String(value || ""), valX, y, { width: valW });
  return y + h + gapY;
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

  doc.moveDown(0.7).font("Helvetica").fontSize(10).fillColor("black");
  const startY = doc.y;

  const leftBox = { x: 40, w: 260, labelW: 120 };
  const rightBox = { x: 320, w: 235, labelW: 90 };

  // left column (stacked with measured heights)
  let yL = startY;
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Invoice No:",   value: order.invoiceNo || "", labelW:leftBox.labelW, colW:leftBox.w });
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Order ID:",     value: order.orderId   || "", labelW:leftBox.labelW, colW:leftBox.w });
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Invoice Date:", value: order.date      || "", labelW:leftBox.labelW, colW:leftBox.w });

  // right column (pharmacy block)
  let yR = startY;
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Pharmacy:", value: (pharmacy?.name || ""),    labelW:rightBox.labelW, colW:rightBox.w });
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Address:",  value: (pharmacy?.address || ""), labelW:rightBox.labelW, colW:rightBox.w });
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"GSTIN:",    value: (pharmacy?.gstin || ""),   labelW:rightBox.labelW, colW:rightBox.w });

  // next section starts after the taller column
  let curY = Math.max(yL, yR) + 6;

  // Customer (consistent spacing using drawKV)
  const custLabelW = 120;
  curY = drawKV(doc, { x:40, y:curY, label:"Customer:", value:(order.customerName || customer?.name || ""), labelW:custLabelW, colW:515, gapY:4 });
  curY = drawKV(doc, { x:40, y:curY, label:"Address:",  value:getPrintableAddress(order.customerAddress || customer?.address), labelW:custLabelW, colW:515, gapY:6 });
  if (order.customerGSTIN || customer?.gstin) {
    curY = drawKV(doc, { x:40, y:curY, label:"Customer GSTIN:", value:(order.customerGSTIN || customer?.gstin), labelW:custLabelW, colW:515, gapY:6 });
  }

  // rule
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();
  const tableY = doc.y + 8;

  // Columns (sum=515)
  const col = {
    sno: 30, name: 170, hsn: 44, qty: 28, taxable: 60, cgstPct: 32, cgstAmt: 44, sgstPct: 32, sgstAmt: 44, total: 31, x: 40,
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

  // Header
  const headerH = 28;
  doc.rect(40, tableY, 515, headerH).fill(tableHeaderBG).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
    .text("S.No",        x.sno,     tableY + 6, { width: col.sno, align: "left" })
    .text("Product",     x.name,    tableY + 6, { width: col.name })
    .text("HSN",         x.hsn,     tableY + 6, { width: col.hsn, align: "center" })
    .text("Qty",         x.qty,     tableY + 6, { width: col.qty, align: "center" })
    .text("Taxable\nINR",x.taxable, tableY + 4, { width: col.taxable, align: "center" })
    .text("CGST\n%",     x.cgstPct, tableY + 4, { width: col.cgstPct, align: "center" })
    .text("CGST\nINR",   x.cgstAmt, tableY + 4, { width: col.cgstAmt, align: "center" })
    .text("SGST\n%",     x.sgstPct, tableY + 4, { width: col.sgstPct, align: "center" })
    .text("SGST\nINR",   x.sgstAmt, tableY + 4, { width: col.sgstAmt, align: "center" })
    .text("Total\nINR",  x.total,   tableY + 4, { width: col.total, align: "center" });

  const items = Array.isArray(order.items) ? order.items : [];
  const cls = await Promise.all(items.map(async (it) => { try { return await classifyHSNandGST(it); } catch { return null; } }));

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
    doc.text(fmtINR(base),       x.taxable, rowY + 6, { width: col.taxable, align: "center" });
    doc.text(cgstPct.toFixed(1), x.cgstPct, rowY + 6, { width: col.cgstPct, align: "center" });
    doc.text(fmtINR(cgstAmt),    x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "center" });
    doc.text(sgstPct.toFixed(1), x.sgstPct, rowY + 6, { width: col.sgstPct, align: "center" });
    doc.text(fmtINR(sgstAmt),    x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "center" });
    doc.text(fmtINR(lineGross),  x.total,   rowY + 6, { width: col.total, align: "right" });

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

  // totals
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

  // Amount in Words
  doc.moveTo(40, rowY + 8).lineTo(555, rowY + 8).strokeColor(primary).lineWidth(1).stroke();
  const words = amountInWords(grossSum);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("black")
    .text("Amount in Words: ", 40, rowY + 16, { continued: true });
  doc.font("Helvetica").fontSize(10).text(words);

  // Payment
  doc.moveDown(1.2);
  if (order.paymentRef) doc.font("Helvetica").fontSize(10).text(`Payment Ref: ${order.paymentRef}`);
  doc.font("Helvetica").fontSize(10).text(`Payment Mode: ${formatPaymentMode(order.paymentMode)}`, 40, doc.y);

  // footer
  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  doc.fontSize(8).fillColor("#888").font("Helvetica")
    .text("Note: This invoice page is issued by the pharmacy for medicines.", 40, 730)
    .text("GoDavaii acts as a facilitator for orders and delivery.", 40, 742);
  doc.fontSize(10).fillColor(primary).font("Helvetica-Bold")
    .text("Thank you for choosing GODAVAII", 40, 760, { align: "center" });
  doc.fontSize(9).fillColor("black").font("Helvetica")
    .text("www.godavaii.com | support@godavaii.com", { align: "center" });
}

// ============================================================
// Signature block (image or fallback line + name)
// ============================================================
function addSignatureBlock(doc, company) {
  const signTop = Math.max(doc.y + 20, 640);
  const signLeft = 360;
  const lineY = signTop + 55;

  // “For <legal name>”
  doc.font("Helvetica").fontSize(10).text(`For ${company.legalName || "Karniva Private Limited"}`, signLeft, signTop);

  // optional seal image
  if (company.sealImage) {
    try { doc.image(company.sealImage, signLeft - 60, signTop + 5, { fit:[45,45] }); } catch {}
  }

  // signature image or gap
  if (company.signatureImage) {
    try { doc.image(company.signatureImage, signLeft + 25, signTop + 5, { fit:[120,45] }); } catch {}
  } else {
    doc.rect(signLeft + 25, signTop + 5, 120, 45).strokeColor("#CCCCCC").lineWidth(1).stroke();
  }

  // line + name/title (tidy caption)
  doc.moveTo(signLeft + 25, lineY).lineTo(signLeft + 170, lineY).strokeColor("#000").lineWidth(0.7).stroke();
  const nm = company.signatoryName || "Authorized Signatory";
  const tl = company.signatoryTitle || "Authorized Signatory";
  doc.font("Helvetica").fontSize(9).text(nm, signLeft + 25, lineY + 4);
  if (tl && tl !== nm) doc.text(tl, signLeft + 25, lineY + 16);
}

// ============================================================
// Page 2: Platform Fee (Service => SAC; auto IGST based on POS)
// ============================================================
function pagePlatformFee(doc, { order, company = {}, customer = {}, platformFeeGross }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#EAF7F2";

  doc.addPage();
  header(doc, "Platform Fee Tax Invoice");

  doc.moveDown(0.7).font("Helvetica").fontSize(10).fillColor("black");
  const startY = doc.y;

  const legalName  = company.legalName || "Karniva Private Limited";
  const tradeName  = company.tradeName || "GoDavaii";
  const dispName   = `${legalName} (${tradeName})`;
  const cin        = company.cin || "";
  const pan        = company.pan || "";
  const gstin      = company.gstin || "";
  const address    = company.address || "Sector 62, Noida, Uttar Pradesh";
  const email      = company.email || "support@godavaii.com";
  const phone      = company.phone || "";
  const website    = company.website || "www.godavaii.com";

  const leftBox = { x: 40,  w: 260, labelW: 140 };
  const rightBox= { x: 320, w: 235, labelW: 110 };

  // LEFT supplier column
  let yL = startY;
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Platform (Service Provider):", value: dispName, labelW:leftBox.labelW, colW:leftBox.w });
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Address:", value: address, labelW:leftBox.labelW, colW:leftBox.w });
  if (cin)  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"CIN:",   value: cin,   labelW:leftBox.labelW, colW:leftBox.w });
  if (pan)  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"PAN:",   value: pan,   labelW:leftBox.labelW, colW:leftBox.w });
  if (gstin)yL = drawKV(doc, { x:leftBox.x, y:yL, label:"GSTIN:", value: gstin, labelW:leftBox.labelW, colW:leftBox.w });

  // RIGHT meta column
  let yR = startY;
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Invoice No:", value: (order.invoiceNo || "") + "-PF", labelW:rightBox.labelW, colW:rightBox.w });
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Order ID:",   value: (order.orderId   || ""),         labelW:rightBox.labelW, colW:rightBox.w });
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Invoice Date:", value: (order.date    || ""),         labelW:rightBox.labelW, colW:rightBox.w });

  const supplierState = findStateName(address) || findStateName(company.state) || "uttar pradesh";
  const posState =
    findStateName(order?.deliveryAddress?.state) ||
    inferState(order?.deliveryAddress) ||
    inferState(order?.customerAddress) ||
    findStateName(customer?.address?.state) ||
    inferState(customer?.address) ||
    "uttar pradesh";

  const isInterState = (order?.isInterState !== undefined)
    ? !!order.isInterState
    : (supplierState && posState && supplierState !== posState);

  const posCode = STATE_CODES[posState] || "";
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Place of Supply:", value: `${titleCase(posState)}${posCode ? " ("+posCode+")" : ""}`, labelW:rightBox.labelW, colW:rightBox.w });

  // ensure next section starts below the taller column
  let curY = Math.max(yL, yR) + 6;

  // Customer (falls back to page-1 data) — consistent spacing
  const custLabelW = 140;
  curY = drawKV(doc, { x:40, y:curY, label:"Customer:", value:(order.customerName || customer?.name || ""), labelW:custLabelW, colW:515, gapY:4 });
  curY = drawKV(doc, { x:40, y:curY, label:"Customer Address:", value:getPrintableAddress(order.customerAddress || customer?.address), labelW:custLabelW, colW:515, gapY:6 });
  if (order.customerGSTIN || customer?.gstin) {
    curY = drawKV(doc, { x:40, y:curY, label:"Customer GSTIN:", value:(order.customerGSTIN || customer?.gstin), labelW:custLabelW, colW:515, gapY:6 });
  }

  // rule
  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  // ---------- Table ----------
  const tY = doc.y + 8;
  const headerH = 30;

  const gross = Number(platformFeeGross || 0);
  const GST_RATE = 18;
  const { base: taxableBase, tax: includedTax } = splitInclusive(gross, GST_RATE);

  // SAC by default for services (can switch to HSN via company.preferHSN)
  const useHSN = !!company.preferHSN;
  const codeLabel = useHSN ? "HSN" : "SAC";
  const codeValue = (useHSN ? (company.hsnForService || "9997") : (company.sac || "9969"));

  if (isInterState) {
    // IGST: S.No | Description | SAC | Taxable INR | IGST % | IGST INR | Total INR
    const col = { sno:30, desc:235, code:60, taxable:70, igstPct:32, igstAmt:44, total:44 }; // 515
    const x = {
      sno:40,
      desc:40+col.sno,
      code:40+col.sno+col.desc,
      taxable:40+col.sno+col.desc+col.code,
      igstPct:40+col.sno+col.desc+col.code+col.taxable,
      igstAmt:40+col.sno+col.desc+col.code+col.taxable+col.igstPct,
      total:  40+col.sno+col.desc+col.code+col.taxable+col.igstPct+col.igstAmt,
    };

    doc.rect(40, tY, 515, headerH).fill(tableHeaderBG).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
      .text("S.No", x.sno, tY+7, { width: col.sno })
      .text("Description", x.desc, tY+7, { width: col.desc })
      .text(codeLabel, x.code, tY+7, { width: col.code, align:"center" })
      .text("Taxable\nINR", x.taxable, tY+5, { width: col.taxable, align:"center" })
      .text("IGST\n%", x.igstPct, tY+5, { width: col.igstPct, align:"center" })
      .text("IGST\nINR", x.igstAmt, tY+5, { width: col.igstAmt, align:"center" })
      .text("Total\nINR", x.total, tY+5, { width: col.total, align:"center" });

    let rowY = tY + headerH;
    const rowH = 22;
    doc.font("Helvetica").fontSize(9).fillColor("black");
    doc.text("1", x.sno, rowY+6, { width: col.sno });
    doc.text("Platform/Delivery Fee", x.desc, rowY+6, { width: col.desc });
    doc.text(String(codeValue), x.code, rowY+6, { width: col.code, align:"center" });
    doc.text(fmtINR(taxableBase), x.taxable, rowY+6, { width: col.taxable, align:"center" });
    doc.text(GST_RATE.toFixed(1), x.igstPct, rowY+6, { width: col.igstPct, align:"center" });
    doc.text(fmtINR(includedTax), x.igstAmt, rowY+6, { width: col.igstAmt, align:"center" });
    doc.text(fmtINR(gross), x.total, rowY+6, { width: col.total, align:"right" });

    rowY += rowH;
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#E0E0E0").lineWidth(0.5).stroke();
  } else {
    // CGST/SGST: widths sum EXACTLY 515 (prevents overflow)
    const col = { sno:30, desc:190, code:55, taxable:70, cgstPct:30, cgstAmt:40, sgstPct:30, sgstAmt:40, total:30 }; // 515
    const x = {
      sno:40,
      desc:40+col.sno,
      code:40+col.sno+col.desc,
      taxable:40+col.sno+col.desc+col.code,
      cgstPct:40+col.sno+col.desc+col.code+col.taxable,
      cgstAmt:40+col.sno+col.desc+col.code+col.taxable+col.cgstPct,
      sgstPct:40+col.sno+col.desc+col.code+col.taxable+col.cgstPct+col.cgstAmt,
      sgstAmt:40+col.sno+col.desc+col.code+col.taxable+col.cgstPct+col.cgstAmt+col.sgstPct,
      total:  40+col.sno+col.desc+col.code+col.taxable+col.cgstPct+col.cgstAmt+col.sgstPct+col.sgstAmt,
    };

    doc.rect(40, tY, 515, headerH).fill(tableHeaderBG).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
      .text("S.No", x.sno, tY+7, { width: col.sno })
      .text("Description", x.desc, tY+7, { width: col.desc })
      .text(codeLabel, x.code, tY+7, { width: col.code, align:"center" })
      .text("Taxable\nINR", x.taxable, tY+5, { width: col.taxable, align:"center" })
      .text("CGST\n%", x.cgstPct, tY+5, { width: col.cgstPct, align:"center" })
      .text("CGST\nINR", x.cgstAmt, tY+5, { width: col.cgstAmt, align:"center" })
      .text("SGST\n%", x.sgstPct, tY+5, { width: col.sgstPct, align:"center" })
      .text("SGST\nINR", x.sgstAmt, tY+5, { width: col.sgstAmt, align:"center" })
      .text("Total\nINR", x.total, tY+5, { width: col.total, align:"center" });

    const halfTax = includedTax / 2;

    let rowY = tY + headerH;
    const rowH = 22;
    doc.font("Helvetica").fontSize(9).fillColor("black");
    doc.text("1", x.sno, rowY+6, { width: col.sno });
    doc.text("Platform/Delivery Fee", x.desc, rowY+6, { width: col.desc });
    doc.text(String(codeValue), x.code, rowY+6, { width: col.code, align:"center" });
    doc.text(fmtINR(taxableBase), x.taxable, rowY+6, { width: col.taxable, align:"center" });
    doc.text((GST_RATE/2).toFixed(1), x.cgstPct, rowY+6, { width: col.cgstPct, align:"center" });
    doc.text(fmtINR(halfTax), x.cgstAmt, rowY+6, { width: col.cgstAmt, align:"center" });
    doc.text((GST_RATE/2).toFixed(1), x.sgstPct, rowY+6, { width: col.sgstPct, align:"center" });
    doc.text(fmtINR(halfTax), x.sgstAmt, rowY+6, { width: col.sgstAmt, align:"center" });
    doc.text(fmtINR(gross), x.total, rowY+6, { width: col.total, align:"right" });

    rowY += rowH;
    doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#E0E0E0").lineWidth(0.5).stroke();
  }

  // Notes
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(9)
    .text("Pricing: Tax-inclusive. Reverse Charge: No.", 40, doc.y);

  // Payment
  doc.moveDown(0.6);
  if (order.paymentRef) doc.font("Helvetica").fontSize(10).text(`Payment Ref: ${order.paymentRef}`);
  doc.font("Helvetica").fontSize(10).text(`Payment Mode: ${formatPaymentMode(order.paymentMode)}`, 40, doc.y);

  // Amount in Words for Platform page
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(10).text("Amount in Words: ", 40, doc.y, { continued: true });
  doc.font("Helvetica").fontSize(10).text(amountInWords(gross));

  // Signature block (image or fallback)
  addSignatureBlock(doc, company);

  // Footer
  const contactLine = [website, email, phone].filter(Boolean).join(" | ");
  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();
  if (contactLine) doc.fontSize(9).fillColor("black").font("Helvetica").text(contactLine, 40, 730, { align:"center" });
  doc.fontSize(10).fillColor(primary).font("Helvetica-Bold")
    .text("Thank you for choosing GODAVAII", 40, 748, { align:"center" });
}

// ============================================================
// Main
// ============================================================
async function generateInvoice({ order = {}, pharmacy = {}, customer = {}, company = {}, platformFeeGross = 0 }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  await pageMedicines(doc, { order, pharmacy, customer });
  pagePlatformFee(doc, { order, company, customer, platformFeeGross });

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });
}

module.exports = generateInvoice;
