// utils/sms.js
const axios = require("axios");

/**
 * Send OTP SMS via MSG91 **OTP API (v5)**.
 *
 * mobile: "7906886249" or "917906886249"
 * otp: "123456"
 *
 * REQUIRED ENV VARS (Render):
 *   MSG91_AUTHKEY           -> your MSG91 auth key
 *   MSG91_OTP_TEMPLATE_ID   -> OTP template ID from **OTP > Templates** section
 *                              (NOT the SMS template ID)
 *
 * Example OTP API docs:
 *   https://control.msg91.com/api/v5/otp
 */
async function sendSmsMSG91(mobile, otp) {
  const authkey = process.env.MSG91_AUTHKEY;
  const otpTemplateId = process.env.MSG91_OTP_TEMPLATE_ID; // from OTP section

  if (!authkey || !otpTemplateId) {
    console.error(
      "MSG91 OTP config missing. Need MSG91_AUTHKEY and MSG91_OTP_TEMPLATE_ID"
    );
    throw new Error("MSG91 OTP configuration missing");
  }

  // Normalise number → 91XXXXXXXXXX
  const cleanMobile = String(mobile).replace(/\D/g, "");
  const fullMobile = cleanMobile.startsWith("91")
    ? cleanMobile
    : "91" + cleanMobile;

  const url = "https://control.msg91.com/api/v5/otp";

  // We pass our own OTP so it matches what we stored in Mongo for verification
  const payload = {
    template_id: otpTemplateId,
    mobile: fullMobile,
    otp: otp, // 6-digit OTP you generated in routes/auth.js
  };

  const headers = {
    authkey,
    "content-type": "application/json",
  };

  try {
    const res = await axios.post(url, payload, { headers });

    console.log("MSG91 OTP response:", JSON.stringify(res.data));

    // MSG91 usually returns { type: 'success', message: '...' } or { type: 'error', ... }
    if (res.data && res.data.type === "error") {
      throw new Error("MSG91 OTP error: " + JSON.stringify(res.data));
    }

    return res.data;
  } catch (err) {
    console.error("MSG91 OTP API failed:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendSmsMSG91 };
