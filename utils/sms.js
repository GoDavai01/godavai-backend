// utils/sms.js
const axios = require("axios");

const MSG91_BASE_URL = "https://api.msg91.com/api/v2/sendsms";

/**
 * Send OTP SMS via MSG91 using your DLT-approved template.
 * It builds the exact message text that matches the template and
 * passes template_id so DLT is happy.
 */
async function sendSmsMSG91(mobile, otp) {
  const authkey = process.env.MSG91_AUTHKEY;
  const sender = process.env.MSG91_SENDER;          // e.g. GDAVAI
  const templateId = process.env.MSG91_TEMPLATE_ID; // e.g. 691ddce543a7712e306f3423

  if (!authkey || !sender || !templateId) {
    console.error("MSG91 config missing. Check MSG91_AUTHKEY, MSG91_SENDER, MSG91_TEMPLATE_ID");
    throw new Error("MSG91 configuration missing");
  }

  // IMPORTANT: this MUST match your DLT template text exactly
  const message =
    `Your GoDavaii OTP is ${otp}. Please use this to verify your login on GoDavaii.\n\n` +
    `- GoDavaii (Karniva Private Limited)`;

  const payload = {
    sender,
    route: "4",              // transactional
    country: "91",
    sms: [
      {
        message,
        to: [mobile.startsWith("91") ? mobile : `91${mobile}`],
        template_id: templateId
      }
    ]
  };

  const headers = {
    authkey,
    "content-type": "application/json"
  };

  try {
    const res = await axios.post(MSG91_BASE_URL, payload, { headers });
    console.log("MSG91 SMS response:", JSON.stringify(res.data));
    // If MSG91 returns error structure, throw so /send-otp can show error
    if (res.data && res.data.type === "error") {
      throw new Error("MSG91 error: " + JSON.stringify(res.data));
    }
    return res.data;
  } catch (err) {
    console.error("MSG91 SMS failed:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendSmsMSG91 };
