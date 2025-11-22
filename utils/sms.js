// utils/sms.js
const axios = require("axios");

/**
 * Send OTP via MSG91 OTP API (NOT normal SMS API)
 *
 * - Uses OTP template that you mapped in MSG91 (the same one whose "Test DLT"
 *   works in the dashboard).
 * - Requires env vars:
 *   MSG91_AUTHKEY     -> your MSG91 auth key
 *   MSG91_TEMPLATE_ID -> OTP template ID from MSG91 (OTP section)
 */
async function sendSmsMSG91(mobile, otp) {
  const authkey = process.env.MSG91_AUTHKEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authkey || !templateId) {
    console.error(
      "MSG91 config missing. Check MSG91_AUTHKEY and MSG91_TEMPLATE_ID environment variables."
    );
    throw new Error("MSG91 configuration missing");
  }

  // clean mobile -> only digits
  const cleanMobile = String(mobile).replace(/\D/g, "");
  const fullMobile = cleanMobile.startsWith("91")
    ? cleanMobile
    : "91" + cleanMobile;

  const payload = {
    template_id: templateId,
    mobile: fullMobile,
    otp: String(otp),
  };

  const headers = {
    authkey,
    "Content-Type": "application/json",
  };

  try {
    const res = await axios.post("https://api.msg91.com/api/v5/otp", payload, {
      headers,
    });

    console.log("MSG91 OTP response:", JSON.stringify(res.data));

    if (res.data && res.data.type === "error") {
      throw new Error("MSG91 OTP error: " + JSON.stringify(res.data));
    }

    return res.data;
  } catch (err) {
    console.error(
      "MSG91 OTP request failed:",
      err.response?.data || err.message
    );
    throw err;
  }
}

module.exports = { sendSmsMSG91 };
