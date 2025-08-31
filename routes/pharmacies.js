// routes/pharmacies.js

const express = require("express");
const router = express.Router();
const Pharmacy = require("../models/Pharmacy");
const auth = require("../middleware/auth");
const Medicine = require("../models/Medicine");

/**
 * POST /api/pharmacies/available-for-cart
 * Expects: { city, area, medicines: [id, ...] }
 * Returns pharmacies in area with ALL of the given medicines in stock
 */
router.post("/available-for-cart", async (req, res) => {
  try {
    const { city, area, medicines } = req.body;
    if (!city || !medicines || !medicines.length) {
      return res.status(400).json({ error: "city and medicines required" });
    }
    const query = { city: new RegExp(`^${city}$`, "i"), ...(area ? { area } : {}), active: true };

    // Find all pharmacies in city/area
    const pharmacies = await Pharmacy.find(query);

    // Filter those who have ALL medicines
    const result = pharmacies.filter(pharmacy =>
      medicines.every(medId =>
        pharmacy.medicines.map(String).includes(String(medId))
      )
    );

    res.json(result);
  } catch (err) {
    console.error("available-for-cart error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/pharmacies?city=Mumbai
 * Returns all pharmacies in the given city (case-insensitive)
 * Used by frontend Home.js to show pharmacy cards
 */
router.get("/", async (req, res) => {
  try {
    const city = req.query.city || "";
    const area = req.query.area || "";
    const all = req.query.all === "1" || req.query.all === "true";

    let query = {};
    if (!all) query.active = true;
    if (city) query.city = new RegExp(city, "i");
    if (area) query.area = new RegExp(area, "i");

    const pharmacies = await Pharmacy.find(query);
    res.json(pharmacies);
  } catch (err) {
    console.error("Pharmacy list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/pharmacy/medicines
 * Returns all medicines belonging to the logged-in pharmacy (for dashboard/autocomplete)
 * Requires pharmacy authentication
 */
router.get("/medicines", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  try {
    const medicines = await Medicine.find({ pharmacy: req.user.pharmacyId });
    res.json(medicines);
  } catch (err) {
    console.error("Pharmacy medicines error:", err);
    res.status(500).json({ message: "Failed to fetch medicines" });
  }
});

router.get("/me", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  try {
    const pharmacy = await Pharmacy.findById(req.user.pharmacyId);
    if (!pharmacy) return res.status(404).json({ message: "Pharmacy not found" });
    res.json(pharmacy);
  } catch (err) {
    console.error("Pharmacy /me error:", err);
    res.status(500).json({ message: "Failed to fetch pharmacy" });
  }
});

router.patch('/active', auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  const { active } = req.body;
  try {
    const updated = await Pharmacy.findByIdAndUpdate(
      req.user.pharmacyId,
      { active: !!active },
      { new: true }
    );
    res.json({ message: "Status updated", active: updated.active });
  } catch (err) {
    console.error("Pharmacy active status error:", err);
    res.status(500).json({ message: "Failed to update active status" });
  }
});

// --- Suggest pharmacies for unavailable medicines (filtered by city/area) ---
router.post("/suggest-for-prescription", async (req, res) => {
  try {
    const { city, area, medicines } = req.body; // medicines: [{ name: "Dolo", quantity: 1 }, ...]
    if (!city || !medicines || !medicines.length) {
      return res.status(400).json({ error: "city and medicines required" });
    }

    const pharmacyQuery = { city: new RegExp(city, "i"), active: true };
    if (area) pharmacyQuery.area = new RegExp(area, "i");
    const pharmacies = await Pharmacy.find(pharmacyQuery).lean();

    const medicineNames = medicines.map(m => m.name);
    const meds = await Medicine.find({
      name: { $in: medicineNames },
      pharmacy: { $in: pharmacies.map(p => p._id) },
      stock: { $gt: 0 },
    }).populate("pharmacy");

    const pharmacyMap = {};
    meds.forEach(med => {
      const pid = med.pharmacy._id.toString();
      if (!pharmacyMap[pid]) {
        pharmacyMap[pid] = {
          pharmacy: med.pharmacy,
          items: [],
          total: 0,
        };
      }
      pharmacyMap[pid].items.push({
        name: med.name,
        price: med.price,
        quantity: 1
      });
      pharmacyMap[pid].total += med.price;
    });

    const suggestions = Object.values(pharmacyMap).map(ph => {
      const allAvailable = ph.items.length === medicines.length;
      return {
        pharmacyId: ph.pharmacy._id,
        name: ph.pharmacy.name,
        total: ph.total,
        allAvailable,
        availableItems: ph.items
      };
    });

    suggestions.sort((a, b) => {
      if (a.allAvailable && !b.allAvailable) return -1;
      if (!a.allAvailable && b.allAvailable) return 1;
      return a.total - b.total;
    });

    res.json(suggestions);
  } catch (err) {
    console.error("Pharmacy suggest-for-prescription error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/pharmacies/nearby?lat=...&lng=...
router.get("/nearby", async (req, res) => {
  const { lat, lng, maxDistance = 8000 } = req.query; // meters
  if (!lat || !lng) return res.status(400).json({ error: "lat/lng required" });
  try {
    const pharmacies = await Pharmacy.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
          distanceField: "dist.calculated",
          maxDistance: parseInt(maxDistance),
          spherical: true,
          query: { active: true, status: "approved" }
        }
      },
      { $limit: 25 }
    ]);
    res.json(pharmacies);
  } catch (err) {
    res.status(500).json({ error: "Geo search error" });
  }
});

// routes/pharmacies.js
router.patch('/set-location', auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
  const { lat, lng, formatted } = req.body;
  if (!lat || !lng) return res.status(400).json({ message: "lat/lng required" });
  try {
    const updated = await Pharmacy.findByIdAndUpdate(
      req.user.pharmacyId,
      {
        location: {
          type: "Point",
          coordinates: [parseFloat(lng), parseFloat(lat)],
          formatted: formatted || ""
        }
      },
      { new: true }
    );
    res.json({ message: "Location updated", location: updated.location });
  } catch (err) {
    res.status(500).json({ message: "Failed to update location" });
  }
});


module.exports = router;
