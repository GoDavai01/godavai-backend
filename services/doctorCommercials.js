function normalizeModeMap(modes = {}) {
  return {
    audio: !!modes.audio,
    video: !!modes.video,
    inperson: !!(modes.inperson || modes.inPerson),
  };
}

function normalizeFees(fees = {}) {
  return {
    audio: Number(fees.audio || fees.call || 0),
    video: Number(fees.video || 0),
    inperson: Number(fees.inperson || fees.inPerson || 0),
  };
}

function getPlatformFeeBandFromDoctorFees(fees = {}, modes = {}) {
  const normalizedModes = normalizeModeMap(modes);
  const normalizedFees = normalizeFees(fees);
  const activeFees = [];
  if (normalizedModes.audio) activeFees.push(normalizedFees.audio);
  if (normalizedModes.video) activeFees.push(normalizedFees.video);
  if (normalizedModes.inperson) activeFees.push(normalizedFees.inperson);
  const highestActiveFee = activeFees.length ? Math.max(...activeFees) : 0;

  if (highestActiveFee <= 500) {
    return {
      code: "0_500",
      bandKey: "0_500",
      label: "Rs 0-500",
      serviceFee: 19,
      serviceFeeExGst: 19,
      gstApplicable: true,
      gstLabel: "+ applicable GST",
      requiresManualApproval: false,
      highestActiveFee,
    };
  }
  if (highestActiveFee <= 1000) {
    return {
      code: "501_1000",
      bandKey: "501_1000",
      label: "Rs 501-1000",
      serviceFee: 39,
      serviceFeeExGst: 39,
      gstApplicable: true,
      gstLabel: "+ applicable GST",
      requiresManualApproval: false,
      highestActiveFee,
    };
  }
  if (highestActiveFee <= 1500) {
    return {
      code: "1001_1500",
      bandKey: "1001_1500",
      label: "Rs 1001-1500",
      serviceFee: 59,
      serviceFeeExGst: 59,
      gstApplicable: true,
      gstLabel: "+ applicable GST",
      requiresManualApproval: false,
      highestActiveFee,
    };
  }
  if (highestActiveFee <= 2000) {
    return {
      code: "1501_2000",
      bandKey: "1501_2000",
      label: "Rs 1501-2000",
      serviceFee: 79,
      serviceFeeExGst: 79,
      gstApplicable: true,
      gstLabel: "+ applicable GST",
      requiresManualApproval: false,
      highestActiveFee,
    };
  }
  return {
    code: "2001_plus",
    bandKey: "2001_plus",
    label: "Rs 2001+",
    serviceFee: 0,
    serviceFeeExGst: 0,
    gstApplicable: true,
    gstLabel: "Manual commercial approval required",
    requiresManualApproval: true,
    highestActiveFee,
  };
}

function getPatientFacingBundledPricing(baseFee = 0) {
  const fee = Number(baseFee || 0);
  const band = getPlatformFeeBandFromDoctorFees({ video: fee }, { video: true });
  return band.requiresManualApproval ? fee : fee + Number(band.serviceFee || 0);
}

function getDoctorCommercialSnapshot(doctor = {}) {
  const fees = {
    audio: Number(doctor?.feeCall || doctor?.fees?.audio || 0),
    video: Number(doctor?.feeVideo || doctor?.fees?.video || 0),
    inperson: Number(doctor?.feeInPerson || doctor?.fees?.inperson || 0),
  };
  const modes = {
    audio: !!doctor?.consultModes?.audio,
    video: !!doctor?.consultModes?.video,
    inperson: !!(doctor?.consultModes?.inperson || doctor?.consultModes?.inPerson),
  };
  const band = getPlatformFeeBandFromDoctorFees(fees, modes);
  return {
    fees,
    modes,
    band,
    visibleToDoctor: true,
    visibleToPatient: false,
  };
}

module.exports = {
  getPlatformFeeBandFromDoctorFees,
  getPatientFacingBundledPricing,
  getDoctorCommercialSnapshot,
};
