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
let cachedPdfParse = null;

function getOpenAIClient() {
  if (cachedOpenAI) return cachedOpenAI;
  if (!process.env.OPENAI_API_KEY) return null;
  let OpenAI = require("openai");
  OpenAI = OpenAI?.default || OpenAI;
  cachedOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cachedOpenAI;
}

function getPdfParse() {
  if (cachedPdfParse) return cachedPdfParse;
  try {
    cachedPdfParse = require("pdf-parse");
    return cachedPdfParse;
  } catch (_) {
    return null;
  }
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

  if (/(prescription|rx|dose|tablet|capsule|bd|tid|od)/.test(src)) return "rx";
  if (/(medicine|drug|dawai|paracetamol|azithromycin|tramadol|amoxicillin|pantoprazole)/.test(src)) return "medicine";
  if (/(report|cbc|lipid|tsh|vitamin|platelet|hba1c|creatinine|hemoglobin|wbc|rbc|uric acid|bilirubin|sgpt|sgot)/.test(src)) return "lab";
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
    headers.forEach((h, i) => {
      row[h || `col${i + 1}`] = cols[i] || "";
    });
    return row;
  });
}

function normalizeExtractedText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

function parseRangeFromText(str) {
  const s = String(str || "").replace(/,/g, "").trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(-?\d+(?:\.\d+)?)/i);
  if (!m) return { low: null, high: null };
  return { low: Number(m[1]), high: Number(m[2]) };
}

function inferFlag(value, low, high, rawLine) {
  const line = String(rawLine || "").toLowerCase();

  if (/\b(low|below normal|decreased)\b/.test(line)) return "low";
  if (/\b(high|raised|elevated|above normal)\b/.test(line)) return "high";
  if (/\b(borderline)\b/.test(line)) return "borderline";

  if (Number.isFinite(value) && Number.isFinite(low) && value < low) return "low";
  if (Number.isFinite(value) && Number.isFinite(high) && value > high) return "high";
  if (Number.isFinite(value) && Number.isFinite(low) && Number.isFinite(high)) {
    const span = Math.abs(high - low);
    if (span > 0) {
      const nearLow = value >= low && value <= low + span * 0.08;
      const nearHigh = value <= high && value >= high - span * 0.08;
      if (nearLow || nearHigh) return "borderline";
    }
  }

  return "normal";
}

function cleanMarkerName(name) {
  return String(name || "")
    .replace(/\s{2,}/g, " ")
    .replace(/[:\-]+$/, "")
    .trim();
}

function parseLabMarkers(text) {
  const src = normalizeExtractedText(text);
  const lines = src.split(/\n/);
  const rows = [];

  const markerHints = [
    "hemoglobin", "hb", "wbc", "rbc", "platelet", "platelets", "pcv", "hct", "mcv", "mch", "mchc",
    "neutrophils", "lymphocytes", "monocytes", "eosinophils", "basophils", "esr",
    "glucose", "sugar", "hba1c", "creatinine", "urea", "bun", "uric acid",
    "bilirubin", "sgpt", "sgot", "alt", "ast", "alkaline phosphatase", "albumin",
    "cholesterol", "triglycerides", "hdl", "ldl", "vldl",
    "tsh", "t3", "t4", "vitamin d", "vitamin b12", "ferritin", "iron", "calcium",
    "sodium", "potassium", "chloride", "crp"
  ];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length < 4) continue;

    const lower = line.toLowerCase();
    const looksRelevant = markerHints.some((h) => lower.includes(h));
    const numberHits = line.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) || [];
    if (!looksRelevant && numberHits.length === 0) continue;

    const leftRight = line.match(/^(.{2,70}?)\s{1,}([<>]?\d+(?:,\d{3})*(?:\.\d+)?)\s*([A-Za-z/%][A-Za-z0-9/%\-\s\.]*)?(.*)$/);
    const colonStyle = line.match(/^(.{2,70}?)\s*[:\-]\s*([<>]?\d+(?:,\d{3})*(?:\.\d+)?)\s*([A-Za-z/%][A-Za-z0-9/%\-\s\.]*)?(.*)$/);

    const m = leftRight || colonStyle;
    if (!m) continue;

    const marker = cleanMarkerName(m[1]);
    const value = Number(String(m[2]).replace(/,/g, ""));
    const unit = String(m[3] || "").trim();
    const tail = String(m[4] || "").trim();

    if (!marker || !Number.isFinite(value)) continue;

    const { low, high } = parseRangeFromText(tail || line);
    const flag = inferFlag(value, low, high, line);

    rows.push({
      marker,
      value,
      unit,
      range: Number.isFinite(low) && Number.isFinite(high) ? `${low}-${high}` : "",
      flag,
    });
  }

  const deduped = [];
  const seen = new Set();

  for (const row of rows) {
    const key = `${row.marker.toLowerCase()}|${row.value}|${row.unit}|${row.range}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped.slice(0, 120);
}

function buildLabSummary(markers) {
  const rows = Array.isArray(markers) ? markers : [];
  if (!rows.length) return "";

  const top = rows.slice(0, 20);
  const lines = top.map((r) => {
    const val = Number.isFinite(r.value) ? r.value : r.value;
    const unit = r.unit ? ` ${r.unit}` : "";
    const range = r.range ? ` (range ${r.range})` : "";
    const tag = r.flag && r.flag !== "normal" ? ` -> ${String(r.flag).toUpperCase()}` : "";
    return `- ${r.marker}: ${val}${unit}${range}${tag}`;
  });

  return [
    "Parsed values from uploaded file:",
    ...lines,
    "",
    "Explain these in simple language.",
    "Prioritize clearly abnormal and borderline values.",
    "If something is mild, say it calmly.",
    "Do not invent values that are not visible.",
  ].join("\n");
}

function buildRxSummary(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return "";

  const top = rows.slice(0, 15);
  const lines = top.map((r) => {
    const strength = r.strength ? ` ${r.strength}` : "";
    const form = r.form ? ` (${r.form})` : "";
    const qty = r.qty ? ` qty:${r.qty}` : "";
    return `- ${r.name || "unknown"}${strength}${form}${qty}`;
  });

  return [
    "Parsed medicine details from uploaded file:",
    ...lines,
    "",
    "Explain visible medicine names, timing if visible, common use, common side effects, and one useful caution.",
    "If something is unclear, say not clearly visible.",
  ].join("\n");
}

function extractPdfTextHeuristic(buffer) {
  try {
    const src = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    const out = [];
    const rawAscii = src.toString("latin1");

    const rawHits = rawAscii.match(/\(([^()]{2,300})\)\s*Tj/g) || [];
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
        const hits = txt.match(/\(([^()]{2,300})\)\s*Tj/g) || [];
        for (const h of hits) {
          const t = h.replace(/\)\s*Tj$/, "").replace(/^\(/, "");
          out.push(t);
        }
      } catch (_) {
        // ignore
      }
    }

    return normalizeExtractedText(
      out.join("\n").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    );
  } catch (_) {
    return "";
  }
}

async function extractPdfTextWithPdfParse(buffer) {
  const pdfParse = getPdfParse();
  if (!pdfParse) return "";

  try {
    const data = await pdfParse(buffer);
    return normalizeExtractedText(data?.text || "");
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
          content: [
            "Extract all visible medical text as accurately as possible.",
            "Preserve rows, values, units, and reference ranges.",
            "Do not summarize.",
            "Return only plain text.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this medical image very carefully and return extracted plain text only." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 2200,
    });

    return normalizeExtractedText(out?.choices?.[0]?.message?.content || "");
  } catch (_) {
    return "";
  }
}

async function extractPdfViaImageFallback(buffer, debugErrors) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    debugErrors.push(`sharp_missing:${err?.message || "unknown"}`);
    return "";
  }

  let combined = "";

  for (let page = 0; page < 3; page += 1) {
    try {
      const img = await sharp(buffer, { density: 240, page })
        .flatten({ background: "#ffffff" })
        .png({ quality: 100 })
        .toBuffer();

      const text = await ocrImageWithOpenAI(img, "image/png");
      if (text && text.length > 20) {
        combined += `${combined ? "\n\n" : ""}--- Page ${page + 1} ---\n${text}`;
      }
    } catch (err) {
      debugErrors.push(`pdf_image_fallback_failed_page_${page + 1}:${err?.message || "unknown"}`);
    }
  }

  return normalizeExtractedText(combined);
}

function inferModeFromContent(message, extractedText, parsed) {
  const src = `${message || ""}\n${extractedText || ""}`.toLowerCase();

  if (parsed?.rxItems?.length) return "rx";
  if (parsed?.labMarkers?.length) return "lab";

  if (/(hemoglobin|hb|wbc|rbc|platelet|hba1c|creatinine|tsh|cholesterol|triglycerides|bilirubin|sgpt|sgot|cbc)/.test(src)) {
    return "lab";
  }
  if (/(tablet|capsule|syrup|take|once daily|twice daily|od|bd|tid|tramadol|paracetamol|amoxicillin)/.test(src)) {
    return "rx";
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
      extractedText = normalizeExtractedText(ocr?.text || "");
      if (extractedText) parsed.ocrEngine = parsed.ocrEngine || "local-ocr";
    } catch (err) {
      debugErrors.push(`ocr_text_failed:${err?.message || "unknown"}`);
      extractedText = "";
    }

    if (!extractedText && kind.pdf) {
      const pdfText = await extractPdfTextWithPdfParse(file.buffer);
      if (pdfText) {
        extractedText = pdfText;
        parsed.ocrEngine = parsed.ocrEngine || "pdf-parse";
      } else {
        debugErrors.push("pdf_parse_empty");
      }
    }

    if (!extractedText && kind.pdf) {
      const pdfTextHeuristic = extractPdfTextHeuristic(file.buffer);
      if (pdfTextHeuristic) {
        extractedText = pdfTextHeuristic;
        parsed.ocrEngine = parsed.ocrEngine || "pdf-heuristic-text";
      } else {
        debugErrors.push("pdf_heuristic_empty");
      }
    }

    if (!extractedText && kind.image) {
      const viaOpenAI = await ocrImageWithOpenAI(file.buffer, kind.mime || "image/png");
      if (viaOpenAI) {
        extractedText = viaOpenAI;
        parsed.ocrEngine = parsed.ocrEngine || "openai-image-ocr";
      } else {
        debugErrors.push("openai_image_ocr_empty");
      }
    }

    if (!extractedText && kind.pdf) {
      const viaImage = await extractPdfViaImageFallback(file.buffer, debugErrors);
      if (viaImage) {
        extractedText = viaImage;
        parsed.ocrEngine = parsed.ocrEngine || "pdf-image-ocr-fallback";
      }
    }

    if ((mode === "rx" || mode === "medicine") && !parsed.rxItems?.length) {
      try {
        const ocrItems = await withTempFile(file, async (p) => extractPrescriptionItems(p));
        parsed.rxItems = Array.isArray(ocrItems?.items) ? ocrItems.items : [];
        if (parsed.rxItems.length) {
          parsed.ocrEngine = parsed.ocrEngine || ocrItems?.engine || "prescription-item-parser";
        }
      } catch (err) {
        debugErrors.push(`ocr_rx_failed:${err?.message || "unknown"}`);
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

  extractedText = normalizeExtractedText(extractedText);

  if (!parsed.rxItems?.length && extractedText) {
    const meds = parseMeds(extractedText).map((m) => ({
      name: m.name,
      strength: m.strength || "",
      form: m.form || "",
      qty: m.quantity || 1,
      confidence: m.confidence || 0.6,
    }));
    if (meds.length) parsed.rxItems = meds;
  }

  parsed.labMarkers = extractedText ? parseLabMarkers(extractedText) : [];

  const inferred = inferModeFromContent("", extractedText, parsed);
  if (mode === "symptom" && inferred) {
    mode = inferred;
  }

  return {
    extractedText: String(extractedText || "").slice(0, 30000),
    parsed: {
      mode,
      fileType: kind.mime || kind.ext || "unknown",
      debug: debugErrors.slice(0, 10),
      ...parsed,
    },
  };
}

function buildModeInstructions(mode) {
  if (mode === "lab") {
    return [
      "User uploaded a medical file and wants a clear explanation.",
      "Explain important visible values in simple language.",
      "Say whether values appear low, high, borderline, or normal where visible.",
      "Do not ask for values again if visible text is already extracted.",
      "If some values are missing, mention they are not clearly visible.",
    ].join("\n");
  }

  if (mode === "rx") {
    return [
      "User uploaded a medical file and wants medicine/prescription explanation.",
      "Explain medicine name, visible dosage/timing, common use, common side effects, and one practical caution if identifiable.",
      "Do not invent unclear fields.",
    ].join("\n");
  }

  if (mode === "medicine") {
    return [
      "User wants medicine understanding from uploaded file.",
      "Explain common use, common side effects, and practical cautions.",
      "Do not invent dosage if not visible.",
    ].join("\n");
  }

  return [
    "User uploaded a medical file.",
    "Read the extracted content carefully and explain what is visible in simple language.",
    "If the file looks like a report or prescription, respond accordingly.",
  ].join("\n");
}

async function analyzeFileForAssistant({ file, message, history, context, userId }) {
  const persisted = await persistUploadedFile(file);
  let mode = normalizeFocus(message, context?.focus);

  const { extractedText, parsed } = await extractTextAndParsed(file, mode);
  if (parsed?.mode && parsed.mode !== mode) {
    mode = parsed.mode;
  }

  const textPreview = extractedText ? extractedText.slice(0, 10000) : "";
  const parsedSummary =
    mode === "lab"
      ? buildLabSummary(parsed.labMarkers)
      : (mode === "rx" || mode === "medicine")
        ? buildRxSummary(parsed.rxItems)
        : "";

  const mergedMessage = [
    String(message || "").trim() || "Please read and explain this uploaded medical file.",
    "",
    buildModeInstructions(mode),
    parsedSummary ? `\n\n${parsedSummary}` : "",
    textPreview ? `\n\nFile Extracted Text:\n${textPreview}` : "\n\nNo extractable text was found in the file.",
    parsed?.debug?.length ? `\n\nDebug info:\n${parsed.debug.map((d) => `- ${d}`).join("\n")}` : "",
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
      extractedTextPreview: textPreview.slice(0, 1500),
    },
  };
}

module.exports = {
  analyzeFileForAssistant,
};