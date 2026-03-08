const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const zlib = require("zlib");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { extractTextPlus, extractPrescriptionItems } = require("../utils/ocr");
const { parse: parseMeds } = require("../utils/ai/medParser");
const { generateAssistantReply } = require("./aiService");

const execFileAsync = promisify(execFile);

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

  if (/(xray|x-ray|x ray|ct scan|mri|ultrasound|sonography|scan report|chest pa|lateral view)/.test(src)) {
    return "xray";
  }
  if (/(report|cbc|lipid|tsh|vitamin|platelet|hba1c|creatinine|hemoglobin|wbc|rbc|uric acid|bilirubin|sgpt|sgot|lab report|blood test)/.test(src)) {
    return "lab";
  }
  if (/(prescription|rx|dose|tablet|capsule|bd|tid|od|syrup|tab|cap)/.test(src)) {
    return "rx";
  }
  if (/(medicine|drug|dawai|paracetamol|azithromycin|tramadol|amoxicillin|pantoprazole)/.test(src)) {
    return "medicine";
  }

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

/* ─────────────────────────────────────────────────────────────
   FIX #1: Improved parseLabMarkers with QUALITY CHECKS
   - Requires marker names to have real alphabetic content
   - Rejects garbage OCR noise like /0@#A, X7, 5=$#
   - If most markers look bad, returns empty (forces GPT fallback)
   ───────────────────────────────────────────────────────────── */
function isValidMarkerName(name) {
  const cleaned = String(name || "").trim();
  if (cleaned.length < 2) return false;

  // Count alphabetic characters
  const alphaChars = (cleaned.match(/[a-zA-Z]/g) || []).length;
  const totalChars = cleaned.replace(/\s/g, "").length;

  // Must have at least 2 alpha chars and at least 40% of name must be letters
  if (alphaChars < 2) return false;
  if (totalChars > 0 && alphaChars / totalChars < 0.4) return false;

  // Reject names that are mostly special characters
  const specialCount = (cleaned.match(/[^a-zA-Z0-9\s\-\.\/()]/g) || []).length;
  if (specialCount > alphaChars) return false;

  // Known valid lab marker substrings (at least one should match for confidence)
  const knownPatterns = [
    /hemoglobin|hb\b|wbc|rbc|platelet|pcv|hct|mcv|mch\b|mchc/i,
    /neutrophil|lymphocyte|monocyte|eosinophil|basophil|esr\b/i,
    /glucose|sugar|fasting|hba1c|creatinine|urea|bun\b|uric/i,
    /bilirubin|sgpt|sgot|alt\b|ast\b|alkaline|albumin|globulin/i,
    /cholesterol|triglyceride|hdl\b|ldl\b|vldl/i,
    /tsh\b|t3\b|t4\b|vitamin|ferritin|iron\b|calcium/i,
    /sodium|potassium|chloride|crp\b|phosph/i,
    /protein|blood|serum|plasma|urine|count|total|diff/i,
    /liver|kidney|thyroid|lipid|panel|profile|test/i,
    /magnesium|zinc|folate|folic|b12|d3\b|copper/i,
  ];

  // If it matches a known pattern, it's very likely valid
  for (const p of knownPatterns) {
    if (p.test(cleaned)) return true;
  }

  // If name is short (< 4 chars) and doesn't match known patterns, reject
  if (alphaChars < 4) return false;

  return true;
}

function parseLabMarkers(text) {
  const src = normalizeExtractedText(text);
  const lines = src.split(/\r?\n/);

  const markerHints = [
    "hemoglobin", "hb", "wbc", "rbc", "platelet", "platelets", "pcv", "hct", "mcv", "mch", "mchc",
    "neutrophils", "lymphocytes", "monocytes", "eosinophils", "basophils", "esr",
    "glucose", "sugar", "fasting", "pp", "hba1c", "creatinine", "urea", "bun", "uric acid",
    "bilirubin", "sgpt", "sgot", "alt", "ast", "alkaline phosphatase", "albumin", "globulin",
    "cholesterol", "triglycerides", "hdl", "ldl", "vldl",
    "tsh", "t3", "t4", "vitamin d", "vitamin b12", "ferritin", "iron", "calcium",
    "sodium", "potassium", "chloride", "crp"
  ];

  function cleanMarkerName(name) {
    return String(name || "")
      .replace(/\s{2,}/g, " ")
      .replace(/[:\-–—]+$/, "")
      .trim();
  }

  function parseRange(str) {
    const s = String(str || "").replace(/,/g, " ");
    const m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(-?\d+(?:\.\d+)?)/i);
    if (!m) return { low: null, high: null };
    return { low: Number(m[1]), high: Number(m[2]) };
  }

  function inferFlag(value, low, high, rawLine) {
    const line = String(rawLine || "").toLowerCase();

    if (/\b(borderline)\b/.test(line)) return "borderline";
    if (/\b(low|below normal|decreased)\b/.test(line)) return "low";
    if (/\b(high|raised|elevated|above normal)\b/.test(line)) return "high";

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

  const rows = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length < 4) continue;

    const lower = line.toLowerCase();
    const looksRelevant = markerHints.some((h) => lower.includes(h));
    const numberHits = line.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) || [];

    if (!looksRelevant && numberHits.length < 1) continue;

    const patterns = [
      /^(.{2,80}?)\s+([<>]?\d+(?:,\d{3})*(?:\.\d+)?)\s+(low|high|borderline)?\s*(\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(\d+(?:\.\d+)?)\s*([A-Za-z/%][A-Za-z0-9/%\-\s\.]*)?$/i,
      /^(.{2,80}?)\s*[:\-]?\s*([<>]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(low|high|borderline)?\s*([A-Za-z/%][A-Za-z0-9/%\-\s\.]*)?\s*(.*)$/i,
      /^(.{2,80}?)\s+([<>]?\d+(?:,\d{3})*(?:\.\d+)?)\s*([A-Za-z/%][A-Za-z0-9/%\-\s\.]*)?\s*(.*)$/i,
    ];

    let match = null;
    let patternIndex = -1;

    for (let i = 0; i < patterns.length; i += 1) {
      const m = line.match(patterns[i]);
      if (m) {
        match = m;
        patternIndex = i;
        break;
      }
    }

    if (!match) continue;

    let marker = "";
    let value = NaN;
    let unit = "";
    let tail = "";
    let explicitFlag = "";

    if (patternIndex === 0) {
      marker = cleanMarkerName(match[1]);
      value = Number(String(match[2]).replace(/,/g, ""));
      explicitFlag = String(match[3] || "").trim().toLowerCase();
      const low = Number(match[4]);
      const high = Number(match[5]);
      unit = String(match[6] || "").trim();

      if (!marker || !Number.isFinite(value)) continue;

      // ✅ FIX: Validate marker name quality
      if (!isValidMarkerName(marker)) continue;

      rows.push({
        marker,
        value,
        unit,
        range: `${low}-${high}`,
        flag: explicitFlag || inferFlag(value, low, high, line),
      });
      continue;
    }

    marker = cleanMarkerName(match[1]);
    value = Number(String(match[2]).replace(/,/g, ""));
    if (!marker || !Number.isFinite(value)) continue;

    // ✅ FIX: Validate marker name quality
    if (!isValidMarkerName(marker)) continue;

    if (patternIndex === 1) {
      explicitFlag = String(match[3] || "").trim().toLowerCase();
      unit = String(match[4] || "").trim();
      tail = String(match[5] || "").trim();
    } else {
      unit = String(match[3] || "").trim();
      tail = String(match[4] || "").trim();
    }

    const { low, high } = parseRange(`${tail} ${line}`);
    const flag = explicitFlag || inferFlag(value, low, high, line);

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

  // ✅ FIX: Quality gate — if too many markers look suspicious, return empty
  // This forces the system to rely on GPT analysis of raw text instead
  if (deduped.length > 0) {
    const validCount = deduped.filter((r) => isValidMarkerName(r.marker)).length;
    const validRatio = validCount / deduped.length;
    if (validRatio < 0.3) {
      console.warn(`[parseLabMarkers] Quality too low: ${validCount}/${deduped.length} valid markers. Skipping parsed markers.`);
      return [];
    }
  }

  deduped.sort((a, b) => {
    const rank = { high: 0, low: 0, borderline: 1, normal: 2 };
    return (rank[a.flag] ?? 3) - (rank[b.flag] ?? 3);
  });

  return deduped.slice(0, 120);
}

function buildLabSummary(markers) {
  const rows = Array.isArray(markers) ? markers : [];
  if (!rows.length) return "";

  const top = rows.slice(0, 24);
  const lines = top.map((r) => {
    const val = Number.isFinite(r.value) ? r.value : r.value;
    const unit = r.unit ? ` ${r.unit}` : "";
    const range = r.range ? ` (range ${r.range})` : "";
    const tag =
      r.flag === "high" ? " -> HIGH" :
      r.flag === "low" ? " -> LOW" :
      r.flag === "borderline" ? " -> BORDERLINE" :
      " -> NORMAL/UNSPECIFIED";

    return `- ${r.marker}: ${val}${unit}${range}${tag}`;
  });

  return [
    "Lab markers parsed from report:",
    ...lines,
    "",
    "First give a brief overall summary of the visible report in simple language.",
    "Then explain important abnormal or borderline values clearly.",
    "After that, briefly cover other clearly visible relevant values so the user understands the full report.",
    "Keep normal values shorter than abnormal ones.",
    "Tell the user what each important visible value generally means.",
    "If values look mildly abnormal, say that clearly and calmly.",
    "Do not claim final diagnosis.",
  ].join("\n");
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

  return [
    "Prescription items parsed:",
    ...lines,
    "",
    "For each visible medicine, explain in simple language:",
    "- what it is generally used for",
    "- visible dosage/timing if present",
    "- common side effects",
    "- one useful caution if appropriate",
    "If any field is unclear, say not clearly visible.",
  ].join("\n");
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
            "Preserve rows, values, units, dates, medicine names, dosages and reference ranges.",
            "Keep line breaks.",
            "Do not summarize.",
            "Do not explain.",
            "Return only plain extracted text."
          ].join(" "),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read this medical image very carefully. Return only the extracted plain text. Include report values, ranges, medicine names, strength, timing, notes, headers, and page text if visible."
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 2600,
    });

    return normalizeExtractedText(out?.choices?.[0]?.message?.content || "");
  } catch (_) {
    return "";
  }
}

async function extractPdfViaImageFallback(buffer, debugErrors = []) {
  ensureTmpDir();

  const createdFiles = [];
  let combined = "";

  async function cleanup() {
    await Promise.all(
      createdFiles.map((p) => fs.promises.unlink(p).catch(() => {}))
    );
  }

  try {
    const stamp = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const pdfPath = path.join(resolvedTmpDir, `${stamp}.pdf`);
    const outBase = path.join(resolvedTmpDir, `${stamp}-page`);
    createdFiles.push(pdfPath);

    await fs.promises.writeFile(pdfPath, buffer);

    let imagePaths = [];

    try {
      await execFileAsync(
        "pdftoppm",
        ["-f", "1", "-l", "10", "-png", pdfPath, outBase],
        { windowsHide: true, timeout: 20000 }
      );

      for (let i = 1; i <= 10; i += 1) {
        const imgPath = `${outBase}-${i}.png`;
        if (fs.existsSync(imgPath)) {
          imagePaths.push(imgPath);
          createdFiles.push(imgPath);
        }
      }
    } catch (err) {
      debugErrors.push(`pdftoppm_failed:${err?.message || "unknown"}`);
    }

    if (!imagePaths.length) {
      let sharp;
      try {
        sharp = require("sharp");
      } catch (err) {
        debugErrors.push(`sharp_missing:${err?.message || "unknown"}`);
      }

      if (sharp) {
        for (let page = 0; page < 10; page += 1) {
          try {
            const img = await sharp(buffer, { density: 240, page })
              .flatten({ background: "#ffffff" })
              .png({ quality: 100 })
              .toBuffer();

            const text = await ocrImageWithOpenAI(img, "image/png");
            if (text && text.length > 20) {
              combined += `${combined ? "\n\n" : ""}${text}`;
            }
          } catch (err) {
            debugErrors.push(`sharp_pdf_render_failed_page_${page + 1}:${err?.message || "unknown"}`);
          }
        }

        return normalizeExtractedText(combined);
      }
    }

    for (const imgPath of imagePaths) {
      try {
        const imgBuffer = await fs.promises.readFile(imgPath);
        const text = await ocrImageWithOpenAI(imgBuffer, "image/png");
        if (text && text.length > 20) {
          combined += `${combined ? "\n\n" : ""}${text}`;
        }
      } catch (err) {
        debugErrors.push(`page_ocr_failed:${path.basename(imgPath)}:${err?.message || "unknown"}`);
      }
    }

    return normalizeExtractedText(combined);
  } catch (err) {
    debugErrors.push(`pdf_image_fallback_root_failed:${err?.message || "unknown"}`);
    return "";
  } finally {
    await cleanup();
  }
}

/* ─────────────────────────────────────────────────────────────
   FIX #2: Improved OCR text quality check
   Detects if extracted text is mostly garbage/noise
   ───────────────────────────────────────────────────────────── */
function isExtractedTextUsable(text) {
  if (!text || text.length < 20) return false;

  // Count readable vs total characters
  const readable = (text.match(/[a-zA-Z0-9\s.,:\-/()%+]/g) || []).length;
  const total = text.length;

  // If less than 30% readable, it's garbage
  if (total > 0 && readable / total < 0.3) return false;

  // Check for common medical/report words
  const medicalWords = /\b(test|result|normal|range|value|report|patient|date|name|age|doctor|lab|hospital|blood|urine|serum|plasma|total|count)\b/i;
  if (!medicalWords.test(text) && text.length < 200) return false;

  return true;
}

async function extractTextAndParsed(file, mode) {
  const kind = fileKind(file);
  let extractedText = "";
  const parsed = {};
  const debugErrors = [];

  if (kind.text) {
    extractedText = file.buffer.toString("utf8");
    if (kind.ext === ".csv") {
      parsed.csv = parseCsvToObjects(extractedText).slice(0, 120);
    }
  } else if (kind.image || kind.pdf) {
    // ✅ FIX: Try local OCR first
    try {
      const ocr = await withTempFile(file, async (p) => extractTextPlus(p));
      extractedText = normalizeExtractedText(ocr?.text || "");
      if (extractedText && isExtractedTextUsable(extractedText)) {
        parsed.ocrEngine = parsed.ocrEngine || "local-ocr";
      } else {
        debugErrors.push("local_ocr_unusable_text");
        extractedText = ""; // Reset — text is garbage
      }
    } catch (err) {
      debugErrors.push(`ocr_text_failed:${err?.message || "unknown"}`);
      extractedText = "";
    }

    // ✅ FIX: For PDFs, try pdf-parse
    if (!extractedText && kind.pdf) {
      const pdfText = await extractPdfTextWithPdfParse(file.buffer);
      if (pdfText && isExtractedTextUsable(pdfText)) {
        extractedText = pdfText;
        parsed.ocrEngine = parsed.ocrEngine || "pdf-parse";
      } else {
        debugErrors.push("pdf_parse_empty_or_unusable");
      }
    }

    // ✅ FIX: For images, try OpenAI vision OCR BEFORE heuristic (it's much better)
    if (!extractedText && kind.image) {
      const viaOpenAI = await ocrImageWithOpenAI(file.buffer, kind.mime || "image/png");
      if (viaOpenAI && isExtractedTextUsable(viaOpenAI)) {
        extractedText = viaOpenAI;
        parsed.ocrEngine = parsed.ocrEngine || "openai-image-ocr";
      } else {
        debugErrors.push("openai_image_ocr_empty");
      }
    }

    // ✅ FIX: For PDFs where text extraction failed, go straight to image-based OCR
    // This is the KEY fix for multi-page scanned PDFs
    if (!extractedText && kind.pdf) {
      // Skip heuristic text extraction — it produces garbage on scanned PDFs
      // Go directly to image-based OCR (renders pages as images, then OCR each)
      const viaImage = await extractPdfViaImageFallback(file.buffer, debugErrors);
      if (viaImage && isExtractedTextUsable(viaImage)) {
        extractedText = viaImage;
        parsed.ocrEngine = parsed.ocrEngine || "pdf-image-ocr-fallback";
      } else {
        debugErrors.push("pdf_image_ocr_unusable");
      }
    }

    // Last resort: heuristic PDF text (only if nothing else worked)
    if (!extractedText && kind.pdf) {
      const pdfText = extractPdfTextHeuristic(file.buffer);
      if (pdfText && isExtractedTextUsable(pdfText)) {
        extractedText = pdfText;
        parsed.ocrEngine = parsed.ocrEngine || "pdf-heuristic-text";
      } else {
        debugErrors.push("pdf_heuristic_empty_or_unusable");
      }
    }

    if (mode === "rx" || mode === "medicine") {
      try {
        const ocrItems = await withTempFile(file, async (p) => extractPrescriptionItems(p));
        parsed.rxItems = Array.isArray(ocrItems?.items) ? ocrItems.items : [];
        if (parsed.rxItems.length) {
          parsed.ocrEngine = parsed.ocrEngine || ocrItems?.engine || "";
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

  if (extractedText) {
    const labMarkers = parseLabMarkers(extractedText);
    if (labMarkers.length) {
      parsed.labMarkers = labMarkers;
      if (mode === "symptom") {
        mode = "lab";
      }
    }
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
      "User wants a lab report explanation.",
      "Start with a short overall summary of the full visible report.",
      "Then explain visible abnormal or borderline values in very simple language.",
      "After that, briefly explain other clearly visible relevant values so the user understands the report better.",
      "Tell the user what low/high/borderline generally means.",
      "Mention if findings look mild or potentially important, but do not give final diagnosis.",
      "Give practical next steps in easy language.",
    ].join("\n");
  }

  if (mode === "xray") {
    return [
      "User wants an X-Ray/scan image explanation.",
      "Describe any visible findings: fractures, shadows, opacities, masses, effusions.",
      "Explain what each finding typically means in simple language.",
      "Say whether it looks concerning or likely normal/benign.",
      "Do not claim final radiologist diagnosis.",
      "Be reassuring for mild findings.",
    ].join("\n");
  }

  if (mode === "rx") {
    return [
      "User wants a prescription explanation.",
      "Explain medicine name, visible dose/timing, common use, common side effects, and one useful caution if identifiable.",
      "Keep it simple and user-friendly.",
    ].join("\n");
  }

  if (mode === "medicine") {
    return [
      "User wants medicine understanding.",
      "Explain what medicine is commonly used for, common side effects, and practical caution points.",
      "Do not invent dosage if not visible.",
    ].join("\n");
  }

  return [
    "User wants symptom guidance in simple language.",
    "Explain likely meaning and practical next steps.",
  ].join("\n");
}

async function analyzeFileForAssistant({ file, message, history, context, userId }) {
  const persisted = await persistUploadedFile(file);
  let mode = normalizeFocus(message, context?.focus);

  const { extractedText, parsed } = await extractTextAndParsed(file, mode);
  if (parsed?.mode && parsed.mode !== mode) {
    mode = parsed.mode;
  }

  const textPreview = extractedText ? extractedText.slice(0, 15000) : "";

  // ✅ FIX: Only build parsed summary if markers are valid
  const parsedSummary =
    mode === "lab" && parsed.labMarkers?.length
      ? buildLabSummary(parsed.labMarkers)
      : (mode === "rx" || mode === "medicine")
        ? buildRxSummary(parsed.rxItems)
        : "";

  // ✅ FIX: If no usable text was extracted, tell GPT clearly
  const noTextMessage = !textPreview
    ? "\n\nIMPORTANT: No readable text could be extracted from this file. The file may be a scanned image with low quality, or the OCR failed. Please tell the user to upload a clearer image or PDF of their report. Do NOT make up or guess any values."
    : "";

  const mergedMessage = [
    String(message || "").trim() || "Please analyze this uploaded medical file.",
    "",
    buildModeInstructions(mode),
    parsedSummary ? `\n\n${parsedSummary}` : "",
    textPreview ? `\n\nFile Extracted Text:\n${textPreview}` : noTextMessage,
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