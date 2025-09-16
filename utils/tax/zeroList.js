// utils/tax/zeroList.js
"use strict";
const fs = require("fs");
const path = require("path");

function readZeroListFromEnv() {
  try {
    if (process.env.ZERO_GST_JSON) {
      const j = JSON.parse(process.env.ZERO_GST_JSON);
      if (Array.isArray(j)) return j;
    }
  } catch {}
  return null;
}

function readZeroListFromFile() {
  try {
    const p = path.resolve(process.cwd(), "data", "gst-zero-33.json");
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j;
    // also support the object-with-items format
    if (j && Array.isArray(j.items)) {
      return j.items.map(name => ({ name, hsn: j.hsn || "3004" }));
    }
  } catch {}
  return [];
}

const ZERO_LIST = readZeroListFromEnv() || readZeroListFromFile();

// build regex per item (with synonyms if present)
function makeRule(entry) {
  const canon = String(entry.name || "").toLowerCase().trim();
  const syns = Array.isArray(entry.synonyms) ? entry.synonyms : [];
  const pats = [canon, ...syns.map(s => String(s).toLowerCase().trim())]
    .filter(Boolean)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!pats.length) return null;
  const rx = new RegExp(`\\b(?:${pats.join("|")})\\b`, "i");
  return { rx, hsn: String(entry.hsn || "3004") };
}

const ZERO_GST_RULES = ZERO_LIST.map(makeRule).filter(Boolean);

function matchZeroGst(name) {
  const n = String(name || "");
  for (const r of ZERO_GST_RULES) {
    if (r.rx.test(n)) {
      return { hsn: r.hsn, gstRate: 0, reason: "Zero-rated list" };
    }
  }
  return null;
}

module.exports = { matchZeroGst, ZERO_GST_RULES };
