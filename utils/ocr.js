// utils/ocr.js

// Prefer Node 18+ fetch; fallback to node-fetch if present.
const fetchFn =
  (globalThis.fetch && globalThis.fetch.bind(globalThis)) ||
  (async (...args) => {
    const { default: f } = await import("node-fetch");
    return f(...args);
  });

// Small helper to always send a UA (some CDNs block no-UA requests)
async function fetchWithUA(url, opts = {}) {
  const headers = Object.assign(
    { "User-Agent": "Godavaii-OCR/1.0" },
    opts.headers || {}
  );
  return fetchFn(url, { ...opts, headers });
}

const sharp = require("sharp");

/* ----------------------- Clients (lazy / optional) ----------------------- */

let visionClient = null;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCV_CREDENTIALS_JSON) {
    const { ImageAnnotatorClient } = require("@google-cloud/vision");
    const apiEndpoint =
      (process.env.GCV_API_ENDPOINT || process.env.GOOGLE_VISION_API_ENDPOINT || "").trim() || undefined;

    // Force REST transport to avoid gRPC/OpenSSL issues seen in logs
    const baseOpts = { fallback: true, ...(apiEndpoint ? { apiEndpoint } : {}) };

    visionClient = process.env.GCV_CREDENTIALS_JSON
      ? new ImageAnnotatorClient({
          ...baseOpts,
          credentials: JSON.parse(process.env.GCV_CREDENTIALS_JSON),
        })
      : new ImageAnnotatorClient(baseOpts);
  }
} catch {
  /* ignore */
}

let textractClient = null;
try {
  if (
    process.env.DISABLE_TEXTRACT !== "1" &&
    process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  ) {
    const { TextractClient } = require("@aws-sdk/client-textract");
    textractClient = new TextractClient({ region: process.env.AWS_REGION });
  }
} catch {
  /* ignore */
}

/* ------------------------------ Helpers ---------------------------------- */

async function loadBuffer(urlOrPath) {
  if (/^https?:\/\//i.test(urlOrPath)) {
    const res = await fetchWithUA(urlOrPath);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Failed to fetch image: ${res.status} ${res.statusText} ${body?.slice(0, 120)}`
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
  const path = require("path");
  const fs = require("fs");
  return fs.promises.readFile(
    path.resolve(process.cwd(), urlOrPath.replace(/^\//, ""))
  );
}

// Light MIME sniffing so we don't push PDFs/TIFFs through sharp.
function sniffMime(buf) {
  const a = buf;
  if (a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46) return "application/pdf"; // %PDF
  if (
    (a[0] === 0x49 && a[1] === 0x49 && a[2] === 0x2a && a[3] === 0x00) || // II*\0
    (a[0] === 0x4d && a[1] === 0x4d && a[2] === 0x00 && a[3] === 0x2a)    // MM\0*
  ) return "image/tiff";
  return "image";
}

async function preprocess(buf) {
  const kind = sniffMime(buf);
  if (kind !== "image") return buf; // PDFs/TIFFs must be sent as-is
  try {
    return await sharp(buf).rotate().jpeg({ quality: 92 }).normalize().toBuffer();
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] preprocess skipped:", e.message);
    return buf; // never fail preprocessing
  }
}

/* -------------------------------- Sleep ---------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ Engines ---------------------------------- */

/** Google Vision OCR (with tiny retry) */
async function ocrGoogle(buf) {
  if (!visionClient) return null;
  for (let i = 0; i < 2; i++) {
    try {
      const [result] = await visionClient.documentTextDetection({ image: { content: buf } });
      const text =
        result?.fullTextAnnotation?.text ||
        result?.textAnnotations?.[0]?.description;
      if (text) return { text, lines: splitToLines(text), engine: "google-vision" };
    } catch (err) {
      if (process.env.DEBUG_OCR)
        console.warn("[OCR] google-vision attempt failed:", err?.message || err);
    }
  }
  return null;
}

/** Azure Vision Read OCR (REST, v3.2) — longer poll for PDFs/handwriting */
async function ocrAzure(buf) {
  const ep = (process.env.AZURE_VISION_ENDPOINT || process.env.AZURE_OCR_ENDPOINT || "").replace(/\/+$/, "");
  const key = process.env.AZURE_VISION_KEY;
  if (!ep || !key) return null;

  try {
    const submit = await fetchWithUA(`${ep}/vision/v3.2/read/analyze`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/octet-stream",
      },
      body: buf,
    });

    if (submit.status !== 202) {
      if (process.env.DEBUG_OCR) {
        const txt = await submit.text().catch(() => "");
        console.warn("[OCR] azure submit failed:", submit.status, submit.statusText, txt.slice(0, 200));
      }
      return null;
    }

    const op = submit.headers.get("operation-location");
    if (!op) return null;

    for (let i = 0; i < 28; i++) {
      await sleep(800);
      const res = await fetchWithUA(op, {
        headers: { "Ocp-Apim-Subscription-Key": key },
      });
      const j = await res.json().catch(() => ({}));
      if (j.status === "succeeded") {
        // Normalize to lines with confidence and bbox (when present)
        const pages =
          j?.analyzeResult?.readResults ??
          j?.analyzeResult?.pages ??
          [];
        const lines = [];
        for (const p of pages) {
          const src = p.lines || [];
          for (const l of src) {
            lines.push({
              text: l.text || l.content || "",
              confidence: typeof l.appearance?.style?.confidence === "number"
                ? l.appearance.style.confidence
                : (typeof l.confidence === "number" ? l.confidence : undefined),
              bbox: l.boundingBox || l.polygon || undefined,
            });
          }
        }
        const text = lines.map(l => l.text).join("\n");
        return { text, lines, engine: "azure-vision-read" };
      }
      if (j.status === "failed") {
        if (process.env.DEBUG_OCR) console.warn("[OCR] azure status=failed");
        return null;
      }
    }
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] azure error:", e?.message || e);
  }
  return null;
}

/** AWS Textract OCR (simple lines) */
async function ocrTextract(buf) {
  if (!textractClient) return null;
  try {
    const { DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
    const out = await textractClient.send(
      new DetectDocumentTextCommand({ Document: { Bytes: buf } })
    );
    const lines = (out?.Blocks || [])
      .filter((b) => b.BlockType === "LINE")
      .map((b) => ({ text: b.Text, confidence: b.Confidence }))
      .filter((l) => !!l.text);
    const text = lines.map(l => l.text).join("\n");
    return { text, lines, engine: "aws-textract" };
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] textract failed:", e?.message || e);
    return null;
  }
}

/** Local Tesseract OCR (fallback, optional & safe with timeout) */
async function ocrTesseract(buf) {
  let createWorker;
  try {
    ({ createWorker } = require("tesseract.js"));
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] tesseract.js not installed:", e.message);
    return null;
  }

  let worker;
  let timeout;
  const kill = async () => {
    clearTimeout(timeout);
    try { await worker?.terminate(); } catch {}
  };

  try {
    // Do NOT pass a logger function; it causes DataCloneError in Node workers
    worker = await createWorker();
    timeout = setTimeout(() => { kill(); }, 30_000);

    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const { data } = await worker.recognize(buf);
    await kill();
    const text = data?.text || "";
    return { text, lines: splitToLines(text).map(t => ({ text: t })), engine: "tesseract" };
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] tesseract run failed:", e.message);
    await kill();
    return null;
  }
}

/* --------------------------- Normalization + Rx parse --------------------- */

function splitToLines(text) {
  return (text || "")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

// very lightweight filters to drop boilerplate/template text
const STOPWORDS = new Set([
  "FORM","DOD PRESCRIPTION","FOR (FULL NAME","U.S.S.","MEDICAL FACILITY","EXP DATE",
  "LOT NO","FILLED BY","SIGNATURE","RANK","EDITION","S/N","B NUMBER","MFGR","DATE",
  "PRESCRIPTION","RX","(SUPERSCRIPTION)","(INSCRIPTION)","(SUBSCRIPTION)","(SIGNA)",
  "SIGNATURE RANK AND","MEDICATION","DOSAGE","DIRECTION"
]);

// regex components
const UNITS = "(mg|mcg|g|ml|iu|%)";
const STRENGTH = `\\b\\d+(?:\\.\\d+)?\\s*${UNITS}\\b`;
const QTY = "\\b(?:x\\s*)?([1-9]\\d?)\\b"; // x5 or 5

// keep line if it looks drug-like
function looksLikeDrugLine(s) {
  if (!/[A-Za-z]/.test(s)) return false;
  const U = s.toUpperCase();

  // drop common template/metadata lines
  for (const w of STOPWORDS) {
    if (U.includes(w)) return false;
  }
  // drop obvious dates and serials
  if (/\b\d{1,2}\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(s)) return false;
  if (/\b(19|20)\d{2}\b/.test(s)) return false;
  if (/S\/N|LOT|EXP|MFGR|FILLED BY/i.test(s)) return false;

  // prefer lines with units or dose-like tokens
  if (new RegExp(STRENGTH, "i").test(s)) return true;
  if (/\b(tab|cap|syrup|suspension|ointment|cream|drop|solution|injection|tablet|capsule)s?\b/i.test(s)) return true;

  // short single words are likely names (keep), long headers not
  const words = s.split(/\s+/);
  return words.length <= 6;
}

function parseDrugLine(s) {
  const strengthMatch = s.match(new RegExp(STRENGTH, "i"));
  const qtyMatch = s.match(new RegExp(QTY, "i"));

  // name: strip trailing qty/strength and obvious fillers
  let name = s;
  name = name.replace(/\b(qty|quantity)[:\s]*\d+\b/i, "");
  if (strengthMatch) name = name.replace(strengthMatch[0], "");
  if (qtyMatch) name = name.replace(qtyMatch[0], "");
  name = name.replace(/\b(\-|–|:|,)\b/g, " ").replace(/\s{2,}/g, " ").trim();

  const qty = qtyMatch ? parseInt(qtyMatch[1] || qtyMatch[0].replace(/[^\d]/g, ""), 10) : 1;
  const strength = strengthMatch ? strengthMatch[0] : "-";

  return { name, strength, qty };
}

/* --------------------------- Public functions ---------------------------- */

/** Returns { text, engine } */
async function extractTextPlus(urlOrPath) {
  const raw = await loadBuffer(urlOrPath);
  const buf = await preprocess(raw);

  // Order: Google → Azure → Textract → Tesseract
  let out = await ocrGoogle(buf);
  if (out?.text) return { text: out.text.trim(), engine: out.engine };

  out = await ocrAzure(buf);
  if (out?.text) return { text: out.text.trim(), engine: out.engine };

  out = await ocrTextract(buf);
  if (out?.text) return { text: out.text.trim(), engine: out.engine };

  out = await ocrTesseract(buf);
  if (out?.text) return { text: out.text.trim(), engine: out.engine };

  if (process.env.DEBUG_OCR) console.warn("[OCR] all engines returned null/empty");
  return { text: "", engine: "none" };
}

/** Returns { text, lines:[{text,confidence?,bbox?}], engine } when available */
async function extractTextPlusDetailed(urlOrPath) {
  const raw = await loadBuffer(urlOrPath);
  const buf = await preprocess(raw);

  // Prefer Azure for detailed line/confidence when possible
  let out = await ocrAzure(buf);
  if (out) return { text: out.text.trim(), lines: out.lines, engine: out.engine };

  out = await ocrGoogle(buf);
  if (out) return { text: out.text.trim(), lines: out.lines.map(t => ({ text: t })), engine: out.engine };

  out = await ocrTextract(buf);
  if (out) return { text: out.text.trim(), lines: out.lines, engine: out.engine };

  out = await ocrTesseract(buf);
  if (out) return { text: out.text.trim(), lines: out.lines, engine: out.engine };

  return { text: "", lines: [], engine: "none" };
}

/** Extracts medicine-like items from a prescription image (heuristic). */
async function extractPrescriptionItems(urlOrPath) {
  const detailed = await extractTextPlusDetailed(urlOrPath);
  const rawLines = (detailed.lines?.map(l => ({
    text: (l.text || "").trim(),
    confidence: typeof l.confidence === "number" ? l.confidence : undefined,
    bbox: l.bbox
  })) || []).filter(l => l.text);

  // Basic confidence gate (when present)
  const minConf = 0.40;
  const filtered = rawLines
    .filter(l => (l.confidence == null || l.confidence >= minConf))
    .map(l => l.text);

  const candidates = [];
  for (const line of filtered) {
    if (!looksLikeDrugLine(line)) continue;
    const parsed = parseDrugLine(line);
    if (!parsed.name || parsed.name.length < 2) continue;
    candidates.push({
      name: parsed.name,
      strength: parsed.strength,
      qty: parsed.qty,
      confidence: 0.5 // neutral baseline (Azure/Textract lines may carry real conf if you want to pass it through)
    });
  }

  // De-dupe near-identical names
  const seen = new Set();
  const items = [];
  for (const c of candidates) {
    const key = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(c);
  }

  return { items, engine: detailed.engine, raw: detailed.text };
}

/** Back-compat: old callers that expect just the string */
async function extractText(urlOrPath) {
  const { text } = await extractTextPlus(urlOrPath);
  return text;
}

module.exports = {
  extractText,
  extractTextPlus,
  extractTextPlusDetailed,
  extractPrescriptionItems
};
