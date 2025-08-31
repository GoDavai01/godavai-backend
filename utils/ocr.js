// utils/ocr.js

// Prefer Node's built-in fetch (Node 18+). Fallback to node-fetch only if installed.
const fetchFn =
  (globalThis.fetch && globalThis.fetch.bind(globalThis)) ||
  (async (...args) => {
    const { default: f } = await import('node-fetch'); // used only if you install node-fetch
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
  // local /uploads path served by your server
  const path = require("path");
  const fs = require("fs");
  return fs.promises.readFile(path.resolve(process.cwd(), urlOrPath.replace(/^\//, "")));
}

async function preprocess(buf) {
  // Mild denoise/contrast helps OCR a lot.
  return await sharp(buf)
    .ensureAlpha()
    .jpeg({ quality: 92 })
    .normalize()
    .toBuffer();
}

/** Google Vision OCR */
async function ocrGoogle(buf) {
  if (!visionClient) return null;
  const [result] = await visionClient.textDetection({ image: { content: buf } });
  const text = result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description;
  return text || null;
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

async function extractText(urlOrPath) {
  const raw = await loadBuffer(urlOrPath);
  const buf = await preprocess(raw);

  // Prefer cloud OCRs if configured
  let text = await ocrGoogle(buf);
  if (!text) text = await ocrTextract(buf);
  if (!text) text = await ocrTesseract(buf);

  return (text || "").trim();
}

module.exports = { extractText };
