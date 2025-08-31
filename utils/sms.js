// utils/sms.js
const axios = require('axios');

async function sendSmsMSG91(mobile, message) {
  const authkey = process.env.MSG91_AUTHKEY;
  const sender = process.env.MSG91_SENDER || "GODAVAII"; // Fallback to GODAVAII
  const route = 4; // 4 = transactional
  const country = 91;
  const template_id = process.env.MSG91_TEMPLATE_ID; // <-- Add this line!

  const url = `https://api.msg91.com/api/v2/sendsms`;

  const data = {
    sender,
    route,
    country,
    sms: [
      {
        message,
        to: [mobile.startsWith("91") ? mobile : "91" + mobile],
        template_id // <-- Add this field!
      }
    ]
  };

  const headers = {
    authkey,
    'content-type': 'application/json'
  };

  try {
    const res = await axios.post(url, data, { headers });
    console.log("MSG91 SMS sent:", res.data);
    return res.data;
  } catch (err) {
    console.error("MSG91 SMS failed:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendSmsMSG91 };
