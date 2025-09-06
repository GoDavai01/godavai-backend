const express = require("express");
const { hasDrug, bestMatch, suggestByPrefix, dictSize, dictLoadedFromFile } = require("../utils/pharma/spellfix");
const router = express.Router();

router.get("/lookup", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ ok: true, exact: false, match: null });
  const exact = hasDrug(q);
  const bm = exact ? { word: q, score: 1 } : bestMatch(q); // adaptive thresholds
  res.json({ ok: true, exact, match: bm || null });
});

router.get("/suggest", (req, res) => {
  const q = String(req.query.q || "").trim();
  const k = Math.max(1, Math.min(25, Number(req.query.k) || 10));
  const list = q ? suggestByPrefix(q, k) : [];
  res.json({ ok: true, items: list });
});

// quick health ping to verify big dictionary is loaded
router.get("/__health", (req, res) => {
  res.json({ ok: true, size: dictSize(), fromFile: dictLoadedFromFile() });
});

module.exports = router;
