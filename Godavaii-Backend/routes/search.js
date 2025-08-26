// routes/search.js
const express = require("express");
const router = express.Router();
const Medicine = require("../models/Medicine");
const Pharmacy = require("../models/Pharmacy");

// Helper to escape regex special chars
function escapeRegex(str) {
  // For any user input going to $regex
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Autocomplete API for search suggestions
async function autocompleteHandler(req, res) {
  let { q = "", type = "all", city = "" } = req.query;
  q = q.trim();
  city = city.trim();
  if (!q) return res.json([]);

  try {
    let results = [];

    if (type === "medicine" || type === "all") {
      let pharmacyFilter = {};
      if (city) pharmacyFilter.city = new RegExp(escapeRegex(city), "i");
      const pharmacies = await Pharmacy.find(pharmacyFilter).select("_id");
      const pharmacyIds = pharmacies.map(p => p._id);

      // Get DISTINCT medicine names from these pharmacies matching search
      const medNames = await Medicine.distinct("name", {
        name: { $regex: escapeRegex(q), $options: "i" },
        pharmacy: { $in: pharmacyIds }
      });
      results.push(...medNames);
    }

    // === If you add doctor/lab search in future, add here ===
    /*
    if (type === "doctor" || type === "all") {
      const docNames = await Doctor.distinct("name", {
        name: { $regex: escapeRegex(q), $options: "i" },
        city: new RegExp(escapeRegex(city), "i")
      });
      results.push(...docNames);
    }
    */

    // Remove duplicates, just in case
    results = [...new Set(results)];
    // Return top 10 suggestions
    res.json(results.slice(0, 10));
  } catch (err) {
    console.error("Autocomplete error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
router.get("/search-autocomplete", autocompleteHandler);
// alias so `/api/search/autocomplete` (your fallback) also works
router.get("/autocomplete", autocompleteHandler);

module.exports = router;
