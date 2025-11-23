// utils/sms.js
const axios = require("axios");

/**
 * Send OTP SMS via MSG91 using SMS v2 + DLT mapping.
 *
 * mobile: "7906886249" or "917906886249"
 * otp: "123456"
 *
 * REQUIRED ENV VARS (Render):
 *   MSG91_AUTHKEY          -> your MSG91 auth key
 *   MSG91_SENDER           -> GDAVAI      (exactly same as DLT header)
 *   MSG91_TEMPLATE_ID      -> **SMS** template ID (from SMS > Templates)
 *                             e.g. 691e03af338dfd707e3793d9
 *   MSG91_DLT_TEMPLATE_ID  -> DLT template ID from Jio
 *                             e.g. 1207176348392746192
 */
async function sendSmsMSG91(mobile, otp) {
  const authkey = process.env.MSG91_AUTHKEY;
  const sender = process.env.MSG91_SENDER;               // GDAVAI
  const templateId = process.env.MSG91_TEMPLATE_ID;      // SMS template ID
  const dltTemplateId = process.env.MSG91_DLT_TEMPLATE_ID; // Jio DLT ID

  if (!authkey || !sender || !templateId || !dltTemplateId) {
    console.error(
      "MSG91 config missing. Need MSG91_AUTHKEY, MSG91_SENDER, MSG91_TEMPLATE_ID (SMS), MSG91_DLT_TEMPLATE_ID"
    );
    throw new Error("MSG91 configuration missing");
  }

  // MESSAGE TEXT MUST MATCH DLT TEMPLATE EXACTLY
  const message =
    `Your GoDavaii OTP is ${otp}. Please use this to verify your login on GoDavaii. - GoDavaii (Karniva Private Limited)`;

  const cleanMobile = String(mobile).replace(/\D/g, "");
  const fullMobile = cleanMobile.startsWith("91")
    ? cleanMobile
    : "91" + cleanMobile;

  const payload = {
    sender,
    route: "4",           // transactional
    country: "91",
    sms: [
      {
        message,
        to: [fullMobile],
        template_id: templateId,        // SMS template ID
        dlt_template_id: dltTemplateId, // Jio DLT template ID
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
