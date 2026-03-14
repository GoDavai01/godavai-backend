const Medicine = require("../models/Medicine");
const MedicineMaster = require("../models/MedicineMaster");
const PatientCartDraft = require("../models/PatientCartDraft");
const buildCompositionKey = require("../utils/buildCompositionKey");

function calculateSavings(brand = {}, generic = {}) {
  const brandPrice = Number(brand?.price || 0);
  const genericPrice = Number(generic?.price || 0);
  return Math.max(0, brandPrice - genericPrice);
}

function markSensitiveMedicine(item = {}) {
  const salt = String(item?.salt || item?.composition || "").toLowerCase();
  const prescribed = String(item?.prescribed || item?.name || "").toLowerCase();
  const sensitiveTerms = ["warfarin", "insulin", "levothyroxine", "phenytoin", "digoxin", "antiepileptic"];
  return sensitiveTerms.some((term) => salt.includes(term) || prescribed.includes(term));
}

async function calculateGenericSuggestion({ name = "", salt = "" }) {
  const compositionKey = buildCompositionKey(salt || name);
  if (!compositionKey) {
    return {
      brand: null,
      generic: null,
      genericAvailable: false,
      savings: 0,
    };
  }

  const [brand, generic, masterBrand, masterGeneric] = await Promise.all([
    Medicine.findOne({
      available: true,
      status: { $ne: "unavailable" },
      compositionKey,
      productKind: "branded",
    }).sort({ stock: -1, price: 1 }).lean(),
    Medicine.findOne({
      available: true,
      status: { $ne: "unavailable" },
      compositionKey,
      productKind: "generic",
    }).sort({ stock: -1, price: 1 }).lean(),
    MedicineMaster.findOne({
      active: true,
      status: "approved",
      composition: new RegExp(compositionKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      productKind: "branded",
    }).sort({ price: 1 }).lean(),
    MedicineMaster.findOne({
      active: true,
      status: "approved",
      composition: new RegExp(compositionKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      productKind: "generic",
    }).sort({ price: 1 }).lean(),
  ]);

  const chosenBrand = brand || masterBrand;
  const chosenGeneric = generic || masterGeneric;
  return {
    brand: chosenBrand || null,
    generic: chosenGeneric || null,
    genericAvailable: !!chosenGeneric,
    savings: calculateSavings(chosenBrand, chosenGeneric),
  };
}

async function buildCartDraftFromPrescription({ prescription, booking }) {
  const items = [];
  for (const med of prescription.medicines || []) {
    const suggestion = await calculateGenericSuggestion({ name: med.prescribed, salt: med.salt });
    const sensitive = markSensitiveMedicine(med);
    items.push({
      prescribedMedicine: med.prescribed,
      salt: med.salt || "",
      dosage: med.dosage || "",
      frequency: med.frequency || "",
      duration: med.duration || "",
      howToTake: med.howToTake || "",
      matchedBrand: suggestion.brand
        ? {
            medicineId: suggestion.brand._id || null,
            medicineMasterId: suggestion.brand._id || null,
            name: suggestion.brand.name || suggestion.brand.brand || med.prescribed,
            price: Number(suggestion.brand.price || 0),
            mrp: Number(suggestion.brand.mrp || suggestion.brand.price || 0),
            qty: Number(suggestion.brand.packCount || 1),
            composition: suggestion.brand.composition || med.salt || "",
          }
        : {
            name: med.prescribed,
            price: 0,
            mrp: 0,
            qty: 0,
            composition: med.salt || "",
          },
      generic: suggestion.generic
        ? {
            medicineId: suggestion.generic._id || null,
            medicineMasterId: suggestion.generic._id || null,
            name: suggestion.generic.name || med.prescribed,
            price: Number(suggestion.generic.price || 0),
            mrp: Number(suggestion.generic.mrp || suggestion.generic.price || 0),
            qty: Number(suggestion.generic.packCount || 1),
            composition: suggestion.generic.composition || med.salt || "",
          }
        : {
            name: "No generic mapped yet",
            price: 0,
            mrp: 0,
            qty: 0,
            composition: med.salt || "",
          },
      genericAvailable: !!suggestion.genericAvailable,
      savings: Number(suggestion.savings || 0),
      switchedToGeneric: false,
      requiresReview: sensitive,
      sensitive,
    });
  }

  const totals = items.reduce(
    (acc, item) => {
      acc.brandTotal += Number(item.matchedBrand?.price || 0);
      acc.genericTotal += item.genericAvailable ? Number(item.generic?.price || 0) : Number(item.matchedBrand?.price || 0);
      acc.potentialSavings += Number(item.savings || 0);
      return acc;
    },
    { brandTotal: 0, genericTotal: 0, potentialSavings: 0 }
  );

  let cartDraft = null;
  if (prescription?.cartDraftId) {
    cartDraft = await PatientCartDraft.findById(prescription.cartDraftId);
  }
  if (!cartDraft) {
    cartDraft = await PatientCartDraft.findOne({
      prescriptionId: prescription._id,
      patientId: booking.userId,
      status: "draft",
    });
  }
  if (!cartDraft) {
    cartDraft = new PatientCartDraft({
      prescriptionId: prescription._id,
      bookingId: booking._id,
      doctorId: booking.doctorId,
      patientId: booking.userId,
      status: "draft",
    });
  }
  cartDraft.bookingId = booking._id;
  cartDraft.doctorId = booking.doctorId;
  cartDraft.patientId = booking.userId;
  cartDraft.items = items;
  cartDraft.totals = totals;
  cartDraft.status = "draft";
  await cartDraft.save();

  return cartDraft;
}

module.exports = {
  calculateGenericSuggestion,
  calculateSavings,
  markSensitiveMedicine,
  buildCartDraftFromPrescription,
};
