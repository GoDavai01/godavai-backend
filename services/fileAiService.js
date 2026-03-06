const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const zlib = require("zlib");
const { extractTextPlus, extractPrescriptionItems } = require("../utils/ocr");
const { parse: parseMeds } = require("../utils/ai/medParser");
const { generateAssistantReply } = require("./aiService");

const TMP_DIR = path.join(process.cwd(), "uploads", "ai-temp");
const FILES_DIR = path.join(process.cwd(), "uploads", "ai-files");
let resolvedTmpDir = null;
let resolvedFilesDir = null;
let cachedOpenAI = null;

function getOpenAIClient() {
  if (cachedOpenAI) return cachedOpenAI;
  if (!process.env.OPENAI_API_KEY) return null;
  let OpenAI = require("openai");
  OpenAI = OpenAI?.default || OpenAI;
  cachedOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cachedOpenAI;
}

function ensureTmpDir() {
  if (resolvedTmpDir && resolvedFilesDir) return;
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.mkdirSync(FILES_DIR, { recursive: true });
    resolvedTmpDir = TMP_DIR;
    resolvedFilesDir = FILES_DIR;
    return;
  } catch (_) {
    const base = path.join(os.tmpdir(), "godavaii-ai");
    const tmp = path.join(base, "temp");
    const files = path.join(base, "files");
    fs.mkdirSync(tmp, { recursive: true });
    fs.mkdirSync(files, { recursive: true });
    resolvedTmpDir = tmp;
    resolvedFilesDir = files;
  }
}

function normalizeFocus(message, focus) {
  const forced = String(focus || "").toLowerCase();
  if (forced && forced !== "auto") return forced;
  const src = String(message || "").toLowerCase();
  if (/(report|cbc|lipid|tsh|vitamin|platelet|hba1c|creatinine)/.test(src)) return "lab";
  if (/(prescription|rx|dose|tablet|capsule|bd|tid|od)/.test(src)) return "rx";
  if (/(medicine|drug|dawai|paracetamol|azithromycin)/.test(src)) return "medicine";
  return "symptom";
}

function fileKind(file) {
  const mime = String(file?.mimetype || "").toLowerCase();
  const ext = path.extname(String(file?.originalname || "")).toLowerCase();
  const image = mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
  const pdf = mime === "application/pdf" || ext === ".pdf";
  const text = mime.startsWith("text/") || [".txt", ".csv", ".md"].includes(ext);
  return { image, pdf, text, mime, ext };
}

async function withTempFile(file, fn) {
  ensureTmpDir();
  const ext = path.extname(file.originalname || "") || ".bin";
  const name = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`;
  const p = path.join(resolvedTmpDir, name);
  await fs.promises.writeFile(p, file.buffer);
  try {
    return await fn(p);
  } finally {
    fs.promises.unlink(p).catch(() => {});
  }
}

async function persistUploadedFile(file) {
  ensureTmpDir();
  const safeBase = path.basename(file.originalname || "upload.bin").replace(/[^\w.\-]/g, "_");
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const abs = path.join(resolvedFilesDir, `${stamp}-${safeBase}`);
  await fs.promises.writeFile(abs, file.buffer);
  const rel = abs.startsWith(process.cwd())
    ? `/${path.relative(process.cwd(), abs).replace(/\\/g, "/")}`
    : "";
  return {
    absPath: abs,
    relativePath: rel || abs,
  };
}

function parseCsvToObjects(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => { row[h || `col${i + 1}`] = cols[i] || ""; });
    return row;
  });
}

function parseLabMarkers(text) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length < 4) continue;

    const m = line.match(/^([A-Za-z][A-Za-z0-9()/%\s\-\._]{1,45})\s*[:\-]?\s*([<>]?\d+(?:\.\d+)?)\s*([A-Za-z/%]+)?(?:\s*\(?\s*(\d+(?:\.\d+)?)\s*[-to]+\s*(\d+(?:\.\d+)?)\s*\)?)?/i);
    if (!m) continue;

    const marker = m[1].trim();
    const value = Number(m[2]);
    const unit = (m[3] || "").trim();
    const low = m[4] ? Number(m[4]) : null;
    const high = m[5] ? Number(m[5]) : null;

    let flag = "normal";
    if (Number.isFinite(value) && Number.isFinite(low) && value < low) flag = "low";
    if (Number.isFinite(value) && Number.isFinite(high) && value > high) flag = "high";

    rows.push({ marker, value, unit, range: low != null && high != null ? `${low}-${high}` : "", flag });
  }
  return rows.slice(0, 80);
}

function buildLabSummary(markers) {
  const rows = Array.isArray(markers) ? markers : [];
  if (!rows.length) return "";
  const top = rows.slice(0, 12);
  const lines = top.map((r) => {
    const val = Number.isFinite(r.value) ? r.value : r.value;
    const unit = r.unit ? ` ${r.unit}` : "";
    const range = r.range ? ` (range ${r.range})` : "";
    const tag = r.flag && r.flag !== "normal" ? ` -> ${String(r.flag).toUpperCase()}` : "";
    return `- ${r.marker}: ${val}${unit}${range}${tag}`;
  });
  return ["Lab markers parsed from report:", ...lines].join("\n");
}

function buildRxSummary(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "";
  const top = rows.slice(0, 12);
  const lines = top.map((r) => {
    const strength = r.strength ? ` ${r.strength}` : "";
    const form = r.form ? ` (${r.form})` : "";
    const qty = r.qty ? ` qty:${r.qty}` : "";
    return `- ${r.name || "unknown"}${strength}${form}${qty}`;
  });
  return ["Prescription items parsed:", ...lines].join("\n");
}

function extractPdfTextHeuristic(buffer) {
  try {
    const src = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    const out = [];

    const rawAscii = src.toString("latin1");
    const rawHits = rawAscii.match(/\(([^()]{2,200})\)\s*Tj/g) || [];
    for (const hit of rawHits) {
      const t = hit.replace(/\)\s*Tj$/, "").replace(/^\(/, "");
      out.push(t);
    }

    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m;
    while ((m = streamRegex.exec(rawAscii)) !== null) {
      const chunk = Buffer.from(m[1], "latin1");
      try {
        const inflated = zlib.inflateSync(chunk);
        const txt = inflated.toString("latin1");
        const hits = txt.match(/\(([^()]{2,200})\)\s*Tj/g) || [];
        for (const h of hits) {
          const t = h.replace(/\)\s*Tj$/, "").replace(/^\(/, "");
          out.push(t);
        }
      } catch (_) {
        // ignore non-deflated streams
      }
    }

    return out.join("\n").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ").replace(/\s{2,}/g, " ").trim();
  } catch (_) {
    return "";
  }
}

async function ocrImageWithOpenAI(buffer, mime) {
  const client = getOpenAIClient();
  if (!client) return "";
  try {
    const model = process.env.AI_OCR_MODEL || "gpt-4o-mini";
    const b64 = buffer.toString("base64");
    const dataUrl = `data:${mime || "image/png"};base64,${b64}`;
    const out = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "Extract all visible medical text exactly. Keep line breaks. Do not summarize.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this medical image and return plain extracted text only." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 1800,
    });
    return String(out?.choices?.[0]?.message?.content || "").trim();
  } catch (err) {
    return "";
  }
}

async function extractPdfViaImageFallback(buffer) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch (_) {
    return "";
  }

  for (let page = 0; page < 3; page += 1) {
    try {
      const img = await sharp(buffer, { density: 220, page })
        .png({ quality: 100 })
        .toBuffer();
      const text = await ocrImageWithOpenAI(img, "image/png");
      if (text && text.length > 20) return text;
    } catch (_) {
      // try next page or exit
    }
  }
  return "";
}

async function extractTextAndParsed(file, mode) {
  const kind = fileKind(file);
  let extractedText = "";
  const parsed = {};
  const debugErrors = [];

  if (kind.text) {
    extractedText = file.buffer.toString("utf8");
    if (kind.ext === ".csv") parsed.csv = parseCsvToObjects(extractedText).slice(0, 120);
  } else if (kind.image || kind.pdf) {
    try {
      const ocr = await withTempFile(file, async (p) => extractTextPlus(p));
      extractedText = String(ocr?.text || "");
    } catch (err) {
      debugErrors.push(`ocr_text_failed:${err?.message || "unknown"}`);
      extractedText = "";
    }

    if (mode === "rx" || mode === "medicine") {
      try {
        const ocrItems = await withTempFile(file, async (p) => extractPrescriptionItems(p));
        parsed.rxItems = Array.isArray(ocrItems?.items) ? ocrItems.items : [];
        parsed.ocrEngine = ocrItems?.engine || "";
      } catch (err) {
        debugErrors.push(`ocr_rx_failed:${err?.message || "unknown"}`);
      }
    }

    // Strong fallback for images when local OCR engines fail.
    if (!extractedText && kind.image) {
      const viaOpenAI = await ocrImageWithOpenAI(file.buffer, kind.mime || "image/png");
      if (viaOpenAI) {
        extractedText = viaOpenAI;
        parsed.ocrEngine = parsed.ocrEngine || "openai-image-ocr";
      }
    }

    // Fallback for text-based PDFs.
    if (!extractedText && kind.pdf) {
      const pdfText = extractPdfTextHeuristic(file.buffer);
      if (pdfText) {
        extractedText = pdfText;
        parsed.ocrEngine = parsed.ocrEngine || "pdf-heuristic-text";
      }
    }

    // Fallback for scanned PDFs: render page(s) to image then OCR.
    if (!extractedText && kind.pdf) {
      const viaImage = await extractPdfViaImageFallback(file.buffer);
      if (viaImage) {
        extractedText = viaImage;
        parsed.ocrEngine = parsed.ocrEngine || "pdf-image-ocr-fallback";
      }
    }
  } else {
    try {
      extractedText = file.buffer.toString("utf8");
    } catch (err) {
      debugErrors.push(`buffer_to_text_failed:${err?.message || "unknown"}`);
      extractedText = "";
    }
  }

  if ((mode === "rx" || mode === "medicine") && !parsed.rxItems?.length && extractedText) {
    const meds = parseMeds(extractedText).map((m) => ({
      name: m.name,
      strength: m.strength || "",
      form: m.form || "",
      qty: m.quantity || 1,
      confidence: m.confidence || 0.6,
    }));
    parsed.rxItems = meds;
  }

  if (mode === "lab" && extractedText) {
    parsed.labMarkers = parseLabMarkers(extractedText);
  }

  return {
    extractedText: String(extractedText || "").slice(0, 30000),
    parsed: {
      mode,
      fileType: kind.mime || kind.ext || "unknown",
      debug: debugErrors.slice(0, 5),
      ...parsed,
    },
  };
}

async function analyzeFileForAssistant({ file, message, history, context, userId }) {
  const persisted = await persistUploadedFile(file);
  const mode = normalizeFocus(message, context?.focus);
  const { extractedText, parsed } = await extractTextAndParsed(file, mode);

  const textPreview = extractedText ? extractedText.slice(0, 8000) : "";
  const parsedSummary =
    mode === "lab"
      ? buildLabSummary(parsed.labMarkers)
      : (mode === "rx" || mode === "medicine")
        ? buildRxSummary(parsed.rxItems)
        : "";
  const mergedMessage = [
    String(message || "").trim() || "Please analyze this uploaded medical file.",
    parsedSummary ? `\n\n${parsedSummary}` : "",
    textPreview ? `\n\nFile Extracted Text:\n${textPreview}` : "\n\nNo extractable text was found in the file.",
  ].join("");

  const ai = await generateAssistantReply({
    message: mergedMessage,
    history,
    context: { ...context, focus: mode },
    userId,
    attachment: {
      name: file?.originalname || "",
      url: persisted.relativePath,
      type: file?.mimetype || "",
      extractedText: extractedText.slice(0, 12000),
    },
  });

  return {
    reply: ai.reply,
    sessionId: ai.sessionId,
    parsed: {
      ...parsed,
      storedFileUrl: persisted.relativePath,
      extractedTextPreview: textPreview.slice(0, 1200),
    },
  };
}

module.exports = {
  analyzeFileForAssistant,
};
