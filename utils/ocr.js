// utils/ocr.js

// Prefer Node 18+ fetch; fallback to node-fetch if present.
const fetchFn =
  (globalThis.fetch && globalThis.fetch.bind(globalThis)) ||
  (async (...args) => {
    const { default: f } = await import("node-fetch");
    return f(...args);
  });

// small helper to always send a UA (some CDNs block no-UA requests)
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
    visionClient = process.env.GCV_CREDENTIALS_JSON
      ? new ImageAnnotatorClient({ credentials: JSON.parse(process.env.GCV_CREDENTIALS_JSON) })
      : new ImageAnnotatorClient();
  }
} catch {
  /* ignore */
}

let textractClient = null;
try {
  if (process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
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
  // %PDF
  if (a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46)
    return "application/pdf";
  // TIFF (II*\0 | MM\0*)
  if (
    (a[0] === 0x49 && a[1] === 0x49 && a[2] === 0x2a && a[3] === 0x00) ||
    (a[0] === 0x4d && a[1] === 0x4d && a[2] === 0x00 && a[3] === 0x2a)
  )
    return "image/tiff";
  return "image";
}

async function preprocess(buf) {
  const kind = sniffMime(buf);
  // PDFs/TIFFs must be sent as-is to engines that support them.
  if (kind !== "image") return buf;
  try {
    return await sharp(buf).rotate().jpeg({ quality: 92 }).normalize().toBuffer();
  } catch (e) {
    if (process.env.DEBUG_OCR)
      console.warn("[OCR] preprocess skipped:", e.message);
    return buf; // never fail preprocessing
  }
}

/* ------------------------------ Engines ---------------------------------- */

/** Google Vision OCR (with tiny retry) */
async function ocrGoogle(buf) {
  if (!visionClient) return null;
  for (let i = 0; i < 2; i++) {
    try {
      const [result] = await visionClient.documentTextDetection({
        image: { content: buf },
      });
      const text =
        result?.fullTextAnnotation?.text ||
        result?.textAnnotations?.[0]?.description;
      if (text) return text;
    } catch (err) {
      if (process.env.DEBUG_OCR)
        console.warn(
          "[OCR] google-vision attempt failed:",
          err?.message || err
        );
    }
  }
  return null;
}

/** Azure Vision Read OCR (REST, v3.2) — longer poll for PDFs/handwriting */
async function ocrAzure(buf) {
  const ep = (process.env.AZURE_VISION_ENDPOINT || "").replace(/\/+$/, "");
  const key = process.env.AZURE_VISION_KEY;
  if (!ep || !key) return null;

  // 1) submit
  const submit = await fetchWithUA(`${ep}/vision/v3.2/read/analyze?language=unk`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/octet-stream",
    },
    body: buf,
  });
  if (submit.status !== 202) return null;

  const op = submit.headers.get("operation-location");
  if (!op) return null;

  // 2) poll (wait ~22s max: 28 * 800ms)
  for (let i = 0; i < 28; i++) {
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetchWithUA(op, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    const j = await res.json();
    if (j.status === "succeeded") {
      const lines =
        j?.analyzeResult?.readResults?.flatMap((p) =>
          (p.lines || []).map((l) => l.text)
        ) ??
        j?.analyzeResult?.pages?.flatMap((p) =>
          (p.lines || []).map((l) => l.content)
        ) ??
        [];
      return lines && lines.length ? lines.join("\n") : null;
    }
    if (j.status === "failed") return null;
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
    .map((b) => b.Text)
    .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
  } catch (e) {
    if (process.env.DEBUG_OCR) {
        console.warn("[OCR] textract failed:", e?.message || e);
        }
        return null; // <- DO NOT throw; let the pipeline continue
        }
}

/** Local Tesseract OCR (fallback, optional & safe) */
async function ocrTesseract(buf) {
  let createWorker;
  try {
    ({ createWorker } = require("tesseract.js"));
  } catch (e) {
    if (process.env.DEBUG_OCR)
      console.warn("[OCR] tesseract.js not installed:", e.message);
    return null;
  }

  const worker = await createWorker({ logger: () => {} });
  try {
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const { data } = await worker.recognize(buf);
    return data?.text || null;
  } catch (e) {
    if (process.env.DEBUG_OCR)
      console.warn("[OCR] tesseract run failed:", e.message);
    return null;
  } finally {
    try {
      await worker.terminate();
    } catch {}
  }
}

/* --------------------------- Public functions ---------------------------- */

/** Returns { text, engine } */
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

  const t = await ocrTesseract(buf);
  if (t) return { text: t.trim(), engine: "tesseract" };

  if (process.env.DEBUG_OCR)
    console.warn("[OCR] all engines returned null/empty");
  return { text: "", engine: "none" };
}

/** Back-compat: old callers that expect just the string */
async function extractText(urlOrPath) {
  const { text } = await extractTextPlus(urlOrPath);
  return text;
}

module.exports = { extractText, extractTextPlus };
