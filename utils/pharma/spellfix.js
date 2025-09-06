// utils/pharma/spellfix.js
// Lightweight pharma spell-fix with fuzzy matching + optional DB priming.
// Looks up against a dictionary (env-provided via PHARMA_DICTIONARY_PATH, then DB, then fallback).
const fs = require("fs");
const path = require("path");

// ---- Minimal fallback (same as before, trimmed for brevity) ----
const FALLBACK = [
  "Paracetamol","Azithromycin","Amoxicillin","Cefixime","Cefpodoxime","Cefuroxime",
  "Metformin","Glimepiride","Atorvastatin","Rosuvastatin","Amlodipine","Losartan",
  "Telmisartan","Metoprolol","Betaloc","Pantoprazole","Omeprazole","Rabeprazole",
  "Drotaverine","Diclofenac","Aceclofenac","Ibuprofen","Levocetirizine","Cetirizine",
  "Montelukast","Fexofenadine","Budesonide","Formoterol","Salbutamol",
  "Dorzolamide","Timolol","Cimetidine","Ranitidine","Famotidine","Oxprenolol",
  "Ofloxacin","Levofloxacin","Ciprofloxacin","Doxycycline","Linezolid","Amikacin",
  "Lorazepam","Alprazolam","Clonazepam","Sertraline","Fluoxetine","Escitalopram",
  "Prednisolone","Hydrocortisone","Mometasone","Betamethasone",
  "Vitamin D3","Cholecalciferol","Folic Acid","Cyanocobalamin","Thiamine",
  "ORS","ORS Solution","ORS Powder","ORS Liquid",
  "Betadine","Povidone Iodine","Chlorhexidine","Lignocaine","Lidocaine",
  "Metronidazole","Tinidazole",
];

let DICT = null;             // array of canonical entries
let LOWER_SET = null;        // Set of lowercase entries for O(1) exact checks
let NAME_CACHE = new Map();  // memo for corrected names
let PRIMED = false;

function loadDict() {
  if (DICT) return DICT;
  const p = (process.env.PHARMA_DICTIONARY_PATH || "").trim();
  let list = [];
  if (p) {
    try {
      const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
      const raw = fs.readFileSync(abs, "utf8");
      list = raw.trim().startsWith("[")
        ? JSON.parse(raw)
        : raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch (e) {
      console.warn("[spellfix] Failed to read PHARMA_DICTIONARY_PATH:", e.message);
    }
  }
  if (!list.length) list = FALLBACK;

  const uniq = Array.from(new Set(list.map(s => s.trim()).filter(Boolean)));
  // sort by length for slightly better fuzzy pruning
  uniq.sort((a, b) => a.length - b.length);
  DICT = uniq;
  LOWER_SET = new Set(uniq.map(s => s.toLowerCase()));
  return DICT;
}

/** Prime dictionary from your Medicine DB (names/brands/compositions). Call once on boot. */
async function primeFromDB(MedicineModel) {
  if (PRIMED) return;
  try {
    const names  = await MedicineModel.distinct("name");
    const brands = await MedicineModel.distinct("brand");
    const comps  = await MedicineModel.distinct("composition");

    const pool = []
      .concat(names || [], brands || [], (comps || []).map(c => String(c).split(/\d/)[0].trim()))
      .map(s => String(s || "").trim())
      .filter(s => s && /[A-Za-z]/.test(s));

    const base = loadDict();
    const merged = Array.from(new Set([...base, ...pool]));
    merged.sort((a, b) => a.length - b.length);
    DICT = merged;
    LOWER_SET = new Set(merged.map(s => s.toLowerCase()));
    PRIMED = true;
    if (process.env.DEBUG_OCR) console.log(`[spellfix] primed from DB: +${pool.length} terms (total ${DICT.length})`);
  } catch (e) {
    console.warn("[spellfix] DB prime failed:", e.message);
  }
}

/** Damerau–Levenshtein */
function editDistance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}
function similarity(a, b) {
  if (!a || !b) return 0;
  const d = editDistance(a, b);
  const L = Math.max(a.length, b.length);
  return L ? 1 - d / L : 0;
}

/** O(1) exact check (case-insensitive) */
function hasDrug(name) {
  loadDict();
  return LOWER_SET.has(String(name || "").toLowerCase());
}

/** Top fuzzy match with adaptive threshold (looser for long words) */
function bestMatch(name, minScore) {
  const dict = loadDict();
  const clean = String(name || "").replace(/\s{2,}/g, " ").trim();
  if (!clean) return null;

  if (hasDrug(clean)) return { word: DICT.find(w => w.toLowerCase() === clean.toLowerCase()), score: 1 };

  const L = clean.length;
  const need = (typeof minScore === "number")
    ? minScore
    : (L <= 5 ? 0.92 : L <= 7 ? 0.88 : 0.78);

  let best = { word: null, score: 0 };
  for (const w of dict) {
    const wl = w.length;
    if (Math.abs(wl - L) > Math.ceil(L * 0.6)) continue; // length guard
    const sc = similarity(clean, w);
    if (sc > best.score) { best = { word: w, score: sc }; if (sc === 1) break; }
  }
  return best.score >= need ? best : null;
}

/** Small helper: return up to K prefix suggestions (autocomplete) */
function suggestByPrefix(prefix, k = 10) {
  const dict = loadDict();
  const p = String(prefix || "").toLowerCase();
  if (!p) return [];
  const out = [];
  for (const w of dict) {
    if (w.toLowerCase().startsWith(p)) {
      out.push(w);
      if (out.length >= k) break;
    }
  }
  return out;
}

/** Original API: correct full name (kept for backward compatibility) */
function correctDrugName(name) {
  loadDict();
  const clean = String(name || "").replace(/\s{2,}/g, " ").trim();
  if (!clean) return { name, corrected: false };

  const cacheKey = clean.toLowerCase();
  if (NAME_CACHE.has(cacheKey)) return NAME_CACHE.get(cacheKey);

  // try exact/fuzzy (adaptive thresholds inside bestMatch)
  const hit = bestMatch(clean);
  if (hit) {
    const out = { name: hit.word, corrected: hit.word.toLowerCase() !== clean.toLowerCase() };
    NAME_CACHE.set(cacheKey, out);
    return out;
  }

  // token-by-token rebuild as last resort
  const tokens = clean.split(/\s+/);
  const fixed = tokens.map(t => {
    if (!/[A-Za-z]/.test(t)) return t;
    const m = bestMatch(t);
    return m ? m.word.split(/\s+/)[0] : t;
  });
  const rebuilt = fixed.join(" ");
  const out = { name: rebuilt, corrected: rebuilt.toLowerCase() !== clean.toLowerCase() };
  NAME_CACHE.set(cacheKey, out);
  return out;
}

function normalizeForm(form) {
  const f = (form || "").toLowerCase().trim();
  if (!f) return "";
  if (/tab/.test(f)) return "tablet";
  if (/cap/.test(f)) return "capsule";
  if (/(syr|sus|susp)/.test(f)) return "syrup";
  if (/(soln|solution)/.test(f)) return "solution";
  if (/drop/.test(f)) return "drop";
  if (/inj/.test(f)) return "injection";
  if (/oint/.test(f)) return "ointment";
  return f;
}

/* ---- tiny health helpers ---- */
function dictSize() { loadDict(); return (DICT ? DICT.length : 0); }
function dictLoadedFromFile() { return !!(process.env.PHARMA_DICTIONARY_PATH || "").trim(); }

module.exports = {
  // existing
  correctDrugName, normalizeForm, primeFromDB,
  // new
  hasDrug, bestMatch, suggestByPrefix,
  // health
  dictSize, dictLoadedFromFile,
};
