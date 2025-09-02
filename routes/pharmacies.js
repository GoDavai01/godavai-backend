// routes/pharmacies.js
const express = require("express");
const router = express.Router();
const Pharmacy = require("../models/Pharmacy");
const Medicine = require("../models/Medicine");
const auth = require("../middleware/auth");
const mongoose = require("mongoose");
const generateMedicineDescription = require("../utils/generateDescription");

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

    const pharmacies = await Pharmacy.find(query);
    const result = pharmacies.filter(pharmacy =>
      medicines.every(medId =>
        (pharmacy.medicines || []).map(String).includes(String(medId))
      )
    );
    res.json(result);
  } catch (err) {
    console.error("available-for-cart error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/pharmacies
 * Query: ?city=&area=&all=1
 * Returns pharmacies (used by Home.js cards)
 */
router.get("/", async (req, res) => {
  try {
    const city = req.query.city || "";
    const area = req.query.area || "";
    const all = req.query.all === "1" || req.query.all === "true";

    const q = {};
    if (!all) q.active = true;
    if (city) q.city = new RegExp(city, "i");
    if (area) q.area = new RegExp(area, "i");

    const pharmacies = await Pharmacy.find(q);
    res.json(pharmacies);
  } catch (err) {
    console.error("Pharmacy list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/pharmacies/medicines  (pharmacy dashboard/autocomplete)
 * Requires auth with a pharmacyId
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

/**
 * POST /api/pharmacies/medicines/quick-add-draft
 * Creates a draft medicine quickly AND eagerly generates description.
 */
router.post("/medicines/quick-add-draft", auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ error: "Not authorized" });

    const { name, brand, composition, company } = req.body;
    if (!brand && !composition) {
      return res.status(400).json({ error: "Provide at least Brand or Composition." });
    }

    let doc = await Medicine.create({
      name: name || brand || composition || "Draft",
      brand: brand || "",
      composition: composition || "",
      company: company || "",
      price: 0,
      mrp: 0,
      discount: 0,
      stock: 0,
      images: [],
      category: ["Miscellaneous"],
      type: "Tablet",
      prescriptionRequired: false,
      pharmacy: req.user.pharmacyId,
      status: "draft",
    });

    // EAGER: generate & persist description immediately
    try {
      const desc = await generateMedicineDescription({
        name: doc.name,
        brand: doc.brand,
        composition: doc.composition,
        company: doc.company,
        type: doc.type,
      });
      if (desc && desc !== "No description available.") {
        doc.description = desc;
        await doc.save();
      }
    } catch (e) {
      console.error("Desc gen failed (draft):", e?.response?.data || e?.message);
    }

    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create draft." });
  }
});

/**
 * PATCH /api/pharmacies/medicines/:id/activate
 * Activates the medicine AND eagerly fills description if missing.
 */
router.patch("/medicines/:id/activate", auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ error: "Not authorized" });

    const { price, mrp, stock, category, type, prescriptionRequired } = req.body;
    if (price == null || mrp == null) {
      return res.status(400).json({ error: "price and mrp are required to activate." });
    }

    let med = await Medicine.findOneAndUpdate(
      { _id: req.params.id, pharmacy: req.user.pharmacyId },
      {
        $set: {
          price: Number(price),
          mrp: Number(mrp),
          stock: stock != null ? Number(stock) : 0,
          category: Array.isArray(category) && category.length ? category : ["Miscellaneous"],
          type: type || "Tablet",
          prescriptionRequired: !!prescriptionRequired,
          status: "active",
        },
      },
      { new: true }
    );

    if (!med) return res.status(404).json({ error: "Medicine not found." });

    // EAGER: fill description if empty
    if (!med.description) {
      try {
        const desc = await generateMedicineDescription({
          name: med.name,
          brand: med.brand,
          composition: med.composition,
          company: med.company,
          type: med.type,
        });
        if (desc && desc !== "No description available.") {
          med.description = desc;
          await med.save();
        }
      } catch (e) {
        console.error("Desc gen failed (activate):", e?.response?.data || e?.message);
      }
    }

    res.json(med);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to activate." });
  }
});

/**
 * GET /api/pharmacies/me
 */
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

/**
 * PATCH /api/pharmacies/active
 */
router.patch("/active", auth, async (req, res) => {
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

/**
 * POST /api/pharmacies/suggest-for-prescription
 */
router.post("/suggest-for-prescription", async (req, res) => {
  try {
    const { city, area, medicines } = req.body;
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

    const map = {};
    meds.forEach(med => {
      const pid = med.pharmacy._id.toString();
      if (!map[pid]) map[pid] = { pharmacy: med.pharmacy, items: [], total: 0 };
      map[pid].items.push({ name: med.name, price: med.price, quantity: 1 });
      map[pid].total += med.price;
    });

    const suggestions = Object.values(map).map(ph => {
      const allAvailable = ph.items.length === medicines.length;
      return { pharmacyId: ph.pharmacy._id, name: ph.pharmacy.name, total: ph.total, allAvailable, availableItems: ph.items };
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

/**
 * GET /api/pharmacies/nearby?lat=&lng=&maxDistance=
 */
router.get("/nearby", async (req, res) => {
  const { lat, lng, maxDistance = 8000 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat/lng required" });
  try {
    const pharmacies = await Pharmacy.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
          distanceField: "dist.calculated",
          maxDistance: parseInt(maxDistance, 10),
          spherical: true,
          query: { active: true, status: "approved" }
        }
      },
      { $limit: 25 }
    ]);
    res.json(pharmacies);
  } catch (err) {
    console.error("Geo search error:", err);
    res.status(500).json({ error: "Geo search error" });
  }
});

/**
 * PATCH /api/pharmacies/set-location
 */
router.patch("/set-location", auth, async (req, res) => {
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
    console.error("set-location error:", err);
    res.status(500).json({ message: "Failed to update location" });
  }
});

module.exports = router;
