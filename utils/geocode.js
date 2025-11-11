const axios = require('axios');

async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_GEOCODE_SERVER_KEY; // 👈 server-only key

  if (!apiKey) {
    console.error("Missing GOOGLE_GEOCODE_SERVER_KEY env var");
    return null;
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${apiKey}`;

  try {
    const resp = await axios.get(url);
    const { results, status, error_message } = resp.data;

    if (status !== "OK" || !results?.length) {
      console.error("Geocode API error:", status, error_message);
      return null;
    }

    const loc = results[0].geometry.location;
    return {
      lat: loc.lat,
      lng: loc.lng,
      formatted: results[0].formatted_address,
    };
  } catch (err) {
    console.error("Geocode error:", err.message);
    return null;
  }
}

