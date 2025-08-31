// routes/medicines.js 
const express = require("express");
const router = express.Router();
const Medicine = require("../models/Medicine");
const Pharmacy = require("../models/Pharmacy");
const Order = require("../models/Order");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const {
  Types: { ObjectId },
} = mongoose;

// auth is still used by some routes below (e.g., if you later secure them)
const auth = require("../middleware/auth");

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// --- helpers to normalize mixed inputs (JSON vs multipart) ---
function normalizeCategory(input) {
  let cat = input;
  try {
    if (typeof cat === "string" && cat.trim().startsWith("[")) {
      cat = JSON.parse(cat);
    }
  } catch (_) {}
  if (!Array.isArray(cat)) cat = cat ? [String(cat)] : ["Miscellaneous"];
  return cat;
}
const asTrimmedString = (v) => (v ?? "").toString().trim();

/* ------------------------------------------------------------------
   IMPORTANT:
   The POST /pharmacy/medicines and PATCH /pharmacy/medicines/:id
   handlers have been REMOVED here to avoid duplicates.

   Your tolerant versions live in app.js and will now handle both:
   - multipart (with images) and
   - JSON (no images)
------------------------------------------------------------------- */

// Remove a single image from a medicine (keep this for the UI dialog)
router.patch("/pharmacy/medicines/:id/remove-image", async (req, res) => {
  const { image } = req.body; // pass the image URL/path to remove
  if (!image) return res.status(400).json({ error: "Image path required." });
  try {
    const med = await Medicine.findById(req.params.id);
    if (!med) return res.status(404).json({ error: "Medicine not found." });

    med.images = (med.images || []).filter((img) => img !== image);

    // If main img is the one being deleted, set a new one
    if (med.img === image) med.img = med.images[0] || "";

    await med.save();

    res.json({ success: true, images: med.images, img: med.img });
  } catch (err) {
    console.error("Remove medicine image error:", err);
    res.status(500).json({ error: "Failed to remove image" });
  }
});

/* ========================= REPLACED: /search ========================= */
// Escape user input used in RegExp
const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/search", async (req, res) => {
  let {
    q = "",
    lat,
    lng,
    city = "",
    area = "",
    maxDistance = 8000,
    limit = 80,
    dedupe = "true",
  } = req.query;

  q = String(q || "").trim();
  if (!q) return res.json([]);

  try {
    const rx = new RegExp(escapeRegex(q), "i");

    // collect eligible pharmacies (nearby or by city/area)
    let pharmacyIds = [];
    const pharmacyBase = { active: true, status: "approved" };

    if (lat && lng) {
      const nearby = await Pharmacy.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
            distanceField: "distance",
            maxDistance: parseInt(maxDistance, 10) || 8000,
            spherical: true,
            query: pharmacyBase,
          },
        },
        { $project: { _id: 1 } },
        { $limit: 100 },
      ]);
      pharmacyIds = nearby.map((p) => p._id);
    } else {
      const pf = { ...pharmacyBase };
      if (city) pf.city = { $regex: city, $options: "i" };
      if (area) pf.area = { $regex: area, $options: "i" };
      const phs = await Pharmacy.find(pf).select("_id");
      pharmacyIds = phs.map((p) => p._id);
    }

    // match any of these fields
    const or = [
      { name: rx },
      { brand: rx },
      { company: rx },
      { composition: rx },
      { category: rx },
      { type: rx },
    ];

    const meds = await Medicine.find({
      $or: or,
      ...(pharmacyIds.length ? { pharmacy: { $in: pharmacyIds } } : {}),
    })
      .select("name brand company composition category type img images mrp price pharmacy")
      .limit(parseInt(limit, 10) || 80)
      .lean();

    // dedupe by (brand||name + composition)
    let out = meds;
    if (dedupe !== "false") {
      const seen = new Set();
      out = meds.filter((m) => {
        const key = `${(m.brand || m.name || "").toLowerCase()}|${(m.composition || "").toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    res.json(out);
  } catch (err) {
    console.error("Medicine search error:", err);
    res.status(500).json({ error: "Failed to search medicines" });
  }
});
/* ==================================================================== */

// --- Find all pharmacies (and price) that have a medicine ---
router.get("/find", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.json([]);
  try {
    const meds = await Medicine.find({
      name: { $regex: `^${name}$`, $options: "i" },
    }).populate("pharmacy");
    const output = meds.map((med) => ({
      pharmacyName: med.pharmacy?.name || "Unknown",
      pharmacyId: med.pharmacy?._id,
      price: med.price,
      medId: med._id,
      name: med.name,
      brand: med.brand,
    }));
    res.json(output);
  } catch (err) {
    console.error("Find pharmacies for medicine error:", err);
    res.status(500).json({ error: "Failed to fetch medicine listings" });
  }
});

/* ======= UPDATED: /by-name tolerant of partial queries ======= */
const nameToRegexes = (name) => [
  new RegExp(`^${escapeRegex(name)}$`, "i"), // exact
  new RegExp(`^${escapeRegex(name)}`, "i"),  // prefix
  new RegExp(escapeRegex(name), "i"),        // contains
];

router.get("/by-name", async (req, res) => {
  let { name, lat, lng, maxDistance = 8000 } = req.query;
  if (!name) return res.json([]);

  try {
    let pharmacies = [];
    if (lat && lng) {
      pharmacies = await Pharmacy.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [parseFloat(lng), parseFloat(lat)],
            },
            distanceField: "distance",
            maxDistance: parseInt(maxDistance, 10),
            spherical: true,
            query: { active: true, status: "approved" },
          },
        },
        { $limit: 25 },
      ]);
    } else {
      // Fallback to city/area if no location
      let pharmacyFilter = { active: true, status: "approved" };
      if (req.query.city)
        pharmacyFilter.city = { $regex: req.query.city, $options: "i" };
      if (req.query.area)
        pharmacyFilter.area = { $regex: req.query.area, $options: "i" };
      pharmacies = await Pharmacy.find(pharmacyFilter);
    }

    const pharmacyIds = pharmacies.map((p) => p._id);
    const distMap = Object.fromEntries(pharmacies.map((p) => [String(p._id), p.distance]));

    let meds = [];
    for (const rx of nameToRegexes(name)) {
      meds = await Medicine.find({
        name: { $regex: rx },
        pharmacy: { $in: pharmacyIds },
        stock: { $gt: 0 },
      }).populate("pharmacy");
      if (meds.length) break;
    }

    meds.sort(
      (a, b) =>
        (distMap[String(a.pharmacy?._id)] ?? 1e9) -
        (distMap[String(b.pharmacy?._id)] ?? 1e9)
    );

    const output = meds.map((med) => ({
      pharmacy: med.pharmacy,
      pharmacyName: med.pharmacy?.name || "Unknown",
      price: med.price,
      stock: med.stock,
      medId: med._id,
      name: med.name,
      brand: med.brand,
      distance: distMap[String(med.pharmacy?._id)] ?? null,
    }));

    res.json(output);
  } catch (err) {
    console.error("Get all offers by medicine name error:", err);
    res.status(500).json({ error: "Failed to fetch medicine listings" });
  }
});
/* ============================================================ */

// --- All medicines in a city (for /all-medicines page) ---
router.get("/all", async (req, res) => {
  try {
    let filter = {};
    if (req.query.city) {
      const pharmacies = await Pharmacy.find({
        city: { $regex: req.query.city, $options: "i" },
      }).select("_id");
      const pharmacyIds = pharmacies.map((p) => p._id);
      filter.pharmacy = { $in: pharmacyIds };
    }
    const medicines = await Medicine.find(filter).populate(
      "pharmacy",
      "name area city"
    );
    res.json(medicines);
  } catch (err) {
    console.error("All medicines in city error:", err);
    res.status(500).json({ error: "Failed to fetch medicines" });
  }
});

// --- Most Ordered Medicines ---
async function getMostOrderedMedicines(req, res) {
  try {
    const city = req.query.city || "";
    const pharmacies = await Pharmacy.find(
      city ? { city: { $regex: city, $options: "i" } } : {}
    ).select("_id");
    const pharmacyIds = pharmacies.map((p) => p._id.toString());

    const topMeds = await Order.aggregate([
      { $unwind: "$items" },
      { $match: { pharmacy: { $in: pharmacyIds } } },
      {
        $group: {
          _id: "$items._id",
          name: { $first: "$items.name" },
          totalOrdered: { $sum: "$items.qty" },
        },
      },
      { $sort: { totalOrdered: -1 } },
      { $limit: 10 },
    ]);

    let results = [];
    if (topMeds.length > 0) {
      const ids = topMeds.map((m) => m._id);
      const medicines = await Medicine.find({ _id: { $in: ids } }).populate(
        "pharmacy"
      );
      const idToMed = {};
      medicines.forEach((med) => {
        idToMed[med._id.toString()] = med;
      });

      results = topMeds.map((m) => {
        const med = idToMed[m._id];
        return {
          _id: m._id,
          name: m.name,
          totalOrdered: m.totalOrdered,
          img: med?.img,
          price: med?.price || 0,
          pharmacy: med?.pharmacy,
        };
      });
    } else {
      const allMeds = await Medicine.find(
        pharmacyIds.length > 0 ? { pharmacy: { $in: pharmacyIds } } : {}
      )
        .limit(10)
        .populate("pharmacy");
      results = allMeds.map((med) => ({
        _id: med._id,
        name: med.name,
        totalOrdered: 0,
        img: med.img,
        price: med.price,
        pharmacy: med.pharmacy,
      }));
    }

    res.json(results);
  } catch (err) {
    console.error("Get most ordered medicines error:", err);
    res.status(500).json({ error: "Failed to fetch top ordered medicines" });
  }
}
router.get("/top", getMostOrderedMedicines);
router.get("/most-ordered", getMostOrderedMedicines);

// --- Offers ---
router.get("/offers", async (req, res) => {
  const { medId, city } = req.query;
  if (!medId) return res.status(400).json({ error: "medId is required" });
  if (!isValidId(medId)) return res.status(400).json({ error: "Invalid medId" });
  try {
    const med = await Medicine.findById(medId);
    if (!med) return res.status(404).json({ error: "Medicine not found" });

    let pharmacyFilter = {};
    if (city) pharmacyFilter.city = { $regex: city, $options: "i" };

    const offers = await Medicine.find({
      name: med.name,
    }).populate({
      path: "pharmacy",
      match: pharmacyFilter,
      select: "name city area",
    });

    const pharmacies = offers
      .filter((o) => o.pharmacy)
      .map((o) => ({
        pharmacy: {
          _id: o.pharmacy._id,
          name: o.pharmacy.name,
          city: o.pharmacy.city,
          area: o.pharmacy.area,
        },
        price: o.price,
      }));

    res.json(pharmacies);
  } catch (err) {
    console.error("Offers for med error:", err);
    res.status(500).json({ error: "Failed to fetch offers" });
  }
});

module.exports = router;
