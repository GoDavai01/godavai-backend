// server/services/suggestService.js
const MasterBrand = require("../models/MasterBrand");
const MasterComposition = require("../models/MasterComposition");
const { toNameKey, escapeRegex } = require("../utils/text");

// shared limits
const DEFAULT_LIMIT = 10;

async function suggestBrands(query = "", limit = DEFAULT_LIMIT) {
  const key = toNameKey(query);
  if (!key || key.length < 2) return [];

  const starts = await MasterBrand.find({
    nameKey: { $regex: new RegExp("^" + escapeRegex(key)) },
  })
    .sort({ popularity: -1, name: 1 })
    .limit(limit)
    .lean();

  if (starts.length >= limit) return formatBrand(starts);

  const ids = new Set(starts.map((d) => String(d._id)));
  const contains = await MasterBrand.find({
    nameKey: { $regex: new RegExp(escapeRegex(key)) },
    _id: { $nin: Array.from(ids) },
  })
    .sort({ popularity: -1, name: 1 })
    .limit(limit - starts.length)
    .lean();

  return formatBrand([...starts, ...contains]);
}
function formatBrand(rows) {
  return rows.map((r) => ({
    id: r._id,
    name: r.name,
    type: r.type || null,
    strength: r.strength || null,
    packLabel: r.packLabel || null,
  }));
}

async function suggestCompositions(query = "", limit = DEFAULT_LIMIT) {
  const key = toNameKey(query);
  if (!key || key.length < 2) return [];

  const starts = await MasterComposition.find({
    nameKey: { $regex: new RegExp("^" + escapeRegex(key)) },
  })
    .sort({ popularity: -1, name: 1 })
    .limit(limit)
    .lean();

  if (starts.length >= limit) return formatComposition(starts);

  const ids = new Set(starts.map((d) => String(d._id)));
  const contains = await MasterComposition.find({
    nameKey: { $regex: new RegExp(escapeRegex(key)) },
    _id: { $nin: Array.from(ids) },
  })
    .sort({ popularity: -1, name: 1 })
    .limit(limit - starts.length)
    .lean();

  return formatComposition([...starts, ...contains]);
}
function formatComposition(rows) {
  return rows.map((r) => ({
    id: r._id,
    name: r.name,
    dosageForms: r.dosageForms || [],
    commonStrengths: r.commonStrengths || [],
  }));
}

async function prefillForBrand(brandId) {
  const row = await MasterBrand.findById(brandId).lean();
  if (!row) return {};

  // sensible defaults (editable on the form)
  return {
    productKind: "branded",
    name: row.name,
    type: row.type || undefined,
    packCount: packFromLabel(row.packLabel)?.count || "",
    packUnit: packFromLabel(row.packLabel)?.unit || "",
    hsn: "3004",
    gstRate: 5,
  };
}

async function prefillForComposition(compositionId) {
  const row = await MasterComposition.findById(compositionId).lean();
  if (!row) return {};

  const type = Array.isArray(row.dosageForms) && row.dosageForms.length ? row.dosageForms[0] : undefined;
  const unit = Array.isArray(row.packUnits) && row.packUnits.length ? row.packUnits[0] : "";

  return {
    productKind: "generic",
    name: row.name, // your UI may override based on business rules
    type,
    packCount: "",
    packUnit: unit || "",
    hsn: "3004",
    gstRate: 5,
  };
}

function packFromLabel(lbl) {
  if (!lbl) return null;
  const m = String(lbl).match(/(\d+)\s*(tablets|capsules|ml|g|units|sachets|drops)/i);
  if (!m) return null;
  return { count: String(m[1]), unit: m[2].toLowerCase() };
}

async function learn(payload = {}) {
  const {
    brand,
    brandId,
    composition,
    compositionId,
    type,
    packUnit,
    packCount,
  } = payload;

  const inc = { $inc: { popularity: 1 } };

  if (brandId || brand) {
    if (brandId) {
      await MasterBrand.findByIdAndUpdate(
        brandId,
        {
          ...inc,
          ...(type ? { type } : {}),
          ...(packUnit && packCount ? { packLabel: `${packCount} ${packUnit}` } : {}),
        },
        { new: false }
      );
    } else if (brand) {
      const nameKey = toNameKey(brand);
      await MasterBrand.findOneAndUpdate(
        { nameKey },
        {
          $setOnInsert: { name: brand, nameKey },
          ...inc,
          ...(type ? { type } : {}),
          ...(packUnit && packCount ? { packLabel: `${packCount} ${packUnit}` } : {}),
        },
        { upsert: true }
      );
    }
  }

  if (compositionId || composition) {
    if (compositionId) {
      const upd = { ...inc };
      if (type) upd.$addToSet = { ...(upd.$addToSet || {}), dosageForms: type };
      if (packUnit) upd.$addToSet = { ...(upd.$addToSet || {}), packUnits: packUnit };
      await MasterComposition.findByIdAndUpdate(compositionId, upd, { new: false });
    } else if (composition) {
      const nameKey = toNameKey(composition);
      const upd = {
        $setOnInsert: { name: composition, nameKey },
        ...inc,
      };
      if (type) upd.$addToSet = { ...(upd.$addToSet || {}), dosageForms: type };
      if (packUnit) upd.$addToSet = { ...(upd.$addToSet || {}), packUnits: packUnit };
      await MasterComposition.findOneAndUpdate({ nameKey }, upd, { upsert: true });
    }
  }

  return { ok: true };
}

module.exports = {
  suggestBrands,
  suggestCompositions,
  prefillForBrand,
  prefillForComposition,
  learn,
};
