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
// ✅ REQUIRED FIELDS VALIDATION (MANDATORY)
// ------------------------
const ALLOWED_GST = new Set([0, 5, 12, 18]);

// ✅ NEW: comma-safe numeric parser
const toNum = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const cleaned = s.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

function validateRequiredFields(payload = {}) {
  const errors = [];

  const name = (payload.name || "").toString().trim();
  const composition = (payload.composition || "").toString().trim();
  const type = (payload.type || "").toString().trim();

  const category = Array.isArray(payload.category) ? payload.category : [];
  const price = toNum(payload.price);
  const mrp = toNum(payload.mrp);
  const gstRate = toNum(payload.gstRate);

  if (!name) errors.push("Medicine Name is required.");
  if (!composition) errors.push("Composition is required.");
  if (!type) errors.push("Type is required.");

  if (!Array.isArray(category) || category.length === 0)
    errors.push("Category is required.");

  if (!Number.isFinite(price) || price <= 0)
    errors.push("Selling Price must be greater than 0.");

  if (!Number.isFinite(mrp) || mrp <= 0)
    errors.push("MRP must be greater than 0.");

  if (!Number.isFinite(gstRate) || !ALLOWED_GST.has(gstRate))
    errors.push("GST Rate must be one of 0, 5, 12, 18.");

  return errors;
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
  const m = toNum(mrp);
  const sp = toNum(sellingPrice);
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
    inv?.sellingPrice != null ? toNum(inv.sellingPrice) : toNum(m?.price || 0);
  const effectiveMrp =
    inv?.mrp != null ? toNum(inv.mrp) : toNum(m?.mrp || 0);

  const effectiveDiscount =
    inv?.discount != null
      ? toNum(inv.discount)
      : calcDiscountPercent(effectiveMrp, effectivePrice);

  const effectiveStock = inv?.stockQty != null ? toNum(inv.stockQty) : 0;

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
    packCount: toNum(m?.packCount || 0),
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

    packCount: toNum(m?.packCount || 0),
    packUnit: m?.packUnit || "",

    productKind: m?.productKind || "branded",

    category:
      Array.isArray(m?.category) && m.category.length ? m.category : ["Miscellaneous"],

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

// ------------------------
// ✅ helper: build filter used to match Medicine docs created from master
// (for UPDATE/DELETE propagate)
// ------------------------
function buildMedicineMatchFilterFromMaster(masterDoc) {
  return {
    name: masterDoc?.name || "",
    composition: masterDoc?.composition || "",
    brand: masterDoc?.brand || "",
    productKind: masterDoc?.productKind || "branded",
    type: masterDoc?.type || "Tablet",
    packCount: toNum(masterDoc?.packCount || 0),
    packUnit: masterDoc?.packUnit || "",
  };
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

    // ✅ normalize numbers (comma-safe) before validate/save
    payload.price = toNum(payload.price);
    payload.mrp = toNum(payload.mrp);
    payload.discount = toNum(payload.discount);
    payload.gstRate = toNum(payload.gstRate);
    payload.packCount = toNum(payload.packCount);

    payload = await ensureDescription(payload);

    const errors = validateRequiredFields(payload);
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });

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

    // ✅ normalize numbers (comma-safe)
    payload.price = toNum(payload.price);
    payload.mrp = toNum(payload.mrp);
    payload.discount = toNum(payload.discount);
    payload.gstRate = toNum(payload.gstRate);
    payload.packCount = toNum(payload.packCount);

    payload = await ensureDescription(payload);

    const errors = validateRequiredFields(payload);
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });

    const med = await MedicineMaster.create(payload);
    res.json({ success: true, med });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to submit request." });
  }
});

/**
 * ✅ ADMIN: update an approved master medicine
 * PATCH /api/medicine-master/admin/:id
 *
 * - Updates master doc
 * - Propagates display fields to Medicine docs (does NOT touch stock/pricing)
 */
router.patch("/admin/:id", isAdmin, async (req, res) => {
  try {
    const existing = await MedicineMaster.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Master medicine not found." });

    const oldMatch = buildMedicineMatchFilterFromMaster(existing);

    let payload = { ...req.body };

    // ✅ normalize numbers (comma-safe)
    payload.price = toNum(payload.price);
    payload.mrp = toNum(payload.mrp);
    payload.discount = toNum(payload.discount);
    payload.gstRate = toNum(payload.gstRate);
    payload.packCount = toNum(payload.packCount);

    // keep status/createdBy intact; only editable fields will overwrite
    payload = await ensureDescription({
      ...existing.toObject(),
      ...payload,
      _id: existing._id,
      status: existing.status,
      createdByType: existing.createdByType,
      createdByPharmacyId: existing.createdByPharmacyId,
      active: existing.active,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    });

    const errors = validateRequiredFields(payload);
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });

    // write master
    const updated = await MedicineMaster.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true }
    );

    // propagate to Medicine docs (display fields)
    try {
      const img = Array.isArray(updated?.images) && updated.images.length ? updated.images[0] : "";

      await Medicine.updateMany(
        oldMatch,
        {
          $set: {
            name: updated?.name || "",
            brand: updated?.brand || "",
            composition: updated?.composition || "",
            compositionKey: buildCompositionKey(String(updated?.composition || "").trim()),
            company: updated?.company || "",
            images: Array.isArray(updated?.images) ? updated.images : [],
            img,
            category: Array.isArray(updated?.category) && updated.category.length ? updated.category : ["Miscellaneous"],
            type: updated?.type || "Tablet",
            prescriptionRequired: !!updated?.prescriptionRequired,
            productKind: updated?.productKind || "branded",
            packCount: toNum(updated?.packCount || 0),
            packUnit: updated?.packUnit || "",
          },
        }
      );
    } catch (e) {
      console.error("Propagate master update to Medicine failed:", e?.message || e);
    }

    res.json({ success: true, med: updated });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to update master medicine." });
  }
});

/**
 * ✅ ADMIN: delete a master medicine everywhere
 * DELETE /api/medicine-master/admin/:id
 */
router.delete("/admin/:id", isAdmin, async (req, res) => {
  try {
    const master = await MedicineMaster.findById(req.params.id);
    if (!master) return res.status(404).json({ error: "Master medicine not found." });

    const match = buildMedicineMatchFilterFromMaster(master);

    // get Medicine ids to pull from Pharmacy
    let medIds = [];
    try {
      const meds = await Medicine.find(match).select("_id").lean();
      medIds = (meds || []).map((x) => x._id);
    } catch (_) {}

    // delete master
    await MedicineMaster.deleteOne({ _id: master._id });

    // delete pharmacy inventories linked to this master
    await PharmacyInventory.deleteMany({ medicineMasterId: master._id });

    // delete medicines created from this master
    await Medicine.deleteMany(match);

    // pull from pharmacies
    if (medIds.length) {
      await Pharmacy.updateMany(
        { medicines: { $in: medIds } },
        { $pull: { medicines: { $in: medIds } } }
      );
    }

    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to delete master medicine." });
  }
});

/**
 * ✅ ADMIN: approve pending request
 * PATCH /api/medicine-master/:id/approve
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
        const sp = toNum(med.price ?? 0);
        const mrp = toNum(med.mrp ?? 0);
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
