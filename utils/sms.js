// utils/sms.js
const axios = require("axios");

/**
 * Send OTP SMS via MSG91 using mapped DLT template.
 * mobile: "7906886249" or "917906886249"
 * otp: "123456"
 */
async function sendSmsMSG91(mobile, otp) {
  const authkey = process.env.MSG91_AUTHKEY;
  const sender = process.env.MSG91_SENDER;              // e.g. GDAVAI
  const templateId = process.env.MSG91_TEMPLATE_ID;     // e.g. 691ddce543a7712e306f3423 (MSG91 template)
  const dltTemplateId = process.env.MSG91_DLT_TEMPLATE_ID; // e.g. 1207176348392746192 (Jio DLT Template ID)

  if (!authkey || !sender || !templateId || !dltTemplateId) {
    console.error("MSG91 config missing. Check MSG91_AUTHKEY, MSG91_SENDER, MSG91_TEMPLATE_ID, MSG91_DLT_TEMPLATE_ID");
    throw new Error("MSG91 configuration missing");
  }

  // ⚠️ MUST MATCH JIO DLT TEMPLATE EXACTLY (only {#var#} replaced by otp)
  // Template on Jio: "Your GoDavaii OTP is {#var#}. Please use this to verify your login on GoDavaii. - GoDavaii (Karniva Private Limited)"
  const message =
    `Your GoDavaii OTP is ${otp}. Please use this to verify your login on GoDavaii. - GoDavaii (Karniva Private Limited)`;

  const payload = {
    sender,
    route: "4",          // transactional
    country: "91",
    sms: [
      {
        message,
        to: [mobile.startsWith("91") ? mobile : `91${mobile}`],
        template_id: templateId,        // MSG91 template id
        dlt_template_id: dltTemplateId, // Jio DLT template id
      },
    ],
  };

  const headers = {
    authkey,
    "content-type": "application/json",
  };

  try {
    const res = await axios.post("https://api.msg91.com/api/v2/sendsms", payload, { headers });
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
