// PharmacyRegistrationStepper.js

import React, { useState } from "react";
import {
  Box, Button, TextField, Typography, Stepper, Step, StepLabel,
  Stack, Snackbar, Alert, FormControlLabel, Checkbox, InputLabel, MenuItem, Select, FormHelperText
} from "@mui/material";
import axios from "axios";

// ===== Constants & Helpers =====
const API_BASE =
  process.env.REACT_APP_API_BASE_URL ||
  (typeof window !== "undefined" && window.REACT_APP_API_BASE_URL) ||
  "";

const initialForm = {
  name: "", ownerName: "", city: "", area: "", address: "",
  contact: "", email: "", password: "", pin: "", 
  open24: false, timingFromHour: "", timingFromMinute: "", timingFromAmPm: "",
  timingToHour: "", timingToMinute: "", timingToAmPm: "",
  qualification: "", stateCouncilReg: "", drugLicenseRetail: "", gstin: "",
  bankAccount: "", ifsc: "", bankName: "", accountHolder: "",
  declarationAccepted: false,
  businessContact: "", businessContactName: "", emergencyContact: "",
};

const hours = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const minutes = ["00", "15", "30", "45"];
const selectMenuProps = {
  MenuProps: {
    anchorOrigin: { vertical: "top", horizontal: "left" },
    transformOrigin: { vertical: "bottom", horizontal: "left" },
    getContentAnchorEl: null
  }
};
const fileTypes = ".jpg,.jpeg,.png,.pdf";
const steps = [
  "Pharmacy & Owner Details",
  "Licenses & Credentials",
  "Identity & Address Verification",
  "Bank & Operations",
  "Declaration & Submit"
];
const requiredDocs = {
  qualificationCert: "Qualification Certificate (D.Pharm/B.Pharm/Pharm.D)",
  councilCert: "State Pharmacy Council Registration Certificate",
  retailLicense: "Retail Drug License (Form 20/21)",
  gstCert: "GST Certificate",
  identityProof: "Identity Proof (Aadhaar/PAN/Passport)",
  addressProof: "Address Proof (Utility bill/VoterID/Rent agreement)",
  photo: "Passport-size Photo",
};
const optionalDocs = {
  wholesaleLicense: "Wholesale Drug License (if applicable)",
  shopEstablishmentCert: "Shop Establishment Certificate (if regionally required)",
  tradeLicense: "Trade License (rare/optional)",
  digitalSignature: "Digital Signature (optional)",
};

function computeTimings(form) {
  if (form.open24) {
    return JSON.stringify({ is24Hours: true });
  }
  const open = `${form.timingFromHour}:${form.timingFromMinute} ${form.timingFromAmPm}`;
  const close = `${form.timingToHour}:${form.timingToMinute} ${form.timingToAmPm}`;
  return JSON.stringify({ is24Hours: false, open, close });
}

// ===== StepContent Component (EXTRACTED) =====
const StepContent = React.memo(function StepContent({
  step, form, errors, handleChange, handleFile, handleTimingChange,
  fileErrors, requiredDocs, optionalDocs, selectMenuProps, hours, minutes, safe
}) {
  switch (step) {
    case 0:
      return (
        <Stack spacing={2}>
          <TextField label="Pharmacy Name" name="name" value={safe(form.name)}
            onChange={handleChange} required error={!!errors.name} helperText={errors.name ? "Required" : ""} />
          <TextField label="Pharmacist's Name (Owner)" name="ownerName" value={safe(form.ownerName)}
            onChange={handleChange} required error={!!errors.ownerName} helperText={errors.ownerName ? "Required" : ""} />
          <TextField label="City" name="city" value={safe(form.city)}
            onChange={handleChange} required error={!!errors.city} helperText={errors.city ? "Required" : ""} />
          <TextField label="Area" name="area" value={safe(form.area)}
            onChange={handleChange} required error={!!errors.area} helperText={errors.area ? "Required" : ""} />
          <TextField label="Full Address" name="address" value={safe(form.address)}
            onChange={handleChange} required error={!!errors.address} helperText={errors.address ? "Required" : ""} multiline minRows={2} />
          <TextField label="Contact Number" name="contact" value={safe(form.contact)}
            onChange={handleChange} required error={!!errors.contact} helperText={errors.contact ? "10-digit number" : ""} />
          <TextField label="Login Email" name="email" value={safe(form.email)}
            onChange={handleChange} required error={!!errors.email} helperText={errors.email ? "Valid email required" : ""} />
          <TextField label="Password" name="password" type="password" value={safe(form.password)}
            onChange={handleChange} required error={!!errors.password} helperText={errors.password ? "Min 6 characters" : ""} />
            <TextField
  label="Set 4-digit Login PIN"
  name="pin"
  value={safe(form.pin)}
  onChange={handleChange}
  required
  type="password"
  inputProps={{ maxLength: 4, inputMode: "numeric", pattern: "\\d{4}" }}
  error={!!errors.pin}
  helperText={errors.pin ? "PIN must be 4 digits, unique, not same as mobile" : ""}
/>

          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.open24}
                  name="open24"
                  onChange={e => handleTimingChange("open24", e.target.checked)}
                />
              }
              label="Open 24 Hours"
            />
            {!form.open24 && (
              <Stack direction="row" spacing={2} alignItems="center" justifyContent="center">
                <Stack spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>From</Typography>
                  <Select
                    value={safe(form.timingFromHour)}
                    onChange={e => handleTimingChange("timingFromHour", e.target.value)}
                    displayEmpty
                    size="small"
                    error={!!errors.pharmacyTimings}
                    sx={{ minWidth: 72 }}
                    {...selectMenuProps}
                  >
                    <MenuItem value="">HH</MenuItem>
                    {hours.map(h => <MenuItem key={h} value={h}>{h}</MenuItem>)}
                  </Select>
                  <Select
                    value={safe(form.timingFromMinute)}
                    onChange={e => handleTimingChange("timingFromMinute", e.target.value)}
                    displayEmpty
                    size="small"
                    error={!!errors.pharmacyTimings}
                    sx={{ minWidth: 72 }}
                    {...selectMenuProps}
                  >
                    <MenuItem value="">MM</MenuItem>
                    {minutes.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                  </Select>
                  <Select
                    value={safe(form.timingFromAmPm)}
                    onChange={e => handleTimingChange("timingFromAmPm", e.target.value)}
                    displayEmpty
                    size="small"
                    error={!!errors.pharmacyTimings}
                    sx={{ minWidth: 72 }}
                    {...selectMenuProps}
                  >
                    <MenuItem value="">AM/PM</MenuItem>
                    <MenuItem value="AM">AM</MenuItem>
                    <MenuItem value="PM">PM</MenuItem>
                  </Select>
                </Stack>
                <Stack alignItems="center" sx={{ pt: 2 }}>
                  <Typography variant="subtitle2">to</Typography>
                </Stack>
                <Stack spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>To</Typography>
                  <Select
                    value={safe(form.timingToHour)}
                    onChange={e => handleTimingChange("timingToHour", e.target.value)}
                    displayEmpty
                    size="small"
                    error={!!errors.pharmacyTimings}
                    sx={{ minWidth: 72 }}
                    {...selectMenuProps}
                  >
                    <MenuItem value="">HH</MenuItem>
                    {hours.map(h => <MenuItem key={h} value={h}>{h}</MenuItem>)}
                  </Select>
                  <Select
                    value={safe(form.timingToMinute)}
                    onChange={e => handleTimingChange("timingToMinute", e.target.value)}
                    displayEmpty
                    size="small"
                    error={!!errors.pharmacyTimings}
                    sx={{ minWidth: 72 }}
                    {...selectMenuProps}
                  >
                    <MenuItem value="">MM</MenuItem>
                    {minutes.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                  </Select>
                  <Select
                    value={safe(form.timingToAmPm)}
                    onChange={e => handleTimingChange("timingToAmPm", e.target.value)}
                    displayEmpty
                    size="small"
                    error={!!errors.pharmacyTimings}
                    sx={{ minWidth: 72 }}
                    {...selectMenuProps}
                  >
                    <MenuItem value="">AM/PM</MenuItem>
                    <MenuItem value="AM">AM</MenuItem>
                    <MenuItem value="PM">PM</MenuItem>
                  </Select>
                </Stack>
              </Stack>
            )}
            {errors.pharmacyTimings && (
              <FormHelperText error>
                Please fill complete timings or select "24 Hours"
              </FormHelperText>
            )}
          </Box>
        </Stack>
      );
    case 1:
      return (
        <Stack spacing={2}>
          <TextField label="Pharmacy Qualification (D.Pharm/B.Pharm/Pharm.D)" name="qualification" value={safe(form.qualification)}
            onChange={handleChange} required error={!!errors.qualification} helperText={errors.qualification ? "Required" : ""} />
          <TextField label="State Pharmacy Council Reg. No." name="stateCouncilReg" value={safe(form.stateCouncilReg)}
            onChange={handleChange} required error={!!errors.stateCouncilReg} helperText={errors.stateCouncilReg ? "Required" : ""} />
          <TextField label="Retail Drug License No." name="drugLicenseRetail" value={safe(form.drugLicenseRetail)}
            onChange={handleChange} required error={!!errors.drugLicenseRetail} helperText={errors.drugLicenseRetail ? "Required" : ""} />
          <TextField label="GST Registration Number (GSTIN)" name="gstin" value={safe(form.gstin)}
            onChange={handleChange} required error={!!errors.gstin} helperText={errors.gstin ? "Required" : ""} />
          {Object.keys(requiredDocs).map(k => (
            <Box key={k}>
              <InputLabel required>{requiredDocs[k]}</InputLabel>
              <input type="file" accept={fileTypes} onChange={e => handleFile(e, k)} />
              <Typography color="error" variant="caption">
                {fileErrors[k] || (errors[k] && "Required")}
              </Typography>
            </Box>
          ))}
          {Object.keys(optionalDocs).map(k => (
            <Box key={k}>
              <InputLabel>{optionalDocs[k]}</InputLabel>
              <input type="file" accept={fileTypes} onChange={e => handleFile(e, k)} />
              <Typography color="error" variant="caption">
                {fileErrors[k]}
              </Typography>
            </Box>
          ))}
        </Stack>
      );
    case 2:
      return (
        <Stack spacing={2}>
          <InputLabel required>Identity Proof (Aadhaar/PAN/Passport)</InputLabel>
          <input type="file" accept={fileTypes} onChange={e => handleFile(e, "identityProof")} />
          <Typography color="error" variant="caption">{fileErrors.identityProof || (errors.identityProof && "Required")}</Typography>
          <InputLabel required>Address Proof (Utility bill/VoterID/Rent agreement)</InputLabel>
          <input type="file" accept={fileTypes} onChange={e => handleFile(e, "addressProof")} />
          <Typography color="error" variant="caption">{fileErrors.addressProof || (errors.addressProof && "Required")}</Typography>
          <InputLabel required>Passport-size Photo</InputLabel>
          <input type="file" accept={fileTypes} onChange={e => handleFile(e, "photo")} />
          <Typography color="error" variant="caption">{fileErrors.photo || (errors.photo && "Required")}</Typography>
        </Stack>
      );
    case 3:
      return (
        <Stack spacing={2}>
          <TextField label="Bank Account Number" name="bankAccount" value={safe(form.bankAccount)}
            onChange={handleChange} required error={!!errors.bankAccount} helperText={errors.bankAccount ? "Required" : ""} />
          <TextField label="Account Holder Name" name="accountHolder" value={safe(form.accountHolder)}
            onChange={handleChange} required error={!!errors.accountHolder} helperText={errors.accountHolder ? "Required" : ""} />
          <TextField label="Bank Name" name="bankName" value={safe(form.bankName)}
            onChange={handleChange} required error={!!errors.bankName} helperText={errors.bankName ? "Required" : ""} />
          <TextField label="IFSC Code" name="ifsc" value={safe(form.ifsc)}
            onChange={handleChange} required error={!!errors.ifsc} helperText={errors.ifsc ? "Required" : ""} />
          <TextField label="Business Contact Person (if different)" name="businessContactName" value={safe(form.businessContactName)} onChange={handleChange} />
          <TextField label="Business Contact Number (if different)" name="businessContact" value={safe(form.businessContact)} onChange={handleChange} />
          <TextField label="Emergency/Alternate Number" name="emergencyContact" value={safe(form.emergencyContact)} onChange={handleChange} />
          <InputLabel>Digital Signature (optional)</InputLabel>
          <input type="file" accept={fileTypes} onChange={e => handleFile(e, "digitalSignature")} />
          <Typography color="error" variant="caption">{fileErrors.digitalSignature}</Typography>
        </Stack>
      );
    case 4:
      return (
        <Stack spacing={2}>
          <Typography>
            I confirm all the above documents and details are valid and agree to the platform’s terms and local laws.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox checked={!!form.declarationAccepted} name="declarationAccepted" onChange={handleChange} required />
            }
            label="I accept the Terms of Service, Privacy Policy, and declare all information provided is true."
          />
          {errors.declarationAccepted && (
            <Typography color="error" variant="caption">You must accept the declaration to proceed.</Typography>
          )}
        </Stack>
      );
    default:
      return null;
  }
});

// ===== Main Component =====
export default function PharmacyRegistrationStepper() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ ...initialForm });
  const [files, setFiles] = useState({});
  const [fileErrors, setFileErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState({});

  const safe = v => typeof v === "string" ? v : "";

  // Input handlers
  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({
      ...f,
      [name]: type === "checkbox" ? checked : value || ""
    }));
    setErrors(er => ({ ...er, [name]: undefined }));
  };

  // Timings logic
  const handleTimingChange = (name, value) => {
    setForm(f => ({
      ...f,
      [name]: value || "",
      ...(name === "open24" && value
        ? {
            timingFromHour: "",
            timingFromMinute: "",
            timingFromAmPm: "",
            timingToHour: "",
            timingToMinute: "",
            timingToAmPm: "",
          }
        : {})
    }));
    setErrors(er => ({ ...er, pharmacyTimings: undefined }));
  };

  // File upload logic
  const handleFile = (e, key) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      setFileErrors(f => ({ ...f, [key]: "Invalid file type" }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFileErrors(f => ({ ...f, [key]: "Max 2MB allowed" }));
      return;
    }
    setFileErrors(f => ({ ...f, [key]: undefined }));
    setFiles(f => ({ ...f, [key]: file }));
  };

  // Validation
  function validateStep() {
    let tempErr = {};
    if (step === 0) {
      if (!form.name) tempErr.name = true;
      if (!form.ownerName) tempErr.ownerName = true;
      if (!form.city) tempErr.city = true;
      if (!form.area) tempErr.area = true;
      if (!form.address) tempErr.address = true;
      if (!form.contact || !/^\d{10}$/.test(form.contact)) tempErr.contact = true;
      if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) tempErr.email = true;
      if (!form.password || form.password.length < 6) tempErr.password = true;
      if (!form.pin || !/^\d{4}$/.test(form.pin) || form.pin === form.contact) tempErr.pin = true;
      if (
        !form.open24 && (
          !form.timingFromHour ||
          !form.timingFromMinute ||
          !form.timingFromAmPm ||
          !form.timingToHour ||
          !form.timingToMinute ||
          !form.timingToAmPm
        )
      ) tempErr.pharmacyTimings = true;
    }
    if (step === 1) {
      if (!form.qualification) tempErr.qualification = true;
      if (!form.stateCouncilReg) tempErr.stateCouncilReg = true;
      if (!form.drugLicenseRetail) tempErr.drugLicenseRetail = true;
      if (!form.gstin) tempErr.gstin = true;
      if (!files.qualificationCert) tempErr.qualificationCert = true;
      if (!files.councilCert) tempErr.councilCert = true;
      if (!files.retailLicense) tempErr.retailLicense = true;
      if (!files.gstCert) tempErr.gstCert = true;
    }
    if (step === 2) {
      if (!files.identityProof) tempErr.identityProof = true;
      if (!files.addressProof) tempErr.addressProof = true;
      if (!files.photo) tempErr.photo = true;
    }
    if (step === 3) {
      if (!form.bankAccount) tempErr.bankAccount = true;
      if (!form.accountHolder) tempErr.accountHolder = true;
      if (!form.bankName) tempErr.bankName = true;
      if (!form.ifsc) tempErr.ifsc = true;
    }
    if (step === 4) {
      if (!form.declarationAccepted) tempErr.declarationAccepted = true;
    }
    setErrors(tempErr);
    return Object.keys(tempErr).length > 0 ? "Please fill highlighted fields correctly!" : "";
  }

  // Navigation/Submission: All handled in form's onSubmit
  const handleStepSubmit = async (e) => {
    if (e) e.preventDefault();

    const errMsg = validateStep();
    if (errMsg) {
      setMsg(errMsg);
      return;
    }

    if (step < steps.length - 1) {
      setStep(s => s + 1);
      return;
    }

    // Final submit
    setLoading(true);
    try {
      const fd = new FormData();
      Object.keys(form).forEach(k => fd.append(k, form[k] || ""));
      fd.set("pharmacyTimings", computeTimings(form)); // only now, not in state!
      Object.keys(files).forEach(k => { if (files[k]) fd.append(k, files[k]); });

      fd.append("qualificationCert", files.qualificationCert);
      fd.append("councilCert", files.councilCert);
      fd.append("retailLicense", files.retailLicense);
      fd.append("gstCert", files.gstCert);
      if (files.wholesaleLicense) fd.append("wholesaleLicense", files.wholesaleLicense);
      if (files.shopEstablishmentCert) fd.append("shopEstablishmentCert", files.shopEstablishmentCert);
      if (files.tradeLicense) fd.append("tradeLicense", files.tradeLicense);
      fd.append("identityProof", files.identityProof);
      fd.append("addressProof", files.addressProof);
      fd.append("photo", files.photo);
      if (files.digitalSignature) fd.append("digitalSignature", files.digitalSignature);

      setMsg("");
      await axios.post(`${API_BASE}/api/pharmacy/register`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setMsg("Registration submitted! Await admin approval.");
      setForm({ ...initialForm });
      setFiles({});
      setStep(0);
    } catch (err) {
      setMsg(err.response?.data?.message || "Registration failed. Check your details!");
    }
    setLoading(false);
  };

  // Go back a step
  const handleBack = () => setStep(s => s - 1);

  // ===== RENDER =====
  return (
    <Box sx={{ maxWidth: 550, mx: "auto", mt: 3, p: 3, pb: 12, borderRadius: 4, bgcolor: "#fff", boxShadow: 4 }}>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 900, color: "#13C0A2" }}>
        Pharmacy Registration
      </Typography>
      <Stepper activeStep={step} alternativeLabel>
        {steps.map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
      </Stepper>
      <form onSubmit={handleStepSubmit} autoComplete="off">
        <Box sx={{ mt: 3 }}>
          <StepContent
            step={step}
            form={form}
            errors={errors}
            handleChange={handleChange}
            handleFile={handleFile}
            handleTimingChange={handleTimingChange}
            fileErrors={fileErrors}
            requiredDocs={requiredDocs}
            optionalDocs={optionalDocs}
            selectMenuProps={selectMenuProps}
            hours={hours}
            minutes={minutes}
            safe={safe}
          />
          {msg && (
            <Snackbar open={!!msg} autoHideDuration={3200} onClose={() => setMsg("")}>
              <Alert onClose={() => setMsg("")} severity={msg.toLowerCase().includes("fail") ? "error" : "success"}>
                {msg}
              </Alert>
            </Snackbar>
          )}
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            {step > 0 && step < 5 && (
              <Button onClick={handleBack} variant="outlined" type="button">
                Back
              </Button>
            )}
            {step < 4 && (
              <Button variant="contained" type="submit">
                Next
              </Button>
            )}
            {step === 4 && (
              <Button
                type="submit"
                fullWidth
                variant="contained"
                color="primary"
                disabled={loading}
                sx={{ fontWeight: 700 }}
              >
                {loading ? "Submitting..." : "Submit Registration"}
              </Button>
            )}
          </Stack>
        </Box>
      </form>
    </Box>
  );
}
