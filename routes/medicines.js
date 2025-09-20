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

// ---- GPT description generator (used below) ----
const generateDesc = require("../utils/generateDescription");

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

// treat empty, whitespace, the sentinel, or old long paragraphs (no bullets) as "missing"
const isBulleted = (s) => /(^|\n)\s*(?:•|-|\d+\.)\s+/.test(String(s || ""));
const isMissingDesc = (s) => {
  const t = String(s || "").trim();
  if (!t) return true;
  if (/^no description available\.?$/i.test(t)) return true;
  // legacy long paragraph (not bulleted) → replace
  if (t.length > 240 && !isBulleted(t)) return true;
  return false;
};

const pLimit = (concurrency) => {
  const q = [];
  let active = 0;
  const next = () => {
    active--;
    if (q.length) q.shift()();
  };
  return async (fn) =>
    new Promise((resolve, reject) => {
      const run = async () => {
        active++;
        try { resolve(await fn()); }
        catch (e) { reject(e); }
        finally { next(); }
      };
      if (active < concurrency) run();
      else q.push(run);
    });
};

// --- ENSURE DESCRIPTION NOW (idempotent) ---
router.post("/medicines/:id/ensure-description", async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const med = await Medicine.findById(id);
    if (!med) return res.status(404).json({ error: "Medicine not found" });

    // If already present, just return it
   if (!isMissingDesc(med.description)) {
      return res.json({ ok: true, description: med.description });
    }

    // Guard: GPT stage flag
    if (String(process.env.GPT_MED_STAGE || "1") !== "1") {
      return res.json({ ok: false, error: "GPT disabled", description: "" });
    }

    // Generate
    const text = await require("../utils/generateDescription")({
      name: med.name,
      brand: med.brand,
      composition: med.composition,
      company: med.company,
      type: med.type,
    });

    if (text && text !== "No description available.") {
      med.description = text;
      await med.save();
      return res.json({ ok: true, description: text });
    }

    return res.json({ ok: false, description: "" });
  } catch (e) {
    console.error("ensure-description error:", e?.response?.data || e.message);
    res.status(500).json({ error: "Failed to ensure description" });
  }
});

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
      status: { $ne: "unavailable" },
      available: { $ne: false },
      stock: { $gt: 0 },
    })
      .select("name brand company composition category type img images mrp price pharmacy description")
      .limit(parseInt(limit, 10) || 80)
      .lean();

    // >>>>>>>>>>>>>>>>>>>>>>> PASTE BLOCK STARTS HERE <<<<<<<<<<<<<<<<<<<<<<<<
    // also compact/fill for search results
    const shouldFill = String(process.env.GPT_MED_STAGE || "1") === "1";
    if (shouldFill) {
      const toFix = meds.filter(m => isMissingDesc(m.description));
      if (toFix.length) {
        const limiter = pLimit(3);
        await Promise.all(
          toFix.map(m => limiter(async () => {
            try {
              const text = await generateDesc({
                name: m.name,
                brand: m.brand,
                composition: m.composition,
                company: m.company,
                type: m.type,
              });
              if (text && text !== "No description available.") {
                await Medicine.updateOne({ _id: m._id }, { $set: { description: text } });
                const hit = meds.find(x => String(x._id) === String(m._id));
                if (hit) hit.description = text;
              }
            } catch (e) {
              console.error("Desc gen (search) failed:", m.name, e?.response?.data || e.message);
            }
          }))
        );
      }
    }
    // >>>>>>>>>>>>>>>>>>>>>>>  PASTE BLOCK ENDS HERE  <<<<<<<<<<<<<<<<<<<<<<<<

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
        status: { $ne: "unavailable" },
        available: { $ne: false },
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
    const medicines = await Medicine.find({
      ...filter,
      status: { $ne: "unavailable" },
      available: { $ne: false },
    })
    .select("-hsn -gstRate")
    .populate(
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
      ).find({
        status: { $ne: "unavailable" },
        available: { $ne: false },
        stock: { $gt: 0 },
      })
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
      status: { $ne: "unavailable" },
      available: { $ne: false },
      stock: { $gt: 0 },
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

// ===== ADMIN: Backfill missing descriptions =====
router.post("/admin/backfill-descriptions", async (req, res) => {
  try {
    const limit = Number(req.body.limit || 20); // optional batch size
    const meds = await Medicine.find({
      $or: [
        { description: { $exists: false } },
        { description: { $in: [null, ""] } },
        { description: { $regex: /^no description available\.?$/i } }
        ]
    }).limit(limit);

    if (!meds.length) {
      return res.json({ message: "All medicines already have descriptions" });
    }

    const results = [];
    for (const med of meds) {
      try {
        const desc = await generateDesc({
          name: med.name,
          brand: med.brand,
          composition: med.composition,
          company: med.company,
          type: med.type,
        });
        if (desc && desc !== "No description available.") {
          med.description = desc;
          await med.save();
          results.push({ id: med._id, name: med.name, ok: true });
        } else {
          results.push({ id: med._id, name: med.name, ok: false });
        }
      } catch (err) {
        console.error("Backfill failed for", med.name, err.message);
        results.push({ id: med._id, name: med.name, ok: false, error: err.message });
      }
    }

    res.json({ filled: results.length, results });
  } catch (err) {
    console.error("Backfill error:", err);
    res.status(500).json({ error: "Failed to backfill descriptions" });
  }
});

/**
 * GET /api/medicines?pharmacyId=<id>
 * - Returns medicines for a pharmacy
 * - If description is empty, eagerly generates one, persists, and includes it in response.
 */
router.get("/medicines", async (req, res) => {
  try {
    const { pharmacyId } = req.query;
    const filter = pharmacyId ? { pharmacy: pharmacyId } : {};
        // default: hide unavailable unless onlyAvailable="0"
        if (String(req.query.onlyAvailable || "1") === "1") {
      filter.status = { $ne: "unavailable" };
      filter.available = { $ne: false };
      filter.stock = { $gt: 0 };
    }

    const meds = await Medicine.find(filter).lean(); // lean for speed

    // nothing to do?
    if (!Array.isArray(meds) || meds.length === 0) return res.json([]);

    // only if GPT is enabled
    const shouldFill = String(process.env.GPT_MED_STAGE || "1") === "1";
    if (!shouldFill) return res.json(meds);

    // fill only missing ones
    const missing = meds.filter(m => isMissingDesc(m.description));

    if (missing.length) {
      const limit = pLimit(3); // be nice to the API
      await Promise.all(
        missing.map(m => limit(async () => {
          try {
            const text = await generateDesc({
              name: m.name,
              brand: m.brand,
              composition: m.composition,
              company: m.company,
              type: m.type,
            });
            if (text && text !== "No description available.") {
              await Medicine.updateOne({ _id: m._id }, { $set: { description: text } });
              // also mutate our local copy so response includes it now
              const hit = meds.find(x => String(x._id) === String(m._id));
              if (hit) hit.description = text;
            }
          } catch (e) {
            console.error("Desc gen (on-read) failed:", m.name, e?.response?.data || e.message);
          }
        }))
      );
    }
    // PRIVACY: strip tax fields before sending to clients
    for (const m of meds) {
      delete m.hsn;
      delete m.gstRate;
    }

    res.json(meds);
  } catch (err) {
    console.error("GET /api/medicines error:", err);
    res.status(500).json({ error: "Failed to fetch medicines" });
  }
});
/* ============================================================= */

// --- DEBUG: GPT MED FLAGS ---
router.get("/debug/gpt-med", (req, res) => {
  res.json({
    GPT_MED_STAGE: String(process.env.GPT_MED_STAGE || ""),
    GPT_MED_MODEL: String(process.env.GPT_MED_MODEL || ""),
    OPENAI_KEY_SET: !!process.env.OPENAI_API_KEY,
  });
});

// --- Autocomplete for live search bar (name, brand, composition, category, company) ---
router.get("/autocomplete", async (req, res) => {
  let { q = "", limit = 10, city = "" } = req.query;
  q = String(q || "").trim();
  if (!q) return res.json([]);

  try {
    const rx = new RegExp(escapeRegex(q), "i");

    // optional: restrict to pharmacies in city
    let pharmacyIds = [];
    if (city) {
      const phs = await Pharmacy.find({
        city: { $regex: city, $options: "i" },
        active: true,
        status: "approved"
      }).select("_id");
      pharmacyIds = phs.map(p => p._id);
    }

    const meds = await Medicine.find({
      $or: [
        { name: rx },
        { brand: rx },
        { composition: rx },
        { company: rx },
        { category: rx }
      ],
      ...(pharmacyIds.length ? { pharmacy: { $in: pharmacyIds } } : {})
    })
      .select("name brand composition company category")
      .limit(parseInt(limit, 10));

    // Prefer composition when it matches the query, then fall back to brand/name.
// Keep the same object shape (id, label, composition, category, company).
const seen = new Set();
const suggestions = [];
const lim = Math.min(parseInt(limit, 10) || 10, 50);

const push = (m, label) => {
  const t = String(label || "").trim();
  if (!t) return;
  const key = t.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  suggestions.push({
    id: m._id,
    label: t,
    composition: m.composition,
    category: m.category,
    company: m.company
  });
};

for (const m of meds) {
  // 1) If composition matches the query, show that first
  if (m.composition && rx.test(String(m.composition))) {
    push(m, m.composition);
    if (suggestions.length >= lim) break;
  }

  // 2) Primary fallback label: brand > name > company > first category
  const primary =
    m.brand ||
    m.name ||
    m.company ||
    (Array.isArray(m.category) ? m.category[0] : m.category);

  push(m, primary);

  if (suggestions.length >= lim) break;
}

return res.json(suggestions);

  } catch (err) {
    console.error("Autocomplete error:", err);
    res.status(500).json({ error: "Failed to autocomplete" });
  }
});


module.exports = router;
