// utils/pharmacyGeo.js (create this file if not exist)
const Pharmacy = require("../models/Pharmacy");

/**
 * Finds active, approved pharmacies within 5km of given lat/lng.
 * Excludes pharmacy IDs in `excludeIds` if provided.
 * Returns sorted by distance, rating, createdAt.
 */
async function findPharmaciesNearby({ lat, lng, maxDistance = 5000, excludeIds = [] }) {
  if (!lat || !lng) return [];
  const match = { active: true, status: "approved" };
  if (excludeIds && excludeIds.length) match._id = { $nin: excludeIds };
  const pharmacies = await Pharmacy.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
        distanceField: "dist.calculated",
        maxDistance,
        spherical: true,
        query: match
      }
    },
    { $sort: { "dist.calculated": 1, rating: -1, createdAt: 1 } }
  ]);
  return pharmacies;
}

module.exports = { findPharmaciesNearby };
