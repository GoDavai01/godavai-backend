// utils/sms.js
const axios = require("axios");

/**
 * Send OTP SMS via MSG91 using SMS v2 + DLT mapping.
 */
async function sendSmsMSG91(mobile, otp) {
  const authkey = process.env.MSG91_AUTHKEY;
  const sender = process.env.MSG91_SENDER; // GDAVAI
  const templateId = process.env.MSG91_TEMPLATE_ID; // SMS template ID from SMS section
  const dltTemplateId = process.env.MSG91_DLT_TEMPLATE_ID; // 1207... from Jio DLT

  if (!authkey || !sender || !templateId || !dltTemplateId) {
    console.error(
      "MSG91 config missing. Need MSG91_AUTHKEY, MSG91_SENDER, MSG91_TEMPLATE_ID, MSG91_DLT_TEMPLATE_ID"
    );
    throw new Error("MSG91 configuration missing");
  }

  // *** MUST MATCH DLT TEMPLATE BODY EXACTLY (only number changes) ***
  const message =
    `Your GoDavaii OTP is ${otp}.` +
    `\nPlease use this to verify your login on GoDavaii.` +
    `\n\n- GoDavaii (Karniva Private Limited)`;

  const cleanMobile = String(mobile).replace(/\D/g, "");
  const fullMobile = cleanMobile.startsWith("91")
    ? cleanMobile
    : "91" + cleanMobile;

  const payload = {
    sender,
    route: "4", // transactional
    country: "91",
    sms: [
      {
        to: [fullMobile],
        message,
        template_id: templateId,       // MSG91 SMS template ID
        dlt_template_id: dltTemplateId // Jio DLT template ID
      },
    ],
  };

  const headers = {
    authkey,
    "content-type": "application/json",
  };

  try {
    const res = await axios.post(
      "https://api.msg91.com/api/v2/sendsms",
      payload,
      { headers }
    );
    console.log("MSG91 SMS response:", JSON.stringify(res.data));
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
