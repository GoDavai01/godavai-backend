const axios = require('axios');

async function geocodeAddress(address) {
  const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY; // or process.env.GOOGLE_MAPS_API_KEY
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  try {
    const resp = await axios.get(url);
    const { results } = resp.data;
    if (!results.length) return null;
    const loc = results[0].geometry.location;
    return {
      lat: loc.lat,
      lng: loc.lng,
      formatted: results[0].formatted_address
    };
  } catch (err) {
    console.error("Geocode error:", err);
    return null;
  }
}
