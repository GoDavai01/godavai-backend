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
const generateDescription = require("../utils/generateDescription");

const isS3 = !!process.env.AWS_BUCKET_NAME;

let upload;
if (isS3) {
  // Use your existing S3 upload middleware (from utils/upload.js or similar)
  upload = require("../utils/upload"); // Make sure this points to your S3 multer config
} else {
  // Only set up diskStorage if NOT using S3
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      const dir = "uploads/medicines"; // relative, not absolute!
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); // Ensure parent folders!
      cb(null, dir);
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + path.extname(file.originalname));
    }
  });
  upload = multer({ storage });
}

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Add new medicine (support MULTIPLE images)
router.post("/pharmacy/medicines", upload.array("images", 5), async (req, res) => {
  try {
    const pharmacyId = req.pharmacyId || req.user?._id || req.headers["x-pharmacy-id"];
    const { name, brand, price, mrp, stock, category, discount } = req.body;
    if (!pharmacyId || !name || !brand || !price || !mrp || !stock || !category) {
      return res.status(400).json({ error: "Missing fields." });
    }

    // Handle uploaded images
    let images = [];
    if (req.files && req.files.length) {
      images = req.files.map(f => "/uploads/medicines/" + f.filename);
    }

    const med = new Medicine({
      name,
      brand,
      price,
      mrp,
      stock,
      category,
      discount: discount || 0,
      pharmacy: pharmacyId,
      img: images[0],   // for legacy single-image use
      images           // <-- All images go here!
    });

    const desc = await generateDescription(name);
    if (desc) med.description = desc;

    await med.save();
    res.json({ success: true, medicine: med });
  } catch (err) {
    console.error("Add new medicine error:", err);
    res.status(500).json({ error: "Failed to add medicine" });
  }
});

// Edit a medicine (support MULTIPLE images)
// PATCH /pharmacy/medicines/:id
router.patch("/pharmacy/medicines/:id", upload.array("images", 5), async (req, res) => {
  try {
    const med = await Medicine.findById(req.params.id);
    if (!med) return res.status(404).json({ error: "Medicine not found." });

    const { name, brand, price, mrp, stock, category, discount } = req.body;

    // Handle text fields
    if (name) med.name = name;
    if (brand) med.brand = brand;
    if (price) med.price = price;
    if (mrp) med.mrp = mrp;
    if (stock) med.stock = stock;
    if (category) med.category = category;
    if (discount !== undefined) med.discount = discount;

    if (req.files && req.files.length) {
  const images = req.files.map(f => "/uploads/medicines/" + f.filename);
  // Append to existing images, do not overwrite
  med.images = [...(med.images || []), ...images];
  // If there's no main image, set it to the first available
  if (!med.img) med.img = med.images[0];
}
    await med.save();
    res.json({ success: true, medicine: med });
  } catch (err) {
    console.error("Edit medicine error:", err);
    res.status(500).json({ error: "Failed to update medicine" });
  }
});

// Remove a single image from a medicine
router.patch("/pharmacy/medicines/:id/remove-image", async (req, res) => {
  const { image } = req.body; // pass the image URL/path to remove
  if (!image) return res.status(400).json({ error: "Image path required." });
  try {
    const med = await Medicine.findById(req.params.id);
    if (!med) return res.status(404).json({ error: "Medicine not found." });

    med.images = (med.images || []).filter(img => img !== image);

    // If main img is the one being deleted, set a new one
    if (med.img === image) med.img = med.images[0] || "";

    await med.save();

    // Optionally: delete file from disk if local storage
    // (do it carefully: don't delete from S3 or disk if that image is used by another medicine!)

    res.json({ success: true, images: med.images, img: med.img });
  } catch (err) {
    console.error("Remove medicine image error:", err);
    res.status(500).json({ error: "Failed to remove image" });
  }
});


// --- Autocomplete: Search for unique medicine names ---
router.get("/search", async (req, res) => {
  const q = req.query.q || "";
  const city = req.query.city || "";
  const area = req.query.area || "";
  if (!q) return res.json([]);
  try {
    let pharmacyFilter = { active: true };
    if (city) pharmacyFilter.city = new RegExp(city, "i");
    if (area) pharmacyFilter.area = new RegExp(area, "i");
    const pharmacies = await Pharmacy.find(pharmacyFilter).select("_id");
    const pharmacyIds = pharmacies.map(p => p._id);

    const medicines = await Medicine.find({
      name: { $regex: q, $options: "i" },
      ...(pharmacyIds.length > 0 ? { pharmacy: { $in: pharmacyIds } } : {})
    });

    const uniqueNames = [...new Set(medicines.map(m => m.name))];
    res.json(uniqueNames.map(name => ({ name })));
  } catch (err) {
    console.error("Medicine search error:", err);
    res.status(500).json({ error: "Failed to search names" });
  }
});

// --- Find all pharmacies (and price) that have a medicine ---
router.get("/find", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.json([]);
  try {
    const meds = await Medicine.find({ name: { $regex: `^${name}$`, $options: "i" } }).populate("pharmacy");
    const output = meds.map(med => ({
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

// --- Get all offers for a medicine by name (for SearchResults table) ---
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
              coordinates: [parseFloat(lng), parseFloat(lat)]
            },
            distanceField: "distance",
            maxDistance: parseInt(maxDistance), // meters
            spherical: true,
            query: { active: true, status: "approved" }
          }
        },
        { $limit: 25 }
      ]);
    } else {
      // Fallback to city/area if no location
      let pharmacyFilter = { active: true, status: "approved" };
      if (req.query.city) pharmacyFilter.city = { $regex: req.query.city, $options: "i" };
      if (req.query.area) pharmacyFilter.area = { $regex: req.query.area, $options: "i" };
      pharmacies = await Pharmacy.find(pharmacyFilter);
    }

    const pharmacyIds = pharmacies.map(p => p._id);

    // Get all medicines with this name from these pharmacies
    const meds = await Medicine.find({
      name: { $regex: `^${name}$`, $options: "i" },
      pharmacy: { $in: pharmacyIds },
      stock: { $gt: 0 }
    }).populate("pharmacy");

    // Map pharmacyId -> distance
    const distMap = {};
    pharmacies.forEach(p => distMap[p._id.toString()] = p.distance);

    // Sort medicines by distance
    meds.sort((a, b) =>
      (distMap[a.pharmacy._id.toString()] || 1e9) -
      (distMap[b.pharmacy._id.toString()] || 1e9)
    );

    // Optionally: include the pharmacy distance in response for UI
    const output = meds.map(med => ({
      pharmacy: med.pharmacy,
      pharmacyName: med.pharmacy?.name || "Unknown",
      price: med.price,
      stock: med.stock,
      medId: med._id,
      name: med.name,
      brand: med.brand,
      distance: distMap[med.pharmacy._id.toString()] || null
    }));

    res.json(output);
  } catch (err) {
    console.error("Get all offers by medicine name error:", err);
    res.status(500).json({ error: "Failed to fetch medicine listings" });
  }
});

// --- All medicines in a city (for /all-medicines page) ---
router.get("/all", async (req, res) => {
  try {
    let filter = {};
    if (req.query.city) {
      const pharmacies = await Pharmacy.find({ city: { $regex: req.query.city, $options: "i" } }).select("_id");
      const pharmacyIds = pharmacies.map(p => p._id);
      filter.pharmacy = { $in: pharmacyIds };
    }
    const medicines = await Medicine.find(filter).populate("pharmacy", "name area city");
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
    const pharmacies = await Pharmacy.find(city ? { city: { $regex: city, $options: "i" } } : {}).select("_id");
    const pharmacyIds = pharmacies.map(p => p._id.toString());

    const topMeds = await Order.aggregate([
      { $unwind: "$items" },
      { $match: { pharmacy: { $in: pharmacyIds } } },
      {
        $group: {
          _id: "$items._id",
          name: { $first: "$items.name" },
          totalOrdered: { $sum: "$items.qty" }
        }
      },
      { $sort: { totalOrdered: -1 } },
      { $limit: 10 }
    ]);

    let results = [];
    if (topMeds.length > 0) {
      const ids = topMeds.map(m => m._id);
      const medicines = await Medicine.find({ _id: { $in: ids } }).populate("pharmacy");
      const idToMed = {};
      medicines.forEach(med => { idToMed[med._id.toString()] = med; });

      results = topMeds.map(m => {
        const med = idToMed[m._id];
        return {
          _id: m._id,
          name: m.name,
          totalOrdered: m.totalOrdered,
          img: med?.img,
          price: med?.price || 0,
          pharmacy: med?.pharmacy
        };
      });
    } else {
      const allMeds = await Medicine.find(
        pharmacyIds.length > 0 ? { pharmacy: { $in: pharmacyIds } } : {}
      ).limit(10).populate("pharmacy");
      results = allMeds.map(med => ({
        _id: med._id,
        name: med.name,
        totalOrdered: 0,
        img: med.img,
        price: med.price,
        pharmacy: med.pharmacy
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
      name: med.name
    }).populate({
      path: "pharmacy",
      match: pharmacyFilter,
      select: "name city area"
    });

    const pharmacies = offers
      .filter(o => o.pharmacy)
      .map(o => ({
        pharmacy: {
          _id: o.pharmacy._id,
          name: o.pharmacy.name,
          city: o.pharmacy.city,
          area: o.pharmacy.area
        },
        price: o.price
      }));

    res.json(pharmacies);
  } catch (err) {
    console.error("Offers for med error:", err);
    res.status(500).json({ error: "Failed to fetch offers" });
  }
});

// GET /api/medicines/suggestions?pharmacyId=...&exclude=a,b,c&limit=10
router.get("/suggestions", async (req, res) => {
  try {
    const { pharmacyId, exclude = "", limit = 10 } = req.query;

    if (!pharmacyId) {
      return res.status(400).json({ message: "pharmacyId is required" });
    }

    const lim = Math.min(parseInt(limit || 10, 10), 50);

    // exclude can be a comma-separated list of ids
    const excludeIds = exclude
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && mongoose.Types.ObjectId.isValid(s))
      .map((s) => new mongoose.Types.ObjectId(s));

    // Support schemas that use either `pharmacy` (ObjectId) or `pharmacyId` (string)
    const baseFilter = {
      $or: [{ pharmacy: pharmacyId }, { pharmacyId }],
    };

    const filter =
      excludeIds.length > 0
        ? { $and: [baseFilter, { _id: { $nin: excludeIds } }] }
        : baseFilter;

    const items = await Medicine.find(filter)
      .select("_id name price brand img mrp category pharmacy pharmacyId")
      .sort({ popularity: -1, createdAt: -1 })
      .limit(lim)
      .lean();

    // Ensure both fields exist for the client (harmless if one is missing)
    const normalized = items.map((doc) => ({
      ...doc,
      pharmacyId: doc.pharmacyId || doc.pharmacy,
    }));

    return res.json(normalized);
  } catch (err) {
    console.error("GET /api/medicines/suggestions error:", err);
    return res.status(500).json({ message: "Failed to fetch suggestions" });
  }
});

module.exports = router;
