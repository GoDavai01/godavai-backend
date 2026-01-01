// routes/medicineMaster.js (FULLY REPLACEABLE)
const express = require("express");
const router = express.Router();

// ✅ Models can be ESM default export OR CommonJS export
const MedicineMasterImport = require("../models/MedicineMaster");
const PharmacyInventoryImport = require("../models/PharmacyInventory");
const MedicineImport = require("../models/Medicine");
const PharmacyImport = require("../models/Pharmacy");

const MedicineMaster = MedicineMasterImport?.default || MedicineMasterImport;
const PharmacyInventory = PharmacyInventoryImport?.default || PharmacyInventoryImport;
const Medicine = MedicineImport?.default || MedicineImport;
const Pharmacy = PharmacyImport?.default || PharmacyImport;

// ✅ Auth middleware (single default export)
const auth = require("../middleware/auth");

// ✅ Util already used elsewhere in backend
const generateMedicineDescription = require("../utils/generateDescription");
const buildCompositionKeyImport = require("../utils/buildCompositionKey");
const buildCompositionKey =
  buildCompositionKeyImport?.default || buildCompositionKeyImport;

/**
 * ✅ Wrapper: pharmacy auth
 * - Works if token has: { pharmacyId } OR { type: "pharmacy" }
 */
const isPharmacyAuth = (req, res, next) => {
  return auth(req, res, () => {
    const ok = !!req.user?.pharmacyId || req.user?.type === "pharmacy";
    if (!ok) return res.status(403).json({ error: "Pharmacy only" });
    next();
  });
};

/**
 * ✅ Wrapper: admin auth
 * - Works if token has: { adminId } OR { type: "admin" }
 */
const isAdmin = (req, res, next) => {
  return auth(req, res, () => {
    const ok = !!req.user?.adminId || req.user?.type === "admin";
    if (!ok) return res.status(403).json({ error: "Admin only" });
    next();
  });
};

// ------------------------
// ✅ shared helper: auto description
// ------------------------
async function ensureDescription(payload = {}) {
  // ✅ FIX: spread payload properly
  const p = { ...payload };

  const composition = (p.composition || "").toString().trim();
  const brand = (p.brand || "").toString().trim();
  const company = (p.company || "").toString().trim();
  const type = (p.type || "").toString().trim();

  // name fallback
  p.name = (p.name || brand || composition || "").toString().trim();

  // if generic => brand empty
  if (String(p.productKind || "").toLowerCase() === "generic") {
    p.brand = "";
  }

  // ✅ auto-generate description if missing
  if (!p.description && p.name) {
    try {
      const desc = await generateMedicineDescription({
        name: p.name,
        brand: p.brand || brand,
        composition,
        company,
        type,
      });

      if (
        desc &&
        typeof desc === "string" &&
        desc.trim() &&
        desc.trim() !== "No description available."
      ) {
        p.description = desc.trim();
      }
    } catch (e) {
      console.error("Master desc gen failed:", e?.message || e);
    }
  }

  return p;
}

// ------------------------
// ✅ helpers for sync to Medicine
// ------------------------
const round2 = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
};

const calcDiscountPercent = (mrp, sellingPrice) => {
  const m = Number(mrp);
  const sp = Number(sellingPrice);
  if (!Number.isFinite(m) || !Number.isFinite(sp) || m <= 0) return 0;
  const d = ((m - sp) / m) * 100;
  return round2(Math.max(0, d));
};

/**
 * ✅ Create/Update a Medicine document for the pharmacy so it shows on:
 * - Pharmacy medicines page (reads Medicine)
 * - User medicines list (reads Medicine and applies stock>0 filter)
 */
async function syncInventoryToMedicine({ pharmacyId, masterDoc, invDoc }) {
  const m = masterDoc;
  const inv = invDoc && invDoc.toObject ? invDoc.toObject() : invDoc;

  const effectivePrice =
    inv?.sellingPrice != null ? Number(inv.sellingPrice) : Number(m?.price || 0);
  const effectiveMrp =
    inv?.mrp != null ? Number(inv.mrp) : Number(m?.mrp || 0);

  const effectiveDiscount =
    inv?.discount != null
      ? Number(inv.discount)
      : calcDiscountPercent(effectiveMrp, effectivePrice);

  const effectiveStock = inv?.stockQty != null ? Number(inv.stockQty) : 0;

  const effectiveImages =
    (Array.isArray(inv?.images) && inv.images.length
      ? inv.images
      : Array.isArray(m?.images)
      ? m.images
      : []) || [];

  const effectiveImg = effectiveImages?.length ? effectiveImages[0] : "";

  const compositionKey = buildCompositionKey(String(m?.composition || "").trim());

  const filter = {
    pharmacy: pharmacyId,
    name: m?.name || "",
    composition: m?.composition || "",
    brand: m?.brand || "",
    productKind: m?.productKind || "branded",
    packCount: Number(m?.packCount || 0),
    packUnit: m?.packUnit || "",
    type: m?.type || "Tablet",
  };

  const payload = {
    pharmacy: pharmacyId,

    name: m?.name || "",
    brand: m?.brand || "",
    composition: m?.composition || "",
    compositionKey,

    company: m?.company || "",

    price: effectivePrice,
    mrp: effectiveMrp,
    discount: effectiveDiscount,
    stock: effectiveStock,

    images: effectiveImages,
    img: effectiveImg,

    packCount: Number(m?.packCount || 0),
    packUnit: m?.packUnit || "",

    productKind: m?.productKind || "branded",

    category:
      Array.isArray(m?.category) && m.category.length
        ? m.category
        : ["Miscellaneous"],

    type: m?.type || "Tablet",
    prescriptionRequired: !!m?.prescriptionRequired,

    status: "active",
    available: true,
  };

  const medDoc = await Medicine.findOneAndUpdate(
    filter,
    { $set: payload },
    { new: true, upsert: true }
  );

  await Pharmacy.updateOne(
    { _id: pharmacyId },
    { $addToSet: { medicines: medDoc._id } }
  );

  return medDoc;
}

/**
 * ✅ SEARCH approved master medicines (pharmacy + admin)
 * GET /api/medicine-master?q=
 */
router.get("/", isPharmacyAuth, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const filter = {
      status: "approved",
      active: true,
      ...(q ? { name: { $regex: q, $options: "i" } } : {}),
    };

    const meds = await MedicineMaster.find(filter).sort({ name: 1 }).limit(50);
    res.json(meds);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch medicine master." });
  }
});

/**
 * ✅ ADMIN: list all master meds (including pending)
 * GET /api/medicine-master/admin/all?q=&status=
 */
router.get("/admin/all", isAdmin, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const status = (req.query.status || "").trim(); // approved/pending/rejected

    const filter = {
      ...(status ? { status } : {}),
      ...(q ? { name: { $regex: q, $options: "i" } } : {}),
    };

    const meds = await MedicineMaster.find(filter)
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(meds);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch admin master list." });
  }
});

/**
 * ✅ ADMIN: create master medicine (full fields)
 * POST /api/medicine-master/admin
 */
router.post("/admin", isAdmin, async (req, res) => {
  try {
    let payload = {
      ...req.body,
      status: "approved",
      createdByType: "admin",
      createdByPharmacyId: null,
      active: true,
    };

    payload = await ensureDescription(payload);

    const med = await MedicineMaster.create(payload);
    res.json(med);
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to create master medicine." });
  }
});

/**
 * ✅ PHARMACY: add new medicine request (pending approval)
 * POST /api/medicine-master/request
 */
router.post("/request", isPharmacyAuth, async (req, res) => {
  try {
    let payload = {
      ...req.body,
      status: "pending",
      createdByType: "pharmacy",
      createdByPharmacyId: req.user?.pharmacyId || null,
      active: true,
    };

    payload = await ensureDescription(payload);

    const med = await MedicineMaster.create(payload);
    res.json({ success: true, med });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to submit request." });
  }
});

/**
 * ✅ ADMIN: approve pending request
 * PATCH /api/medicine-master/:id/approve
 *
 * ✅ FIX ADDED:
 * - If request came from a pharmacy, auto-add to that pharmacy inventory
 * - AND sync into Medicine collection so it appears in pharmacy list + user list
 */
router.patch("/:id/approve", isAdmin, async (req, res) => {
  try {
    const med = await MedicineMaster.findByIdAndUpdate(
      req.params.id,
      { status: "approved" },
      { new: true }
    );

    if (!med) return res.status(404).json({ error: "Master medicine not found." });

    const pharmacyId =
      med.createdByType === "pharmacy" ? med.createdByPharmacyId : null;

    if (pharmacyId) {
      try {
        const sp = Number(med.price ?? 0);
        const mrp = Number(med.mrp ?? 0);
        const discount = calcDiscountPercent(mrp, sp);

        const inv = await PharmacyInventory.findOneAndUpdate(
          { pharmacyId, medicineMasterId: med._id },
          {
            $set: {
              sellingPrice: sp,
              mrp,
              discount,
              stockQty: 1, // ✅ user list needs stock > 0
              images: [],
              isActive: true,
            },
          },
          { upsert: true, new: true }
        );

        await syncInventoryToMedicine({ pharmacyId, masterDoc: med, invDoc: inv });
      } catch (e) {
        console.error("Approve auto-add/sync failed:", e?.message || e);
      }
    }

    res.json({ success: true, med });
  } catch (e) {
    res.status(400).json({ error: "Failed to approve." });
  }
});

/**
 * ✅ ADMIN: reject pending request
 * PATCH /api/medicine-master/:id/reject
 */
router.patch("/:id/reject", isAdmin, async (req, res) => {
  try {
    const med = await MedicineMaster.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );

    res.json({ success: true, med });
  } catch (e) {
    res.status(400).json({ error: "Failed to reject." });
  }
});

module.exports = router;
