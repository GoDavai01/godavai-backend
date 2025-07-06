import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Example translation resources
const resources = {
  en: { translation: {
  "My Addresses": "My Addresses",
      "Saved Cards & GoDavai Money": "Saved Cards & GoDavai Money",
      "Order History": "Order History",
      "View All Orders": "View All Orders",
      "Badges & Loyalty": "Badges & Loyalty",
      "Personalization": "Personalization",
      "Theme": "Theme",
      "Language": "Language",
      "Add New": "Add New",
      "Settings": "Settings",
      "Pharmacist Portal": "Pharmacist Portal",
      "Go to Pharmacist Dashboard": "Go to Pharmacist Dashboard",
      "Register as Pharmacist": "Register as Pharmacist",
      "Add New Card": "Add New Card",
      "Welcome": "Welcome",
      "Home": "Home",
      // Add all your keys and default English text here
    }
  },
  hi: {
    translation: {
      "Welcome": "स्वागत है",
      "Home": "होम",
       "My Addresses": "मेरे पते",
      "Saved Cards & GoDavai Money": "सहेजे गए कार्ड्स और गोदवई मनी",
      "Order History": "आर्डर इतिहास",
      "View All Orders": "सभी ऑर्डर देखें",
      "Badges & Loyalty": "बैजेस और लॉयल्टी",
      "Personalization": "पर्सनलाइज़ेशन",
      "Theme": "थीम",
      "Language": "भाषा",
      "Add New": "नया जोड़ें",
      "Settings": "सेटिंग्स",
      "Pharmacist Portal": "फार्मासिस्ट पोर्टल",
      "Go to Pharmacist Dashboard": "फार्मासिस्ट डैशबोर्ड पर जाएं",
      "Register as Pharmacist": "फार्मासिस्ट के रूप में रजिस्टर करें",
      "Add New Card": "नया कार्ड जोड़ें",
      // Hindi
    }
  },
  // ...add other languages as needed
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    lng: localStorage.getItem("language") || "en", // <-- Add this!
    interpolation: { escapeValue: false }
  });

export default i18n;
