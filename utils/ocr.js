// utils/ocr.js

// Prefer Node 18+ fetch; fallback to node-fetch if present.
const fetchFn =
  (globalThis.fetch && globalThis.fetch.bind(globalThis)) ||
  (async (...args) => {
    const { default: f } = await import("node-fetch");
    return f(...args);
  });

async function fetchWithUA(url, opts = {}) {
  const headers = Object.assign({ "User-Agent": "Godavaii-OCR/1.0" }, opts.headers || {});
  return fetchFn(url, { ...opts, headers });
}

// add after existing requires
const { correctDrugName, normalizeForm, hasDrug, bestMatch } = require("./pharma/spellfix");
const sharp = require("sharp");

/* ----------------------- Clients (lazy / optional) ----------------------- */

let visionClient = null;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCV_CREDENTIALS_JSON) {
    const { ImageAnnotatorClient } = require("@google-cloud/vision");
    const apiEndpoint =
      (process.env.GCV_API_ENDPOINT || process.env.GOOGLE_VISION_API_ENDPOINT || "").trim() || undefined;
    const baseOpts = { fallback: true, ...(apiEndpoint ? { apiEndpoint } : {}) }; // force REST

    visionClient = process.env.GCV_CREDENTIALS_JSON
      ? new ImageAnnotatorClient({ ...baseOpts, credentials: JSON.parse(process.env.GCV_CREDENTIALS_JSON) })
      : new ImageAnnotatorClient(baseOpts);
  }
} catch { /* ignore */ }

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
} catch { /* ignore */ }

/* ------------------------------ Helpers ---------------------------------- */

async function loadBuffer(urlOrPath) {
  if (/^https?:\/\//i.test(urlOrPath)) {
    const res = await fetchWithUA(urlOrPath);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Failed to fetch image: ${res.status} ${res.statusText} ${body?.slice(0, 120)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  const path = require("path");
  const fs = require("fs");
  return fs.promises.readFile(path.resolve(process.cwd(), urlOrPath.replace(/^\//, "")));
}

function sniffMime(buf) {
  const a = buf;
  if (a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46) return "application/pdf"; // %PDF
  if (
    (a[0] === 0x49 && a[1] === 0x49 && a[2] === 0x2a && a[3] === 0x00) ||
    (a[0] === 0x4d && a[1] === 0x4d && a[2] === 0x00 && a[3] === 0x2a)
  ) return "image/tiff";
  return "image";
}

function stripLeadingFormWord(s) {
  return String(s || "")
    .replace(/^\s*(tab(?:let)?|cap(?:sule)?|syp\.?|syrup|susp(?:ension)?|inj(?:ection)?|ointment|cream|gel|lotion|spray|drop|solution|soln)\b[.\s:-]*/i, "")
    .trim();
}

async function preprocess(buf) {
  const kind = sniffMime(buf);
  if (kind !== "image") return buf; // PDFs/TIFFs as-is
  try {
    const maxDim = Number(process.env.OCR_MAX_DIM || 1800); // speed knob (1200–2000 is fine)
    const s = sharp(buf).rotate();
    const chain = maxDim
      ? s.resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
      : s;
    return await chain.jpeg({ quality: 92 }).normalize().toBuffer();
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] preprocess skipped:", e.message);
    return buf;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const splitToLines = (text) => (text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

/* ------------------------------ Engines ---------------------------------- */

async function ocrGoogle(buf) {
  if (!visionClient) return null;
  try {
    const [result] = await visionClient.documentTextDetection({ image: { content: buf } });
    const text = result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description;
    if (text) return { text, lines: splitToLines(text).map(t => ({ text: t })), engine: "google-vision" };
  } catch (err) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] google-vision failed:", err?.message || err);
  }
  return null;
}

async function ocrAzure(buf) {
  const ep = (process.env.AZURE_VISION_ENDPOINT || process.env.AZURE_OCR_ENDPOINT || "").replace(/\/+$/, "");
  const key = process.env.AZURE_VISION_KEY;
  if (!ep || !key) return null;

  try {
    const submit = await fetchWithUA(`${ep}/vision/v3.2/read/analyze`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/octet-stream" },
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

    const maxPoll = Number(process.env.AZURE_MAX_POLL || 24); // ~24*0.8s ≈ 19s
    for (let i = 0; i < maxPoll; i++) {
      await sleep(800);
      const res = await fetchWithUA(op, { headers: { "Ocp-Apim-Subscription-Key": key } });
      const j = await res.json().catch(() => ({}));
      if (j.status === "succeeded") {
        const pages = j?.analyzeResult?.readResults ?? j?.analyzeResult?.pages ?? [];
        const lines = [];
        for (const p of pages) for (const l of (p.lines || [])) {
          lines.push({
            text: l.text || l.content || "",
            confidence: typeof l.confidence === "number" ? l.confidence : undefined,
            bbox: l.boundingBox || l.polygon || undefined,
          });
        }
        const text = lines.map(l => l.text).join("\n");
        return { text, lines, engine: "azure-vision-read" };
      }
      if (j.status === "failed") return null;
    }
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] azure error:", e?.message || e);
  }
  return null;
}

async function ocrTextract(buf) {
  if (!textractClient) return null;
  try {
    const { DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
    const out = await textractClient.send(new DetectDocumentTextCommand({ Document: { Bytes: buf } }));
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

async function ocrTesseract(buf) {
  let createWorker;
  try { ({ createWorker } = require("tesseract.js")); }
  catch (e) { if (process.env.DEBUG_OCR) console.warn("[OCR] tesseract.js not installed:", e.message); return null; }

  let worker;
  let timeout;
  const kill = async () => { clearTimeout(timeout); try { await worker?.terminate(); } catch {} };

  try {
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

/* -------------- Fast gather: run engines in parallel & pick best ---------- */

async function runEnginesFast(buf, wantLines = true) {
  // Stagger Tesseract by a couple seconds (CPU heavy) so cloud OCRs win if available
  const tesseractLater = new Promise(res => setTimeout(async () => res(await ocrTesseract(buf)), 2000));

  const tasks = [
    ocrAzure(buf),
    ocrGoogle(buf),
    ocrTextract(buf),
    tesseractLater,
  ].map(p => p.catch(() => null));

  // Wait for first decent result; if all come back, pick the longest text
  const deadlineMs = Number(process.env.OCR_DEADLINE_MS || 45000);
  const timeout = new Promise(res => setTimeout(() => res(null), deadlineMs));

  const all = await Promise.race([
    (async () => {
      const results = await Promise.all(tasks);
      const good = results.filter(r => r && (r.text || "").trim().length > 10);
      if (!good.length) return null;
      good.sort((a, b) => (b.text || "").length - (a.text || "").length);
      return good[0];
    })(),
    timeout
  ]);

  return all || null;
}

/* ------------------- Sectioning + Filtering + Parsing -------------------- */

const STOPWORDS = [
  "FORM","DOD PRESCRIPTION","FOR (FULL NAME","MEDICAL FACILITY","EXP DATE","LOT NO",
  "FILLED BY","SIGNATURE","RANK","EDITION","S/N","B NUMBER","MFGR","PRESCRIPTION",
  "(SUPERSCRIPTION)","(INSCRIPTION)","(SUBSCRIPTION)","(SIGNA)","SUPERSCRIPTION",
  "INSCRIPTION","SUBSCRIPTION","SIGNA","DIRECTION","DIRECTIONS"
];

function slicePrescriptionSection(lines) {
  const L = lines.map(l => l.text ?? l);
  const upper = L.map(s => s.toUpperCase());
  const startIdx = upper.findIndex(s => /INSCRIPTION|\(INSCRIPTION\)|^R[ x:]*$/i.test(s));
  const endIdx   = upper.findIndex((s, i) => i > startIdx && /(SIGNA|DIRECTION|DIRECTIONS|\(SIGNA\))/i.test(s));
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return L.slice(startIdx + 1, endIdx);
  }
  return L;
}

function looksLikeDateOrSerial(s) {
  if (/\b\d{1,2}\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/i.test(s)) return true;
  if (/\b(19|20)\d{2}\b/.test(s)) return true;
  if (/S\/N|LOT|EXP|MFGR|FILLED BY|B NUMBER/i.test(s)) return true;
  return false;
}

// UNITS (+ add µg + IU variations)
const UNITS = "(mg|mcg|µg|g|ml|l|iu|IU|%)";
const STRENGTH_RE = new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*${UNITS}\\b`, "i");

// Add support for “unitless number with release code” (e.g., Dicorate ER 250)
const RELEASE_RE = /\b(ER|SR|CR|MR|XL|XR)\b/i;

// include short forms like "T.", "C.", "Syp."
const FORM_RE = /\b(t\.?|tab(?:let)?|c\.?|cap(?:sule)?|syp\.?|syrup|susp(?:ension)?|ointment|cream|gel|lotion|spray|paint|drop|solution|soln|inj(?:ection)?|tablet|capsule)s?\b/i;

const DOSE_RE = /\b[01]\s*[-–]\s*[01]\s*[-–]\s*[01]\b/;
const DURATION_RE = /\b[x×]\s*\d+\s*(day|days|week|weeks)\b/i;
const MEAL_RE = /\b(after|before)\s+meals?\b|\b(?:ac|pc)\b/i;

const JUNK_PHRASES = [
  "smile designing","teeth whitening","dental implants","general dentistry",
  "rx","patient","mr.","mrs.","ms.","age","date","www.","email:","ph:","phone:","@",
  "instagram.com","facebook.com"
];

function looksLikeDrugLine(s) {
  if (!/[A-Za-z]/.test(s)) return false;
  const U = s.toUpperCase();

  for (const w of STOPWORDS) if (U.includes(w)) return false;
  if (looksLikeDateOrSerial(s)) return false;
  if (JUNK_PHRASES.some(p => s.toLowerCase().includes(p))) return false;
  if (/^dr\.|\bdoctor\b|\bsignature\b|\breg\.?\s?no\b|\bregistration\b/i.test(s)) return false;

  // must show any strong “medicine” signal
  return STRENGTH_RE.test(s) || FORM_RE.test(s) || /\bTr\.?\b/i.test(s);
}

function parseDrugLine(s) {
  if (DOSE_RE.test(s) && !FORM_RE.test(s) && !STRENGTH_RE.test(s)) return null;
  if (DURATION_RE.test(s) && !FORM_RE.test(s) && !STRENGTH_RE.test(s)) return null;
  if (/^(after|before|meals?|massage)\b/i.test(s) && !FORM_RE.test(s) && !STRENGTH_RE.test(s)) return null;

  const norm = s
    .replace(/\b(\d{1,4})\s*mq\b/ig, "$1 mg")
    .replace(/\bO\b/g, "0");

  const tincture = norm.match(/\bTr\.?\s*([A-Za-z][\w\.\-]+(?:\s+[A-Za-z][\w\.\-]+){0,2})\b/i);
  const dose     = norm.match(STRENGTH_RE);

  // vitamin D “60k” → 60000 IU
  let dose2 = null;
  const kHit = norm.match(/\b(\d{2,3})\s*k\b/i);
  if (kHit) dose2 = `${parseInt(kHit[1], 10) * 1000} IU`;

  // number + release code (mg)
  let dose3 = null;
  if (RELEASE_RE.test(norm)) {
    const m = norm.match(/\b(\d{2,4})\b/);
    if (m) dose3 = `${m[1]} mg`;
  }

  const formHit  = norm.match(FORM_RE);
  const qtyToken =
    norm.match(/\b(\d{1,3})\s*(?:tab(?:let)?|cap(?:sule)?|caps?)\b/i) ||
    norm.match(/\bx\s*([1-9]\d?)\b/i) ||
    norm.match(/\bqty[:\s]*([1-9]\d?)\b/i);

  let name = norm;
  if (tincture) name = tincture[1];
  else if (dose) name = norm.replace(dose[0], "").trim();
  else if (dose2) name = norm.replace(kHit[0], "").trim();
  else if (dose3) name = norm.replace(/\b(\d{2,4})\b/, "").trim();

  name = name
    .replace(/\b(qty|quantity)[:\s]*\d+\b/i, "")
    .replace(/\b(qs\s*ad?)\b.*$/i, "")
    .replace(/\b(sig|signa|directions?)\b.*$/i, "")
    .replace(/\b(mfgr|lot|exp|s\/n)\b.*$/i, "")
    .replace(/[-–:,]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const strength = dose ? dose[0] : (dose2 || dose3 || "");
  const qty = qtyToken ? parseInt(qtyToken[1], 10) : 1;

  if (!dose && !formHit) return null;
  if (!/[A-Za-z]{3,}/.test(name) || !/[aeiou]/i.test(name)) return null;

  return { name: stripLeadingFormWord(name), strength, qty, form: formHit ? formHit[0].toLowerCase() : "" };
}

/* --------------------------- Public functions ---------------------------- */

async function extractTextPlus(urlOrPath) {
  const raw = await loadBuffer(urlOrPath);
  const buf = await preprocess(raw);

  const out = await runEnginesFast(buf, false);
  if (out?.text) return { text: out.text.trim(), engine: out.engine };

  if (process.env.DEBUG_OCR) console.warn("[OCR] all engines returned null/empty");
  return { text: "", engine: "none" };
}

async function extractTextPlusDetailed(urlOrPath) {
  const raw = await loadBuffer(urlOrPath);
  const buf = await preprocess(raw);

  const out = await runEnginesFast(buf, true);
  if (out) return { text: out.text.trim(), lines: out.lines, engine: out.engine };

  return { text: "", lines: [], engine: "none" };
}

/** Heuristic extraction + OPTIONAL GPT post-filter to force ONLY medicines */
async function extractPrescriptionItems(urlOrPath) {
  const detailed = await extractTextPlusDetailed(urlOrPath);
  const lines = (detailed.lines || []).map(l => (typeof l === "string" ? { text: l } : l));

  // 1) Isolate likely Rx body
  const bodyLines = slicePrescriptionSection(lines);
  const bodyText  = bodyLines.map(l => (l.text || "").trim()).filter(Boolean).join("\n");

  // 2) Heuristic filter & parse
  const items = [];
  for (const raw of bodyLines) {
    const s = (raw.text || raw).trim();
    if (!s) continue;
    if (!looksLikeDrugLine(s)) continue;
    const parsed = parseDrugLine(s);
    if (!parsed) continue;
    items.push({ ...parsed, confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5 });
  }

  // Fallback: if nothing parsed, try simple NLPish parser (kept in repo)
  let mergedHeur = items;
  if (!mergedHeur.length) {
    try {
      const { parse } = require("./ai/medParser");
      const coarse = parse(bodyText);
      mergedHeur = coarse.map(c => ({
        name: c.name,
        strength: c.strength || "",
        form: c.form || "",
        qty: c.quantity || 1,
        confidence: c.confidence ?? 0.5
      }));
    } catch {}
  }

  // de-dupe by normalized name
  const seen = new Set();
  const uniqueHeur = [];
  for (const it of mergedHeur) {
    const key = (it.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueHeur.push(it);
  }

  // 3) OPTIONAL GPT post-filter
  let gptItems = [];
  try {
    if (process.env.OPENAI_API_KEY && process.env.GPT_MED_STAGE !== "0") {
      const { gptFilterMedicines } = require("./ai/gptMeds");
      const out = await gptFilterMedicines(bodyText);
      if (out && Array.isArray(out.items)) {
        gptItems = out.items.map(i => ({
          name: i.name,
          strength: i.strength || "",
          form: i.form || "",
          qty: i.qty || 1,
          confidence: 0.85,
        }));
      }
    }
  } catch (e) {
    if (process.env.DEBUG_OCR) console.warn("[OCR] GPT post-filter failed:", e.message);
  }

  // 4) Merge GPT + heuristic
  const byKey = new Map();
  const keyOf = (x) => (x.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + (x.strength || "") + "|" + (x.form || "");
  for (const it of gptItems) byKey.set(keyOf(it), it);
  for (const it of uniqueHeur) {
    const k = keyOf(it);
    if (!byKey.has(k)) byKey.set(k, it);
  }

  // sanity
  const merged = Array.from(byKey.values())
  .map(it => ({ ...it, name: stripLeadingFormWord(it.name) }))
  .filter(it => {
    const n0 = String(it.name || "");
    // dump pure form words or bullets like "1", "x", etc.
    if (/^(tab(?:let)?|cap(?:sule)?|syrup|susp(?:ension)?|inj(?:ection)?|ointment|cream|gel|lotion|spray|drop|solution|soln)$/i.test(n0)) return false;
    const n = n0.replace(/[^A-Za-z]/g, "");
    return n.length >= 3 && /[aeiou]/i.test(n);
  });


  // 4.5) Snap to dictionary; normalize forms
  const corrected = merged.map(i => {
    const formNorm = normalizeForm(i.form || "");
    let chosen = stripLeadingFormWord(i.name || "").trim();

// If the name started with a form word originally, demand a stronger fuzzy score.
const preferStrict = /^(tab|tablet|cap|capsule)\b/i.test(i.name || "");
if (!hasDrug(chosen)) {
  const bm = bestMatch(chosen, preferStrict ? 0.93 : undefined);

      if (bm && bm.word) chosen = bm.word;
      else chosen = correctDrugName(chosen).name;
    }
    const bumped = hasDrug(chosen);
    return {
      ...i,
      name: chosen,
      form: formNorm || "",
      confidence: Math.min(0.98, (typeof i.confidence === "number" ? i.confidence : 0.7) + (bumped ? 0.08 : 0))
    };
  });

  return {
    items: corrected.map(i => ({
      name: i.name,
      composition: "",
      strength: i.strength || "",
      form: i.form || "",
      qty: i.qty || 1,
      confidence: typeof i.confidence === "number" ? i.confidence : 0.75
    })),
    engine: gptItems.length ? (detailed.engine + "+gpt") : detailed.engine,
    raw: detailed.text
  };
}

async function extractText(urlOrPath) {
  const { text } = await extractTextPlus(urlOrPath);
  return text;
}

module.exports = {
  extractText,
  extractTextPlus,
  extractTextPlusDetailed,
  extractPrescriptionItems,
};
