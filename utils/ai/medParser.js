// utils/ai/medParser.js

/**
 * Very practical parser: turns OCR’d text into "probable medicines" with qty.
 * It’s deliberately conservative and attaches confidence.
 * Pharmacies still confirm brand/price, so no flow changes.
 */

const FORM_WORDS = [
  "tablet","tab","capsule","cap","syrup","suspension","susp","drops","drop",
  "injection","inj","cream","ointment","oint","gel","spray","inhaler","solution","soln"
];

function normalizeLine(s) {
  return s
    .replace(/\u00D7/g, "x")       // ×
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function score(line, item) {
  let c = 0;
  if (item.strength) c += 0.2;
  if (item.form) c += 0.2;
  if (item.quantity) c += 0.2;
  if (/^\d+\./.test(line)) c += 0.15; // numbered list
  if (/[A-Za-z]/.test(item.name)) c += 0.1;
  if (item.name && item.name.split(" ").length <= 4) c += 0.05;
  return Math.max(0.15, Math.min(0.95, c));
}

function parseQty(line) {
  // qty patterns: x10, 10 tabs, Qty: 2, 1 bottle, #30
  const candidates = [
    /(?:^|\s)x\s*(\d{1,3})\b/i,
    /(?:qty|quantity)\s*[:\-]?\s*(\d{1,3})/i,
    /\b(\d{1,3})\s*(?:tabs?|caps?|bottles?|ml|pcs?)\b/i,
    /#\s*(\d{1,3})\b/,
  ];
  for (const re of candidates) {
    const m = line.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function parseForm(line) {
  const m = line.match(new RegExp(`\\b(${FORM_WORDS.join("|")})s?\\b`, "i"));
  return m ? m[1].toLowerCase() : null;
}

function parseStrength(line) {
  const m = line.match(/\b(\d{1,4}\s?(?:mg|mcg|g|ml|iu))\b/i);
  return m ? m[1].toLowerCase().replace(/\s+/g,"") : null;
}

function parseComposition(line) {
  // pick “Paracetamol 650 mg” OR “Azithromycin 500 mg” etc.
  const m = line.match(/\b([A-Za-z][A-Za-z\- ]{2,})\s+(\d{1,4}\s?(?:mg|mcg|g|ml|iu))\b/i);
  if (!m) return null;
  return `${m[1].trim()} ${m[2].toLowerCase().replace(/\s+/g,"")}`;
}

function parseName(line) {
  // Heuristic: take first 1–3 tokens before strength/form mention
  const blocks = line.split(/[,;]| - /);
  const first = blocks[0].trim();
  const tokens = first.split(/\s+/);
  const stopIdx = tokens.findIndex(t => /\d+(mg|ml|mcg|g|iu)/i.test(t) || FORM_WORDS.includes(t.toLowerCase()));
  const slice = stopIdx > 0 ? tokens.slice(0, stopIdx) : tokens.slice(0, Math.min(3, tokens.length));
  return slice.join(" ");
}

function parse(text) {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);

  const items = [];
  for (const line of lines) {
    if (line.length < 3) continue;
    // de-noise: ignore pure admin instructions
    if (/^(sig|rx|diagnosis|patient|dr\.|doc|age|date|review|refill|morning|evening|night)\b/i.test(line))
      continue;

    const quantity = parseQty(line);
    const strength = parseStrength(line);
    const form = parseForm(line);
    const composition = parseComposition(line);
    let name = parseName(line);

    // skip if name is garbage
    if (!/[A-Za-z]/.test(name)) continue;

    const item = {
      name: name.trim(),
      composition: composition || null,
      strength: strength || null,
      form: form || null,
      quantity: quantity || 1
    };

    const conf = score(line, item);
    // accept only if signal present
    if (composition || strength || form || quantity || /\d/.test(line)) {
      items.push({ ...item, confidence: conf });
    }
  }

  // dedupe by (name+strength), keep highest confidence, sum qty
  const key = (it) => [it.name.toLowerCase(), it.strength || "", it.form || ""].join("|");
  const map = new Map();
  for (const it of items) {
    const k = key(it);
    const prev = map.get(k);
    if (!prev) map.set(k, it);
    else {
      map.set(k, {
        ...((prev.confidence >= it.confidence) ? prev : it),
        quantity: (prev.quantity || 1) + (it.quantity || 1)
      });
    }
  }

  return Array.from(map.values());
}

module.exports = { parse };
