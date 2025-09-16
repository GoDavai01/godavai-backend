"use strict";
const { matchZeroGst } = require("../utils/tax/zeroList");

["Imiglucerase 400U vial", "ARV (anti rabies vaccine)", "Onasemnogene abeparvovec"].forEach(t => {
  console.log(t, "->", matchZeroGst(t));
});
