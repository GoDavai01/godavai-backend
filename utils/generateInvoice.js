// uploads/generateInvoice.js
// Page 1: Product (pharmacy) invoice – compact table + inline Amount in Words
// Page 2: Platform Fee invoice – compact table (auto IGST when POS != Supplier state), with signature
// Contact: support@godavaii.com

"use strict";

const PDFDocument = require("pdfkit");
const sharp = (() => { try { return require("sharp"); } catch { return null; } })();
const fs = require("fs");
const path = require("path");
const https = require("https");
const { classifyHSNandGST } = require("../utils/tax/taxClassifier");

// Try to obtain S3 handle (uploads/ then utils/)
const s3 = (() => {
  try { return require("./s3-setup"); }
  catch {
    try { return require("../utils/s3-setup"); }
    catch { return null; }
  }
})();

// -------------------- small utils --------------------
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtINR = (n) => (r2(n)).toFixed(2);

function getPrintableAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  if (addr.formatted) return addr.formatted;
  if (addr.fullAddress) return addr.fullAddress;
  const main = [addr.addressLine, addr.floor, addr.area, addr.city, addr.state, addr.pincode].filter(Boolean);
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

// Amount in words (Indian numbering) with paise
function amountInWordsINR(num) {
  num = Number(num || 0);
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const two = (n)=> n < 20 ? a[n] : b[Math.floor(n/10)] + (n%10 ? " " + a[n%10] : "");
  const three = (n)=> {
    const h = Math.floor(n/100), r = n%100;
    return (h ? a[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };

  const ru = rupees;
  const c = Math.floor(ru/1e7);
  const l = Math.floor((ru/1e5)%100);
  const t = Math.floor((ru/1e3)%100);
  const h = Math.floor((ru/100)%10);
  const r = Math.floor(ru%100);

  let s = "";
  if (c) s += two(c) + " Crore";
  if (l) s += (s?" ":"") + two(l) + " Lakh";
  if (t) s += (s?" ":"") + two(t) + " Thousand";
  if (h) s += (s?" ":"") + a[h] + " Hundred";
  if (r) s += (s?" and ":"") + two(r);
  if (!s) s = "Zero";

  if (paise > 0) {
    const p = paise < 20 ? a[paise] : b[Math.floor(paise/10)] + (paise%10 ? " " + a[paise%10] : "");
    return `${s} Rupees And ${p} Paisa Only`;
  }
  return `${s} Rupees Only`;
}

// -------------------- header & layout helpers --------------------
function header(doc, subtitleLeft, opts = {}) {
  const primary = "#13C0A2";
  const lightGrey = "#F1F1F1";
  const topRight = opts.topRight ?? "ORIGINAL FOR RECIPIENT";
  const bigTitle = opts.bigTitle ?? "TAX INVOICE";

  if (topRight) {
    const yBefore = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#444").text(topRight, { align: "right" });
    doc.y = yBefore;
  }

  doc.font("Helvetica-Bold").fontSize(22).fillColor(primary).text("GODAVAII", { align: "left" });
  doc.moveDown(0.2);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text(bigTitle, { align: "left" });
  if (subtitleLeft) {
    doc.moveDown(0.15);
    doc.font("Helvetica").fontSize(11).fillColor("black").text(subtitleLeft, { align: "left" });
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
const CODE_TO_STATE = Object.fromEntries(Object.entries(STATE_CODES).map(([k,v]) => [v,k]));
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
function stateFromGSTIN(gstin){ const m=String(gstin||"").match(/^(\d{2})/); return m?m[1]:""; }

// -------------------- signature loaders --------------------
function fetchHttpsToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

async function loadSignatureBuffer(company) {
  try {
    // 1) local path
    if (company?.signatureImage && fs.existsSync(company.signatureImage)) {
      return fs.readFileSync(company.signatureImage);
    }
    // 2) S3 key (default: branding/signature.jpg)
    const key = company?.signatureS3Key || "branding/signature.jpg";
    if (s3 && process.env.AWS_BUCKET_NAME && key) {
      const obj = await s3.getObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }).promise();
      if (obj?.Body) return Buffer.isBuffer(obj.Body) ? obj.Body : Buffer.from(obj.Body);
    }
    // 3) HTTPS URL if provided
    if (company?.signatureImage && /^https?:\/\//i.test(company.signatureImage)) {
      return await fetchHttpsToBuffer(company.signatureImage);
    }
  } catch (_) {}
  return null;
}

// ============================================================
// Signature processing (B/W, trim, fit) using sharp (fallback to raw)
// ============================================================
async function prepareSignatureBuffer(company) {
  try {
    const input = await loadSignatureBuffer(company);
    if (!input) return null;
    if (!sharp) return input; // fallback: no processing available

    // grayscale -> high contrast threshold -> trim -> resize to fit box
    let img = sharp(input).grayscale();
    img = img.linear(1.6, -30).threshold(170);
    if (img.trim) { try { img = img.trim(); } catch {} }

    const maxW = Number(company.signatureMaxW || 120);
    const maxH = Number(company.signatureMaxH || 45);
    img = img.resize({ width: maxW * 3, height: maxH * 3, fit: "inside" }).png();

    return await img.toBuffer();
  } catch {
    return null;
  }
}

// ============================================================
// Signature block (no overlap; configurable box visibility)
// ============================================================
async function addSignatureBlock(doc, company) {
  const signTop = Math.max(doc.y + 24, 640); // pushes the box down so it never overlaps the label
  const signLeft = 360;

  // Label "For <Company>" (always above the box)
  doc.font("Helvetica").fontSize(10).fillColor("black")
     .text(`For ${company.legalName || "Karniva Private Limited"}`, signLeft, signTop);

  // Geometry
  const boxX = signLeft + 25;
  const boxY = signTop + 16; // gap prevents overlap with label
  const boxW = Number(company.signatureMaxW || 120);
  const boxH = Number(company.signatureMaxH || 45);

  // Box visibility control
  const mode = (company.signatureMode || "box").toLowerCase(); // box | invisiblebox | nobox
  if (mode === "box") {
    doc.rect(boxX, boxY, boxW, boxH).strokeColor("#CCCCCC").lineWidth(1).stroke();
  } else if (mode === "invisiblebox") {
    doc.rect(boxX, boxY, boxW, boxH).strokeColor("#FFFFFF").lineWidth(1).stroke();
  } // nobox => no rect, signature still placed & centered

  // Signature image (processed) centered inside the area
  const processed = (company.signatureBW !== false) ? await prepareSignatureBuffer(company) : await loadSignatureBuffer(company);
  if (processed) {
    try {
      doc.image(processed, boxX + 4, boxY + 4, { fit: [boxW - 8, boxH - 8], align: 'center', valign: 'center' });
    } catch { /* ignore bad image data */ }
  }

  // Line + caption (kept below the box)
  const lineY = boxY + boxH + 14;
  doc.moveTo(boxX, lineY).lineTo(boxX + boxW + 45, lineY).strokeColor("#000").lineWidth(0.7).stroke();
  const nm = company.signatoryName || "Authorized Signatory";
  const tl = company.signatoryTitle || "Authorized Signatory";
  doc.font("Helvetica").fontSize(9).fillColor("black").text(nm, boxX, lineY + 4);
  if (tl && tl !== nm) doc.text(tl, boxX, lineY + 16);

  return lineY + 28;
}

// ============================================================
// Unified Footer with NOTES + contact + final Thank You
// ============================================================
function renderFooter(doc, { company = {}, notes = [], includeCommAddress = false }) {
  const primary = "#13C0A2";
  const address = company.communicationAddress || company.address || "";
  const contactLine = [company.website || "www.godavaii.com", company.email || "support@godavaii.com", company.phone || ""]
    .filter(Boolean).join(" | ");

  doc.moveTo(40, 720).lineTo(555, 720).strokeColor("#E0E0E0").lineWidth(1).stroke();

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#222").text("NOTES", 40, 730);
  doc.font("Helvetica").fontSize(9).fillColor("#000");
  let y = doc.y + 2;
  notes.forEach(n => {
    const bullet = "• ";
    doc.text(bullet + n, 40, y, { width: 515 });
    y = doc.y + 2;
  });

  if (includeCommAddress && address) {
    doc.font("Helvetica").fontSize(9).fillColor("#000").text(`Communication Address: ${address}`, 40, y + 6, { align: "center" });
    y = doc.y;
  }
  if (contactLine) {
    doc.font("Helvetica").fontSize(9).fillColor("#000").text(contactLine, 40, y + 4, { align: "center" });
    y = doc.y;
  }

  doc.fontSize(10).fillColor(primary).font("Helvetica-Bold")
    .text("Thank you for choosing GODAVAII", 40, 772, { align: "center" });
}

// ============================================================
// Page 1: Pharmacy products (Goods => HSN)
// ============================================================
async function pageMedicines(doc, { order, pharmacy, customer, company }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#EAF7F2";
  const lightGrey = "#EAEAEA";

  header(doc, "Invoice for Medicine Purchase", { bigTitle: "TAX INVOICE", topRight: "ORIGINAL FOR RECIPIENT" });

  doc.moveDown(0.7).font("Helvetica").fontSize(10).fillColor("black");
  const startY = doc.y;

  const leftBox = { x: 40, w: 260, labelW: 120 };
  const rightBox = { x: 320, w: 235, labelW: 110 };

  const supplierCode = stateFromGSTIN(pharmacy?.gstin) || (STATE_CODES[inferState(pharmacy?.address)] || "");
  const supplierState = CODE_TO_STATE[supplierCode] || inferState(pharmacy?.address) || "uttar pradesh";

  const posState =
    findStateName(order?.deliveryAddress?.state) ||
    inferState(order?.deliveryAddress) ||
    inferState(order?.customerAddress) ||
    findStateName(customer?.address?.state) ||
    inferState(customer?.address) ||
    supplierState;
  const posCode = STATE_CODES[posState] || "";
  const isInterState = supplierCode && posCode && supplierCode !== posCode;

  let yL = startY;
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Invoice No:",   value: order.invoiceNo || "", labelW:leftBox.labelW, colW:leftBox.w });
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Order ID:",     value: order.orderId   || "", labelW:leftBox.labelW, colW:leftBox.w });
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Invoice Date:", value: order.date      || "", labelW:leftBox.labelW, colW:leftBox.w });

  let yR = startY;
  if (pharmacy?.legalEntityName) {
    yR = drawKV(doc, {
      x: rightBox.x,
      y: yR,
      label: "Legal Entity Name:",
      value: pharmacy.legalEntityName,
      labelW: rightBox.labelW,
      colW: rightBox.w
    });
  }
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Pharmacy:", value:(pharmacy?.name || ""),    labelW:rightBox.labelW, colW:rightBox.w });
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Address:",  value:(pharmacy?.address || ""), labelW:rightBox.labelW, colW:rightBox.w });
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"GSTIN:",    value:(pharmacy?.gstin || ""),   labelW:rightBox.labelW, colW:rightBox.w });

  const drugLicense =
    pharmacy?.drugLicenseRetail ||
    pharmacy?.drugLicense20B ||
    pharmacy?.drugLicense ||
    pharmacy?.drugLicence;
  if (drugLicense) {
    yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Drug License No.:", value: drugLicense, labelW:rightBox.labelW, colW:rightBox.w });
  }

  let curY = Math.max(yL, yR) + 6;

  const custLabelW = 120;
  curY = drawKV(doc, { x:40, y:curY, label:"Customer:", value:(order.customerName || customer?.name || ""), labelW:custLabelW, colW:515, gapY:4 });

  const deliveryAddr = order?.deliveryAddress || order?.customerAddress || customer?.address;
  curY = drawKV(doc, { x:40, y:curY, label:"Delivery Address:", value:getPrintableAddress(deliveryAddr), labelW:custLabelW, colW:515, gapY:4 });

  if (order.customerGSTIN || customer?.gstin) {
    curY = drawKV(doc, { x:40, y:curY, label:"Customer GSTIN:", value:(order.customerGSTIN || customer?.gstin), labelW:custLabelW, colW:515, gapY:4 });
  }
  curY = drawKV(doc, { x:40, y:curY, label:"Place of Supply:", value:`${titleCase(posState)}${posCode ? " ("+posCode+")" : ""}`, labelW:custLabelW, colW:515, gapY:6 });

  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();
  const tableY = doc.y + 8;

  const items = Array.isArray(order.items) ? order.items : [];
  const cls = await Promise.all(items.map(async (it) => { try { return await classifyHSNandGST(it); } catch { return null; } }));

  let grossSum = 0, baseSum = 0, cgstSum = 0, sgstSum = 0, igstSum = 0;
  let rowY = tableY + 30;
  const rowH = 22;

  if (isInterState) {
    const col = { sno:30, name:205, hsn:55, qty:28, taxable:70, igstPct:32, igstAmt:44, total:51 }; // 515
    const x = {
      sno:40,
      name:40+col.sno,
      hsn:40+col.sno+col.name,
      qty:40+col.sno+col.name+col.hsn,
      taxable:40+col.sno+col.name+col.hsn+col.qty,
      igstPct:40+col.sno+col.name+col.hsn+col.qty+col.taxable,
      igstAmt:40+col.sno+col.name+col.hsn+col.qty+col.taxable+col.igstPct,
      total:  40+col.sno+col.name+col.hsn+col.qty+col.taxable+col.igstPct+col.igstAmt,
    };

    doc.rect(40, tableY, 515, 30).fill(tableHeaderBG).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
      .text("S.No",        x.sno,     tableY + 7, { width: col.sno, align: "left" })
      .text("Product",     x.name,    tableY + 7, { width: col.name })
      .text("HSN",         x.hsn,     tableY + 7, { width: col.hsn, align: "center" })
      .text("Qty",         x.qty,     tableY + 7, { width: col.qty, align: "center" })
      .text("Taxable\nINR",x.taxable, tableY + 5, { width: col.taxable, align: "center" })
      .text("IGST\n%",     x.igstPct, tableY + 5, { width: col.igstPct, align: "center" })
      .text("IGST\nINR",   x.igstAmt, tableY + 5, { width: col.igstAmt, align: "center" })
      .text("Total\nINR",  x.total,   tableY + 5, { width: col.total, align: "center" });

    doc.font("Helvetica").fontSize(9).fillColor("black");

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const qty = Number(it.quantity || 0);
      const unitGross = Number(it.price || 0);
      const rate = Number((cls[i] && cls[i].gstRate) ?? it.gstRate ?? 12);

      const lineGross = qty * unitGross;
      const { base, tax } = splitInclusive(lineGross, rate);
      const igstPct = rate;
      const igstAmt = tax;

      grossSum += lineGross; baseSum += base; igstSum += igstAmt;

      doc.text(String(i + 1), x.sno, rowY + 6, { width: col.sno });
      doc.text((it.name || ""), x.name, rowY + 6, { width: col.name });
      doc.text((cls[i]?.hsn ? String(cls[i].hsn) : (it.hsn || "")), x.hsn, rowY + 6, { width: col.hsn, align: "center" });
      doc.text(qty || "", x.qty, rowY + 6, { width: col.qty, align: "center" });
      doc.text(fmtINR(base),       x.taxable, rowY + 6, { width: col.taxable, align: "center" });
      doc.text(igstPct.toFixed(1), x.igstPct, rowY + 6, { width: col.igstPct, align: "center" });
      doc.text(fmtINR(igstAmt),    x.igstAmt, rowY + 6, { width: col.igstAmt, align: "center" });
      doc.text(fmtINR(lineGross),  x.total,   rowY + 6, { width: col.total,   align: "right" });

      rowY += rowH;
      doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#E0E0E0").lineWidth(0.5).stroke();

      if (rowY > 680) {
        doc.addPage(); header(doc, "Medicines (contd.)", { bigTitle: "TAX INVOICE", topRight: "ORIGINAL FOR RECIPIENT" }); rowY = doc.y + 16;
        doc.rect(40, rowY, 515, 30).fill(tableHeaderBG).stroke();
        doc.font("Helvetica-Bold").fontSize(9).fillColor(primary)
          .text("S.No", x.sno, rowY + 7, { width: col.sno })
          .text("Product", x.name, rowY + 7, { width: col.name })
          .text("HSN", x.hsn, rowY + 7, { width: col.hsn, align: "center" })
          .text("Qty", x.qty, rowY + 7, { width: col.qty, align: "center" })
          .text("Taxable\nINR", x.taxable, rowY + 5, { width: col.taxable, align: "center" })
          .text("IGST\n%", x.igstPct, rowY + 5, { width: col.igstPct, align: "center" })
          .text("IGST\nINR", x.igstAmt, rowY + 5, { width: col.igstAmt, align: "center" })
          .text("Total\nINR", x.total, rowY + 5, { width: col.total, align: "center" });
        rowY += 30;
      }
    }

    if (rowY > 680) { doc.addPage(); header(doc, "Medicines (contd.)", { bigTitle: "TAX INVOICE", topRight: "ORIGINAL FOR RECIPIENT" }); rowY = doc.y + 16; }
    doc.rect(40, rowY, 515, 22).fill("#F7F7F7").strokeColor("#E0E0E0").lineWidth(0.5).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black")
      .text("Item(s) Total", 40+30, rowY + 6, { width: 205+55+28, align: "left" });
    doc.font("Helvetica-Bold")
      .text(fmtINR(baseSum), 40+30+205+55+28, rowY + 6, { width: 70, align: "center" })
      .text(fmtINR(igstSum), 40+30+205+55+28+70+32, rowY + 6, { width: 44, align: "center" })
      .text(fmtINR(grossSum), 40+30+205+55+28+70+32+44, rowY + 6, { width: 51, align: "right" });
    rowY += 22;

  } else {
    const col = { sno:30, name:170, hsn:44, qty:28, taxable:60, cgstPct:32, cgstAmt:44, sgstPct:32, sgstAmt:44, total:31, x: 40 };
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

    doc.rect(40, tableY, 515, 28).fill(tableHeaderBG).stroke();
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
      doc.text(fmtINR(lineGross),  x.total,   rowY + 6, { width: col.total,   align: "right" });

      rowY += rowH;
      doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor("#E0E0E0").lineWidth(0.5).stroke();

      if (rowY > 680) {
        doc.addPage(); header(doc, "Medicines (contd.)", { bigTitle: "TAX INVOICE", topRight: "ORIGINAL FOR RECIPIENT" }); rowY = doc.y + 16;
        doc.rect(40, rowY, 515, 28).fill(tableHeaderBG).stroke();
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
        rowY += 28;
      }
    }

    if (rowY > 680) { doc.addPage(); header(doc, "Medicines (contd.)", { bigTitle: "TAX INVOICE", topRight: "ORIGINAL FOR RECIPIENT" }); rowY = doc.y + 16; }
    doc.rect(40, rowY, 515, 22).fill("#F7F7F7").strokeColor("#E0E0E0").lineWidth(0.5).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black")
      .text("Item(s) Total", x.name, rowY + 6, { width: col.name + col.hsn + col.qty, align: "left" });
    doc.font("Helvetica-Bold")
      .text(fmtINR(baseSum),  x.taxable, rowY + 6, { width: col.taxable, align: "center" })
      .text(fmtINR(cgstSum),  x.cgstAmt, rowY + 6, { width: col.cgstAmt, align: "center" })
      .text(fmtINR(sgstSum),  x.sgstAmt, rowY + 6, { width: col.sgstAmt, align: "center" })
      .text(fmtINR(grossSum), x.total,   rowY + 6, { width: col.total,   align: "right" });
    rowY += 22;
  }

  doc.moveTo(40, rowY + 8).lineTo(555, rowY + 8).strokeColor(primary).lineWidth(1).stroke();
  const words = amountInWordsINR(grossSum);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("black")
    .text("Amount in Words: ", 40, rowY + 16, { continued: true });
  doc.font("Helvetica").fontSize(10).text(words);

  doc.moveDown(0.8);
  if (order.paymentRef) doc.font("Helvetica").fontSize(10).text(`Payment Ref: ${order.paymentRef}`);
  doc.font("Helvetica").fontSize(10).text(`Payment Mode: ${formatPaymentMode(order.paymentMode)}`, 40, doc.y);
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10).text(
    `Amount of INR ${fmtINR(grossSum)} settled through ${formatPaymentMode(order.paymentMode)} ` +
    `against Order ID: ${order.orderId || ""} dated ${order.date || ""}.`
  );

  renderFooter(doc, {
    company,
    notes: [
      "This invoice page is issued by the pharmacy for medicines.",
      "GoDavaii acts as a facilitator for orders and delivery."
    ],
    includeCommAddress: false
  });
}

// ============================================================
// Page 2: Platform Fee (Service => SAC/HSN; auto IGST based on POS)
// ============================================================
async function pagePlatformFee(doc, { order, company = {}, customer = {}, platformFeeGross }) {
  const primary = "#13C0A2";
  const tableHeaderBG = "#EAF7F2";

  doc.addPage();
  header(doc, "Platform Fee Tax Invoice", { bigTitle: "TAX INVOICE", topRight: "ORIGINAL FOR RECIPIENT" });

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
  const termsUrl   = company.termsUrl || "";

  const leftBox = { x: 40,  w: 260, labelW: 140 };
  const rightBox= { x: 320, w: 235, labelW: 110 };

  let yL = startY;
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Platform (Service Provider):", value: dispName, labelW:leftBox.labelW, colW:leftBox.w });
  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"Address:", value: address, labelW:leftBox.labelW, colW:leftBox.w });
  if (cin)  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"CIN:",   value: cin,   labelW:leftBox.labelW, colW:leftBox.w });
  if (pan)  yL = drawKV(doc, { x:leftBox.x, y:yL, label:"PAN:",   value: pan,   labelW:leftBox.labelW, colW:leftBox.w });
  if (gstin)yL = drawKV(doc, { x:leftBox.x, y:yL, label:"GSTIN:", value: gstin, labelW:leftBox.labelW, colW:leftBox.w });

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
  yR = drawKV(doc, { x:rightBox.x, y:yR, label:"Place of Supply:", value: `${titleCase(posState)}${posCode ? " (${posCode})" : ""}`, labelW:rightBox.labelW, colW:rightBox.w });

  let curY = Math.max(yL, yR) + 6;

  const custLabelW = 140;
  doc.font("Helvetica-Bold").fontSize(10).text("Customer Details", 40, curY); curY = doc.y + 2;
  curY = drawKV(doc, { x:40, y:curY, label:"Name:", value:(order.customerName || customer?.name || ""), labelW:custLabelW, colW:515, gapY:2 });
  curY = drawKV(doc, { x:40, y:curY, label:"GSTIN:", value:(order.customerGSTIN || customer?.gstin || "UNREGISTERED"), labelW:custLabelW, colW:515, gapY:2 });

  const deliveryAddr2 = order?.deliveryAddress || order?.customerAddress || customer?.address;
  curY = drawKV(doc, { x:40, y:curY, label:"Delivery Address:", value:getPrintableAddress(deliveryAddr2), labelW:custLabelW, colW:515, gapY:6 });

  doc.font("Helvetica-Bold").fontSize(10).text("Service Details", 40, curY); curY = doc.y + 2;

  const useHSN = !!company.preferHSN;
  const codeLabel = useHSN ? "HSN" : "SAC";
  const codeValue = (useHSN ? (company.hsnForService || "999799") : (company.sac || "999799"));
  curY = drawKV(doc, { x:40, y:curY, label:`${codeLabel}:`, value:`${codeValue} (Other Services N.E.C.)`, labelW:custLabelW, colW:515, gapY:6 });

  doc.moveDown(0.4);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(tableHeaderBG).lineWidth(1.5).stroke();

  const tY = doc.y + 8;
  const headerH = 30;

  const gross = Number(platformFeeGross || 0);
  const GST_RATE = 18;
  const { base: taxableBase, tax: includedTax } = splitInclusive(gross, GST_RATE);

  if (isInterState) {
    const col = { sno:30, desc:235, code:60, taxable:70, igstPct:32, igstAmt:44, total:44 };
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
    const col = { sno:30, desc:190, code:55, taxable:70, cgstPct:30, cgstAmt:40, sgstPct:30, sgstAmt:40, total:30 };
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

  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(10).text("Amount in Words: ", 40, doc.y, { continued: true });
  doc.font("Helvetica").fontSize(10).text(amountInWordsINR(gross));

  // Signature block (processed B/W image; no overlap; configurable box)
  await addSignatureBlock(doc, company);

  const footerNotes = [
    "Pricing is tax-inclusive. Tax is not payable on reverse charge basis.",
    "GoDavaii acts as a facilitator for orders and delivery."
  ];
  renderFooter(doc, { company, notes: footerNotes, includeCommAddress: true });
}

// ============================================================
// Main
// ============================================================
async function generateInvoice({ order = {}, pharmacy = {}, customer = {}, company = {}, platformFeeGross = 0 }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  await pageMedicines(doc, { order, pharmacy, customer, company });
  await pagePlatformFee(doc, { order, company, customer, platformFeeGross });

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });
}

module.exports = generateInvoice;
