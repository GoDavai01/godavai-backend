// routes/medicineMaster.js (FULLY REPLACEABLE)
const express = require("express");
const router = express.Router();

// ✅ Models can be ESM default export OR CommonJS export
const MedicineMasterImport = require("../models/MedicineMaster");
const PharmacyInventoryImport = require("../models/PharmacyInventory");

const MedicineMaster = MedicineMasterImport?.default || MedicineMasterImport;
const PharmacyInventory = PharmacyInventoryImport?.default || PharmacyInventoryImport;

// ✅ Auth middleware (single default export)
const auth = require("../middleware/auth");

// ✅ Util already used elsewhere in backend
const generateMedicineDescription = require("../utils/generateDescription");

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
 */
router.patch("/:id/approve", isAdmin, async (req, res) => {
  try {
    const med = await MedicineMaster.findByIdAndUpdate(
      req.params.id,
      { status: "approved" },
      { new: true }
    );

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
