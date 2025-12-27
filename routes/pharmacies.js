// routes/pharmacies.js
const express = require("express");
const router = express.Router();
const Pharmacy = require("../models/Pharmacy");
const Medicine = require("../models/Medicine");
const auth = require("../middleware/auth");
const mongoose = require("mongoose");
const generateMedicineDescription = require("../utils/generateDescription");
const buildCompositionKey = require("../utils/buildCompositionKey");

// ✅ NEW: Master + Inventory models
const PharmacyInventory = require("../models/PharmacyInventory");
const MedicineMaster = require("../models/MedicineMaster");

// ✅ Shared field list for /alternatives so results include `pharmacy`
const ALT_PUBLIC_FIELDS =
  "_id name brand composition compositionKey company price mrp discount stock img images packCount packUnit productKind pharmacy";

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

    const pharmacies = await Pharmacy.find(query).select("-legalEntityName");
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
    const { city = "", area = "", all, location, trending } = req.query;

    const q = {};
    // default: only active unless all=1|true
    if (!(all === "1" || all === "true")) q.active = true;

    if (city) q.city = new RegExp(city, "i");
    if (area) q.area = new RegExp(area, "i");

    // optional "location" search that matches either city or area
    if (location) {
      q.$or = [
        { city: new RegExp(location, "i") },
        { area: new RegExp(location, "i") }
      ];
    }

    // optional trending filter
    if (trending === "1" || trending === "true") q.trending = true;

    const pharmacies = await Pharmacy.find(q).select("-legalEntityName");
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
 * ✅✅✅ NEW INVENTORY ROUTES (Master -> Pharmacy inventory with overrides)
 *
 * ✅ ADD TO INVENTORY FROM MASTER (and optionally override)
 * POST /api/pharmacies/inventory/add
 * body: { medicineMasterId, sellingPrice, mrp, discount, stockQty, images[] }
 */
router.post("/inventory/add", auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ error: "Not authorized" });

    const { medicineMasterId, sellingPrice, mrp, discount, stockQty, images } = req.body;

    const master = await MedicineMaster.findById(medicineMasterId);
    if (!master || master.status !== "approved" || !master.active) {
      return res.status(404).json({ error: "Master medicine not found/approved." });
    }

    // upsert so duplicate na bane
    const inv = await PharmacyInventory.findOneAndUpdate(
      { pharmacyId: req.user.pharmacyId, medicineMasterId },
      {
        $set: {
          sellingPrice: Number(sellingPrice ?? master.price ?? 0),
          mrp: Number(mrp ?? master.mrp ?? 0),
          discount: Number(discount ?? master.discount ?? 0),
          stockQty: Number(stockQty ?? 0),
          images: Array.isArray(images) ? images : [],
          isActive: true,
        },
      },
      { upsert: true, new: true }
    ).populate("medicineMasterId");

    res.json(inv);
  } catch (e) {
    res.status(400).json({ error: (e && e.message) || "Failed to add inventory." });
  }
});

/**
 * ✅ UPDATE INVENTORY (override only for that pharmacy)
 * PATCH /api/pharmacies/inventory/:id
 */
router.patch("/inventory/:id", auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ error: "Not authorized" });

    const inv = await PharmacyInventory.findOneAndUpdate(
      { _id: req.params.id, pharmacyId: req.user.pharmacyId },
      { $set: req.body },
      { new: true }
    ).populate("medicineMasterId");

    if (!inv) return res.status(404).json({ error: "Inventory not found." });
    res.json(inv);
  } catch (e) {
    res.status(400).json({ error: (e && e.message) || "Failed to update inventory." });
  }
});

/**
 * ✅ LIST INVENTORY (merged view)
 * GET /api/pharmacies/inventory
 */
router.get("/inventory", auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ error: "Not authorized" });

    const list = await PharmacyInventory.find({
      pharmacyId: req.user.pharmacyId,
      isActive: true,
    }).populate("medicineMasterId");

    // merge master + override for easy UI
    const merged = list.map((x) => {
      const m = (x.medicineMasterId && x.medicineMasterId.toObject) ? x.medicineMasterId.toObject() : {};
      const inv = x.toObject();

      return {
        _id: inv._id,
        medicineMasterId: m._id,

        // master fields:
        name: m.name,
        brand: m.brand,
        composition: m.composition,
        company: m.company,
        category: m.category,
        type: m.type,
        customType: m.customType,
        prescriptionRequired: m.prescriptionRequired,
        productKind: m.productKind,
        hsn: m.hsn,
        gstRate: m.gstRate,
        packCount: m.packCount,
        packUnit: m.packUnit,
        description: m.description,

        // effective fields (override wins)
        price: inv.sellingPrice != null ? inv.sellingPrice : m.price,
        mrp: inv.mrp != null ? inv.mrp : m.mrp,
        discount: inv.discount != null ? inv.discount : m.discount,
        stockQty: inv.stockQty != null ? inv.stockQty : 0,
        images: (inv.images && inv.images.length ? inv.images : (m.images || [])) || [],
      };
    });

    res.json(merged);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch inventory." });
  }
});

/**
 * POST /api/pharmacies/medicines/quick-add-draft
 * Creates a draft medicine quickly AND eagerly generates description.
 */
router.post("/medicines/quick-add-draft", auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ error: "Not authorized" });

    const { name, brand, composition, company, productKind, hsn, gstRate, packCount, packUnit } = req.body;
    if (!brand && !composition) {
      return res.status(400).json({ error: "Provide at least Brand or Composition." });
    }

    let doc = await Medicine.create({
      name: name || brand || composition || "Draft",
      brand: (String(productKind).toLowerCase() === "generic") ? "" : (brand || ""),
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
      // NEW FIELDS
      productKind: (String(productKind).toLowerCase() === "generic") ? "generic" : "branded",
      hsn: (hsn && String(hsn).replace(/[^\d]/g,"")) || "3004",
      gstRate: [0,5,12,18].includes(Number(gstRate)) ? Number(gstRate) : 0,
      packCount: Number(packCount) || 0,
      packUnit: packUnit || "",
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

    const { price, mrp, stock, category, type, prescriptionRequired,
            productKind, hsn, gstRate, packCount, packUnit } = req.body;
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
          // NEW OPTIONAL FIELD UPDATES
          ...(productKind != null ? { productKind: String(productKind).toLowerCase() === "generic" ? "generic" : "branded" } : {}),
          ...(hsn != null ? { hsn: String(hsn).replace(/[^\d]/g,"") || "3004" } : {}),
          ...(gstRate != null ? { gstRate: [0,5,12,18].includes(Number(gstRate)) ? Number(gstRate) : 0 } : {}),
          ...(packCount != null ? { packCount: Number(packCount) || 0 } : {}),
          ...(packUnit != null ? { packUnit: String(packUnit) } : {}),
        },
      },
      { new: true }
    );

    if (!med) return res.status(404).json({ error: "Medicine not found." });

    // If switching to generic, ensure brand is blank
    if (productKind && String(productKind).toLowerCase() === "generic") {
      med.brand = "";
      await med.save();
    }

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
 * Strict validation + safe geoNear
 */
router.get("/nearby", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const maxDistance = Number(req.query.maxDistance || 8000);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat/lng must be numbers" });
  }

  try {
    const pharmacies = await Pharmacy.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] }, // [lng, lat]
          distanceField: "distanceMeters",                  // flat numeric field
          maxDistance: Number.isFinite(maxDistance) ? maxDistance : 8000,
          spherical: true,
          query: { active: true, status: "approved" },
        },
      },
      // WHITELIST ONLY SAFE FIELDS!
      {
        $project: {
          name: 1,
          city: 1,
          area: 1,
          "location.formatted": 1,
          "location.coordinates": 1,
          rating: 1,
          createdAt: 1,
          distanceMeters: 1,
          distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 2] },
        },
      },
      { $sort: { distanceMeters: 1, rating: -1, createdAt: 1 } },
      { $limit: 25 },
    ]);

    res.json(pharmacies);
  } catch (err) {
    console.error("Geo search error:", err?.message || err);
    res.status(500).json({
      error: "Geo search error",
      hint: "Ensure a 2dsphere index on 'location' exists in production.",
    });
  }
});

/**
 * PATCH /api/pharmacies/set-location
 */
router.patch("/set-location", auth, async (req, res) => {
  if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });

  const { lat, lng, formatted } = req.body;
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return res.status(400).json({ message: "lat/lng must be numbers" });
  }

  try {
    const updated = await Pharmacy.findByIdAndUpdate(
      req.user.pharmacyId,
      { location: { type: "Point", coordinates: [lo, la], formatted: formatted || "" } },
      { new: true }
    );
    res.json({ message: "Location updated", location: updated.location });
  } catch (err) {
    console.error("set-location error:", err);
    res.status(500).json({ message: "Failed to update location" });
  }
});

/**
 * POST /api/pharmacies/register-device-token
 * Body: { token, platform }
 */
router.post("/register-device-token", auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ message: "Not authorized" });
    const { token, platform = "android" } = req.body || {};
    if (!token) return res.status(400).json({ message: "token required" });

    const doc = await Pharmacy.findById(req.user.pharmacyId);
    if (!doc) return res.status(404).json({ message: "Pharmacy not found" });

    doc.deviceTokens = Array.isArray(doc.deviceTokens) ? doc.deviceTokens : [];
    const exists = doc.deviceTokens.some(t => t.token === token);
    if (!exists) doc.deviceTokens.push({ token, platform });
    await doc.save();
    res.json({ ok: true });
  } catch (e) {
    console.error("register-device-token error:", e?.message || e);
    res.status(500).json({ message: "Failed to register token" });
  }
});

// GET /api/pharmacies/:pharmacyId/alternatives?compositionKey=...&brandId=...
router.get("/:pharmacyId/alternatives", async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    let { compositionKey = "", brandId = "" } = req.query;

    if (!mongoose.Types.ObjectId.isValid(pharmacyId)) {
      return res.status(400).json({ error: "Invalid pharmacyId" });
    }

    const pid = new mongoose.Types.ObjectId(pharmacyId);

    // Helper to sanitize public fields (hide tax fields)
    const scrub = (m) => {
      if (!m) return null;
      const o = { ...m };
      delete o.hsn;
      delete o.gstRate;
      return o;
    };

    // 1) If brandId present, fetch it for context (and fallback comp)
    let brand = null;
    if (brandId && mongoose.Types.ObjectId.isValid(brandId)) {
      brand = await Medicine.findOne({
        _id: brandId,
        pharmacy: pid,
        status: { $ne: "unavailable" },
        available: { $ne: false },
        stock: { $gt: 0 },
      })
        .select(ALT_PUBLIC_FIELDS) // ✅ include pharmacy
        .lean();

      if (brand && !compositionKey) compositionKey = brand.composition || "";
    }

    // 2) Normalize key on server (even if client sent it)
    compositionKey = buildCompositionKey(String(compositionKey || "").trim());
    if (!compositionKey) {
      return res.json({ brand: scrub(brand), generics: [] });
    }

    // 3) Fetch generics by exact normalized key in SAME pharmacy
    const generics = await Medicine.find({
      pharmacy: pid,
      compositionKey,
      // accept both properly-tagged generics and legacy rows with empty brand
      $or: [{ productKind: "generic" }, { brand: "" }],
      status: { $ne: "unavailable" },
      available: { $ne: false },
      stock: { $gt: 0 },
    })
      .select(ALT_PUBLIC_FIELDS) // ✅ includes pharmacy
      .sort({ price: 1, mrp: 1, _id: 1 })
      .lean();

    // 4) If no brand passed in, try to pick a branded counterpart (cheapest)
    if (!brand) {
      brand = await Medicine.findOne({
        pharmacy: pid,
        productKind: "branded",
        compositionKey,
        status: { $ne: "unavailable" },
        available: { $ne: false },
        stock: { $gt: 0 },
      })
        .select(ALT_PUBLIC_FIELDS) // ✅ include pharmacy
        .sort({ price: 1, mrp: 1, _id: 1 })
        .lean();
    }

    res.json({
      brand: scrub(brand),
      generics: (generics || []).map(scrub),
    });
  } catch (err) {
    console.error("GET /:pharmacyId/alternatives error:", err);
    res.status(500).json({ error: "Failed to fetch alternatives" });
  }
});

module.exports = router;
