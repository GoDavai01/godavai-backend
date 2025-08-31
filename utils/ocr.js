// utils/ocr.js

// Prefer Node 18+ fetch; fallback to node-fetch if present.
const fetchFn =
  (globalThis.fetch && globalThis.fetch.bind(globalThis)) ||
  (async (...args) => {
    const { default: f } = await import('node-fetch');
    return f(...args);
  });

const sharp = require("sharp");

let visionClient = null;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCV_CREDENTIALS_JSON) {
    const { ImageAnnotatorClient } = require("@google-cloud/vision");
    visionClient = process.env.GCV_CREDENTIALS_JSON
      ? new ImageAnnotatorClient({ credentials: JSON.parse(process.env.GCV_CREDENTIALS_JSON) })
      : new ImageAnnotatorClient();
  }
} catch { /* ignore */ }

let textractClient = null;
try {
  if (process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    const { TextractClient } = require("@aws-sdk/client-textract");
    textractClient = new TextractClient({ region: process.env.AWS_REGION });
  }
} catch { /* ignore */ }

async function loadBuffer(urlOrPath) {
  if (/^https?:\/\//i.test(urlOrPath)) {
    const res = await fetchFn(urlOrPath);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const path = require("path");
  const fs = require("fs");
  return fs.promises.readFile(path.resolve(process.cwd(), urlOrPath.replace(/^\//, "")));
}

// --- NEW: light MIME sniffing to avoid running PDFs/TIFFs through sharp ---
function sniffMime(buf) {
  const a = buf;
  // %PDF
  if (a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46) return "application/pdf";
  // TIFF (II*\0 | MM\0*)
  if ((a[0] === 0x49 && a[1] === 0x49 && a[2] === 0x2A && a[3] === 0x00) ||
      (a[0] === 0x4D && a[1] === 0x4D && a[2] === 0x00 && a[3] === 0x2A)) return "image/tiff";
  return "image";
}

async function preprocess(buf) {
  const kind = sniffMime(buf);
  // PDFs/TIFFs must be sent as-is to the engines that support them.
  if (kind !== "image") return buf;
  try {
    return await sharp(buf)
      .rotate()                 // auto-orient
      .jpeg({ quality: 92 })
      .normalize()
      .toBuffer();
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] preprocess skipped:", e.message);
    return buf; // never fail preprocessing
  }
}

/** Google Vision OCR */
async function ocrGoogle(buf) {
  if (!visionClient) return null;
  // Better for dense/handwritten docs:
  const [result] = await visionClient.documentTextDetection({ image: { content: buf } });
  const text = result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description;
  return text || null;
}

/** Azure Vision Read OCR (REST, v3.2) */
async function ocrAzure(buf) {
  const ep = (process.env.AZURE_VISION_ENDPOINT || "").replace(/\/+$/, "");
  const key = process.env.AZURE_VISION_KEY;
  if (!ep || !key) return null;

  // 1) submit
  const submit = await fetchFn(`${ep}/vision/v3.2/read/analyze?language=unk`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/octet-stream" },
    body: buf
  });
  if (submit.status !== 202) return null;

  const op = submit.headers.get("operation-location");
  if (!op) return null;

  // 2) poll
  for (let i = 0; i < 18; i++) { // give a bit more time for PDFs
    await new Promise(r => setTimeout(r, 800));
    const res = await fetchFn(op, { headers: { "Ocp-Apim-Subscription-Key": key } });
    const j = await res.json();
    if (j.status === "succeeded") {
      const lines =
        j?.analyzeResult?.readResults?.flatMap(p => (p.lines || []).map(l => l.text)) ??
        j?.analyzeResult?.pages?.flatMap(p => (p.lines || []).map(l => l.content)) ?? [];
      return lines && lines.length ? lines.join("\n") : null;
    }
    if (j.status === "failed") return null;
  }
  return null;
}

/** AWS Textract OCR (simple lines) */
async function ocrTextract(buf) {
  if (!textractClient) return null;
  const { DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
  const out = await textractClient.send(new DetectDocumentTextCommand({ Document: { Bytes: buf } }));
  const lines = (out?.Blocks || [])
    .filter(b => b.BlockType === "LINE")
    .map(b => b.Text)
    .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

/** Local Tesseract OCR (fallback) */
async function ocrTesseract(buf) {
  const { createWorker } = require("tesseract.js");
  const worker = await createWorker({ logger: () => {} });
  try {
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const { data } = await worker.recognize(buf);
    return data?.text || null;
  } finally {
    await worker.terminate();
  }
}

/** New: returns { text, engine } */
async function extractTextPlus(urlOrPath) {
  const raw = await loadBuffer(urlOrPath);
  const buf = await preprocess(raw);

  // Order: Google → Azure → Textract → Tesseract
  let text = await ocrGoogle(buf);
  if (text) return { text: text.trim(), engine: "google-vision" };

  text = await ocrAzure(buf);
  if (text) return { text: text.trim(), engine: "azure-vision-read" };

  text = await ocrTextract(buf);
  if (text) return { text: text.trim(), engine: "aws-textract" };

  text = await ocrTesseract(buf);
  if (text) return { text: text.trim(), engine: "tesseract" };

  return { text: "", engine: "none" };
}

/** Back-compat: old callers that expect just the string */
async function extractText(urlOrPath) {
  const { text } = await extractTextPlus(urlOrPath);
  return text;
}

module.exports = { extractText, extractTextPlus };
