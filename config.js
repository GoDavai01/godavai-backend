const path = require("path");
module.exports = {
  UPLOADS_DIR: process.env.UPLOADS_DIR || path.join(__dirname, "uploads"),
};
