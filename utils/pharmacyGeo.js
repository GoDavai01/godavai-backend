// utils/pharmacyGeo.js
const mongoose = require("mongoose");
const Pharmacy = require("../models/Pharmacy");

/**
 * Finds active, approved pharmacies near a point.
 * @param {Object} params
 * @param {number|string} params.lat
 * @param {number|string} params.lng
 * @param {number|string} [params.maxDistance=5000]  // in meters
 * @param {Array<string|ObjectId>} [params.excludeIds=[]]
 * @returns {Promise<Array>}
 */
async function findPharmaciesNearby({ lat, lng, maxDistance = 5000, excludeIds = [] } = {}) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  const maxDist = Number.isFinite(Number(maxDistance)) ? Number(maxDistance) : 5000;

  // Strict guard (prevents [NaN, NaN] from ever reaching $geoNear)
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return [];
  }

  // Normalize excludeIds -> ObjectIds when possible (mixed ok)
  const toObjId = (v) => {
    try { return new mongoose.Types.ObjectId(v); } catch { return null; }
  };
  const excludeObjIds = (excludeIds || []).map(toObjId).filter(Boolean);

  const match = { active: true, status: "approved" };
  if (excludeObjIds.length) match._id = { $nin: excludeObjIds };

  const pharmacies = await Pharmacy.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [lngNum, latNum] }, // [lng, lat]
        distanceField: "dist.calculated",
        maxDistance: maxDist,
        spherical: true,
        query: match
      }
    },
    { $sort: { "dist.calculated": 1, rating: -1, createdAt: 1 } } // keep your original sort
  ]);

  return pharmacies;
}

module.exports = { findPharmaciesNearby };
