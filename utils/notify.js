// utils/notify.js

const axios = require("axios");
const Notification = require("../models/Notification"); // IMPORTANT: Use correct case for file name

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || process.env.ONESIGNAL_APPID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || process.env.ONESIGNAL_KEY;

// Send OneSignal push notification
async function sendNotification({ headings, contents, include_external_user_ids, url = "" }) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    console.error("OneSignal App ID or API Key missing in environment variables");
    return;
  }
  try {
    await axios.post(
      "https://onesignal.com/api/v1/notifications",
      {
        app_id: ONESIGNAL_APP_ID,
        headings: headings || { en: "Notification" },
        contents: contents || { en: "" },
        include_external_user_ids,
        url,
      },
      {
        headers: {
          "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Failed to send OneSignal notification:", err);
  }
}

// Send notification to a single user (OneSignal)
function notifyUser(userId, title, message, url = "") {
  return sendNotification({
    headings: { en: title },
    contents: { en: message },
    include_external_user_ids: [userId],
    url,
  });
}

// Send notification to many users (OneSignal)
function notifyUsers(userIds, title, message, url = "") {
  return sendNotification({
    headings: { en: title },
    contents: { en: message },
    include_external_user_ids: userIds,
    url,
  });
}

// Save notification to MongoDB (for audit/history/in-app use)
async function saveInAppNotification({ userId, title, message }) {
  try {
    await Notification.create({ userId, title, message });
  } catch (e) {
    console.error("Error saving in-app notification:", e);
  }
}

module.exports = { sendNotification, notifyUser, notifyUsers, saveInAppNotification };
