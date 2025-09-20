// server/routes/suggest.js
const router = require("express").Router();
const {
  suggestBrands,
  suggestCompositions,
  prefillForBrand,
  prefillForComposition,
  learn,
} = require("../services/suggestService");

router.get("/brand", async (req, res) => {
  try {
    const { query = "", limit } = req.query;
    const out = await suggestBrands(String(query || ""), Number(limit || 10));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "Failed to suggest brand" });
  }
});

router.get("/composition", async (req, res) => {
  try {
    const { query = "", limit } = req.query;
    const out = await suggestCompositions(String(query || ""), Number(limit || 10));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "Failed to suggest composition" });
  }
});

router.get("/prefill", async (req, res) => {
  try {
    const { brandId, compositionId } = req.query;
    if (brandId) {
      const p = await prefillForBrand(brandId);
      return res.json(p || {});
    }
    if (compositionId) {
      const p = await prefillForComposition(compositionId);
      return res.json(p || {});
    }
    res.json({});
  } catch (e) {
    res.status(500).json({ error: "Failed to prefill" });
  }
});

router.post("/learn", async (req, res) => {
  try {
    const result = await learn(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Failed to learn" });
  }
});

module.exports = router;
