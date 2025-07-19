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

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "../uploads/medicines");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); // Ensure parent folders!
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});


const upload = multer({ storage });

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Add new medicine (image optional)
router.post("/pharmacy/medicines", upload.single("image"), async (req, res) => {
  try {
    const pharmacyId = req.pharmacyId || req.user?._id || req.headers["x-pharmacy-id"];
    const { name, brand, price, mrp, stock, category, discount } = req.body;
    if (!pharmacyId || !name || !brand || !price || !mrp || !stock || !category) {
      return res.status(400).json({ error: "Missing fields." });
    }
    const med = new Medicine({
      name,
      brand,
      price,
      mrp,
      stock,
      category,
      discount: discount || 0,
      pharmacy: pharmacyId
    });
    if (req.file) {
      med.img = "/uploads/medicines/" + req.file.filename;
    }
    const desc = await generateDescription(name);
    if (desc) med.description = desc;
    await med.save();
    res.json({ success: true, medicine: med });
  } catch (err) {
    console.error("Add new medicine error:", err);
    res.status(500).json({ error: "Failed to add medicine" });
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

module.exports = router;
