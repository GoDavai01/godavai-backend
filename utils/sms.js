// utils/sms.js
const axios = require("axios");

/**
 * Send OTP via MSG91 OTP API (NOT normal SMS API)
 *
 * - Uses OTP template that already works when you click "Test DLT" in MSG91.
 * - Requires these env vars in Render:
 *   MSG91_AUTHKEY          -> your MSG91 auth key
 *   MSG91_TEMPLATE_ID      -> OTP template ID from OTP section (e.g. 691ddce543a7712e306f3423)
 *
 * DLT mapping is handled inside MSG91 for that template,
 * so we do NOT manually send dlt_template_id here.
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

  // Clean mobile: keep only digits
  const cleanMobile = String(mobile).replace(/\D/g, "");
  const fullMobile = cleanMobile.startsWith("91")
    ? cleanMobile
    : "91" + cleanMobile;

  const payload = {
    template_id: templateId, // OTP template ID from OTP section
    mobile: fullMobile,
    otp: String(otp),
  };

  const headers = {
    authkey,
    "Content-Type": "application/json",
  };

  try {
    const res = await axios.post(
      "https://api.msg91.com/api/v5/otp",
      payload,
      { headers }
    );

    console.log("MSG91 OTP response:", JSON.stringify(res.data));

    if (res.data && res.data.type === "error") {
      throw new Error("MSG91 OTP error: " + JSON.stringify(res.data));
    }

    return res.data;
  } catch (err) {
    console.error("MSG91 OTP request failed:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendSmsMSG91 };
