const Tesseract = require("tesseract.js");
const { callLLMForPrescription } = require("./openaiUtils"); // implement as needed
const Jimp = require("jimp");
const fs = require("fs");

// AI Extraction utility
async function extractPrescription(imagePath) {
  const { data: { text } } = await Tesseract.recognize(imagePath, "eng");
  const extraction = await callLLMForPrescription(text); // returns structured JSON
  // Find PII using regex
  const phoneMatches = text.match(/\b\d{10,}\b/g) || [];
  // crude address detection: look for 'address:', 'Add:', or line with pin code (6 digits)
  const addressMatches = (text.match(/(address:?.*\n.*|Add:?.*\n.*|\b\d{6}\b.*)/gi) || []);
  return {
    ...extraction,
    pii: { phones: phoneMatches, addresses: addressMatches }
  };
}

// Redact PII from image by overlaying white box for each match (demo: just blur whole image for now)
async function redactPIIFromImage(imagePath, pii) {
  const image = await Jimp.read(imagePath);
  // (For real-world: use Tesseract to get bounding boxes for each PII match)
  // Prototype: blur the whole image if any PII found (better than nothing)
  if ((pii.phones && pii.phones.length) || (pii.addresses && pii.addresses.length)) {
    image.blur(7); // adjustable
  }
  // Save as -redacted
  const redactedPath = imagePath.replace(/(\.\w+)$/, "-redacted$1");
  await image.writeAsync(redactedPath);
  return redactedPath;
}

module.exports = { extractPrescription, redactPIIFromImage };
