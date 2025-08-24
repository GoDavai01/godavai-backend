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
const {
  Types: { ObjectId },
} = mongoose;

const auth = require("../middleware/auth");

const isS3 = !!process.env.AWS_BUCKET_NAME;

/* ---------- tolerant upload helper (accept any image field) ---------- */
const makeUploadAny = () => {
  if (isS3) {
    const s3Upload = require("../utils/upload"); // your S3 multer config
    return s3Upload.any ? s3Upload.any() : s3Upload;
  } else {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = "uploads/medicines";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) =>
        cb(null, Date.now() + path.extname(file.originalname)),
    });
    return multer({ storage }).any();
  }
};
const uploadAny = makeUploadAny();
const isMultipart = (req) =>
  (req.headers["content-type"] || "")
    .toLowerCase()
    .includes("multipart/form-data");
/* -------------------------------------------------------------------- */

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

/* ===================== ADD MEDICINE (JSON or multipart) ===================== */
router.post("/pharmacy/medicines", auth, (req, res) => {
  const run = async () => {
    try {
      const pharmacyId = req.user?.pharmacyId || req.headers["x-pharmacy-id"];
      const {
        name,
        brand,
        price,
        mrp,
        stock,
        category,
        discount,
        composition,
        company,
        type,
        customType,
      } = req.body;

      if (
        !pharmacyId ||
        (!name && !brand) ||
        price === undefined ||
        mrp === undefined ||
        stock === undefined
      ) {
        return res.status(400).json({ error: "Missing fields." });
      }

      // numeric coercion + validation
      const num = (v) =>
        v === "" || v === null || v === undefined ? NaN : Number(v);
      const priceNum = num(price);
      const mrpNum = num(mrp);
      const stockNum = num(stock);
      const discNum = isNaN(num(discount)) ? 0 : num(discount);
      if ([priceNum, mrpNum, stockNum].some(Number.isNaN)) {
        return res
          .status(400)
          .json({ error: "price/mrp/stock must be numbers" });
      }

      // normalize category / type to match schema at runtime
      const normalizeList = (x) => {
        try {
          if (typeof x === "string" && x.trim().startsWith("[")) {
            return JSON.parse(x);
          }
        } catch {}
        return Array.isArray(x) ? x : x ? [String(x)] : [];
      };

      const catList = normalizeList(category);
      const catIsArrayInSchema =
        (Medicine.schema.paths.category?.instance || "").toLowerCase() ===
        "array";
      const categoryValue = catIsArrayInSchema
        ? catList.length
          ? catList
          : ["Miscellaneous"]
        : catList[0] || "Miscellaneous";

      const typeList = normalizeList(type);
      const typeIsArrayInSchema =
        (Medicine.schema.paths.type?.instance || "").toLowerCase() === "array";
      const typeValue =
        type === "Other"
          ? customType || "Other"
          : typeIsArrayInSchema
          ? typeList.length
            ? typeList
            : ["Tablet"]
          : typeList[0] || "Tablet";

      // collect images (filter to image/*)
      const fileBag = (req.files || []).filter((f) =>
        /^image\//i.test(f.mimetype || "")
      );
      const images = fileBag.map((f) =>
        isS3
          ? f.location || `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${f.key}`
          : "/uploads/medicines/" + (f.filename || f.key)
      );

      const mergedName =
        (name && name.trim()) || (brand && brand.trim()) || "";

      const med = new Medicine({
        name: mergedName,
        brand: brand || mergedName,
        composition: asTrimmedString(composition),
        company: asTrimmedString(company),
        price: priceNum,
        mrp: mrpNum,
        stock: stockNum,
        discount: discNum,
        category: categoryValue,
        type: typeValue,
        pharmacy: pharmacyId,
        img: images[0],
        images,
      });

      // best-effort AI description
      try {
        const desc = await generateDescription(mergedName);
        if (desc) med.description = desc;
      } catch {}

      await med.save();
      return res.status(201).json({ success: true, medicine: med });
    } catch (err) {
      console.error("Add new medicine error:", err);
      if (err.name === "ValidationError" || err.name === "CastError") {
        return res
          .status(400)
          .json({ error: "Invalid data", detail: err.message });
      }
      if (err.code === 11000) {
        return res
          .status(409)
          .json({ error: "Duplicate", detail: err.message });
      }
      return res
        .status(500)
        .json({ error: "Failed to add medicine", detail: err.message || String(err) });
    }
  };

  return isMultipart(req)
    ? uploadAny(req, res, (err) =>
        err
          ? res
              .status(400)
              .json({ message: "Upload error", error: err.message })
          : run()
      )
    : run();
});
/* ========================================================================== */

/* ===================== EDIT MEDICINE (JSON or multipart) =================== */
router.patch("/pharmacy/medicines/:id", auth, (req, res) => {
  const run = async () => {
    try {
      const med = await Medicine.findOne({
        _id: req.params.id,
        pharmacy: req.user.pharmacyId,
      });
      if (!med) return res.status(404).json({ error: "Medicine not found." });

      const b = req.body || {};
      const S = (v) => (v ?? "").toString().trim();

      // strings
      if (b.name !== undefined) med.name = S(b.name);
      if (b.brand !== undefined) med.brand = S(b.brand);
      if (b.composition !== undefined) med.composition = S(b.composition);
      if (b.company !== undefined) med.company = S(b.company);

      // keep name/brand in sync
      if (!med.name && med.brand) med.name = med.brand;
      if (!med.brand && med.name) med.brand = med.name;

      // numbers / arrays
      if (b.price !== undefined) med.price = Number(b.price);
      if (b.mrp !== undefined) med.mrp = Number(b.mrp);
      if (b.stock !== undefined) med.stock = Number(b.stock);
      if (b.discount !== undefined) med.discount = Number(b.discount);
      if (b.category !== undefined) med.category = normalizeCategory(b.category);
      if (b.type !== undefined)
        med.type = b.type === "Other" ? S(b.customType) || "Other" : S(b.type);

      // images (append)
      if (req.files?.length) {
        const more = req.files
          .filter((f) => /^image\//i.test(f.mimetype || ""))
          .map((f) =>
            isS3
              ? f.location ||
                `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${f.key}`
              : "/uploads/medicines/" + (f.filename || f.key)
          );
        med.images = [...(med.images || []), ...more];
        if (!med.img) med.img = med.images[0];
      }

      await med.save();
      res.json({ success: true, medicine: med });
    } catch (err) {
      console.error("Edit medicine error:", err);
      res.status(500).json({ error: "Failed to update medicine" });
    }
  };

  return isMultipart(req)
    ? uploadAny(req, res, (err) =>
        err
          ? res
              .status(400)
              .json({ message: "Upload error", error: err.message })
          : run()
      )
    : run();
});
/* ========================================================================== */

// Remove a single image from a medicine (kept as-is)
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
    const pharmacyIds = pharmacies.map((p) => p._id);

    const medicines = await Medicine.find({
      name: { $regex: q, $options: "i" },
      ...(pharmacyIds.length > 0 ? { pharmacy: { $in: pharmacyIds } } : {}),
    });

    const uniqueNames = [...new Set(medicines.map((m) => m.name))];
    res.json(uniqueNames.map((name) => ({ name })));
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
              coordinates: [parseFloat(lng), parseFloat(lat)],
            },
            distanceField: "distance",
            maxDistance: parseInt(maxDistance),
            spherical: true,
            query: { active: true, status: "approved" },
          },
        },
        { $limit: 25 },
      ]);
    } else {
      let pharmacyFilter = { active: true, status: "approved" };
      if (req.query.city)
        pharmacyFilter.city = { $regex: req.query.city, $options: "i" };
      if (req.query.area)
        pharmacyFilter.area = { $regex: req.query.area, $options: "i" };
      pharmacies = await Pharmacy.find(pharmacyFilter);
    }

    const pharmacyIds = pharmacies.map((p) => p._id);

    const meds = await Medicine.find({
      name: { $regex: `^${name}$`, $options: "i" },
      pharmacy: { $in: pharmacyIds },
      stock: { $gt: 0 },
    }).populate("pharmacy");

    const distMap = {};
    pharmacies.forEach((p) => (distMap[p._id.toString()] = p.distance));

    meds.sort(
      (a, b) =>
        (distMap[a.pharmacy._id.toString()] || 1e9) -
        (distMap[b.pharmacy._id.toString()] || 1e9)
    );

    const output = meds.map((med) => ({
      pharmacy: med.pharmacy,
      pharmacyName: med.pharmacy?.name || "Unknown",
      price: med.price,
      stock: med.stock,
      medId: med._id,
      name: med.name,
      brand: med.brand,
      distance: distMap[med.pharmacy._id.toString()] || null,
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

// GET /api/medicines/suggestions?pharmacyId=...&exclude=a,b,c&limit=10
router.get("/suggestions", async (req, res) => {
  try {
    const { pharmacyId, exclude = "", limit = 10 } = req.query;
    if (!pharmacyId)
      return res.status(400).json({ message: "pharmacyId is required" });

    const lim = Math.min(parseInt(limit || 10, 10), 50);

    const excludeIds = exclude
      .split(",")
      .map((s) => s.trim())
      .filter((s) => ObjectId.isValid(s))
      .map((s) => new ObjectId(s));

    const or = [];
    if (ObjectId.isValid(pharmacyId))
      or.push({ pharmacy: new ObjectId(pharmacyId) });
    or.push({ pharmacyId: pharmacyId }); // string field, if you have it

    const filter = {
      ...(or.length ? { $or: or } : {}),
      ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}),
    };

    const items = await Medicine.find(filter)
      .select("_id name price brand img mrp category pharmacy pharmacyId")
      .sort({ popularity: -1, createdAt: -1 })
      .limit(lim)
      .lean();

    const normalized = items.map((doc) => ({
      ...doc,
      pharmacyId: (doc.pharmacyId || doc.pharmacy || "").toString(),
    }));

    res.json(normalized);
  } catch (err) {
    console.error("GET /api/medicines/suggestions error:", err);
    res.status(500).json({ message: "Failed to fetch suggestions" });
  }
});

module.exports = router;
