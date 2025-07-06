import React, { useState } from "react";
import {
  Box, Typography, TextField, Stack, Button, Snackbar, Alert, Paper
} from "@mui/material";
import TwoWheelerIcon from "@mui/icons-material/TwoWheeler";
import axios from "axios";

export default function RegisterDeliveryPartner() {
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    email: "",
    password: "",
    vehicle: "",
    city: "",
    area: "",
    aadhaarNumber: "",
    panNumber: "",
    bankAccount: "",
    ifsc: "",
    accountHolder: ""
  });
  const [aadhaarFile, setAadhaarFile] = useState(null);
  const [panFile, setPanFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Input filtering for certain fields
    if (name === "mobile") {
      setForm(f => ({ ...f, [name]: value.replace(/\D/g, "").slice(0, 10) }));
    } else if (name === "aadhaarNumber") {
      setForm(f => ({ ...f, [name]: value.replace(/\D/g, "").slice(0, 12) }));
    } else if (name === "panNumber") {
      setForm(f => ({ ...f, [name]: value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) }));
    } else {
      setForm(f => ({ ...f, [name]: value }));
    }
  };

  const handleFileChange = (e, setter) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      // Optional: Limit file size to 2MB
      if (file.size > 2 * 1024 * 1024) {
        setSnackbar({ open: true, message: "Max 2MB file size allowed.", severity: "error" });
        return;
      }
      setter(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Client-side validation for critical fields
    if (form.mobile.length !== 10) {
      setSnackbar({ open: true, message: "Enter valid 10 digit mobile", severity: "error" }); return;
    }
    if (form.aadhaarNumber.length !== 12) {
      setSnackbar({ open: true, message: "Aadhaar must be 12 digits", severity: "error" }); return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.panNumber)) {
      setSnackbar({ open: true, message: "Enter valid PAN number", severity: "error" }); return;
    }
    setLoading(true);
    const data = new FormData();
    Object.keys(form).forEach(key => data.append(key, form[key]));
    if (aadhaarFile) data.append("aadhaarDoc", aadhaarFile);
    if (panFile) data.append("panDoc", panFile);
    try {
      await axios.post("/api/delivery/register", data, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setSnackbar({ open: true, message: "Registration submitted for approval!", severity: "success" });
      setForm({
        name: "", mobile: "", email: "", password: "", vehicle: "", city: "",
        area: "", aadhaarNumber: "", panNumber: "", bankAccount: "", ifsc: "", accountHolder: ""
      });
      setAadhaarFile(null); setPanFile(null);
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || "Failed to register",
        severity: "error"
      });
    }
    setLoading(false);
  };

  return (
    <Box sx={{ maxWidth: 410, mx: "auto", mt: 4 }}>
      <Paper sx={{ p: 4, borderRadius: 5, boxShadow: 3 }}>
        <Typography variant="h5" sx={{ color: "#1976d2", fontWeight: 800, mb: 2 }}>
          <TwoWheelerIcon sx={{ mb: "-6px", mr: 1 }} />
          Delivery Partner Registration
        </Typography>
        <form onSubmit={handleSubmit} encType="multipart/form-data">
          <Stack spacing={2}>
            <TextField label="Full Name" name="name" required value={form.name} onChange={handleChange} disabled={loading} />
            <TextField
              label="Mobile Number"
              name="mobile"
              required
              value={form.mobile}
              onChange={handleChange}
              inputProps={{ maxLength: 10 }}
              helperText="10 digit mobile"
              disabled={loading}
            />
            <TextField label="Email Address" name="email" required type="email" value={form.email} onChange={handleChange} disabled={loading} />
            <TextField label="Password" name="password" required type="password" value={form.password} onChange={handleChange} disabled={loading} />
            <TextField label="Vehicle Type" name="vehicle" required value={form.vehicle} onChange={handleChange} disabled={loading} />
            <TextField label="City" name="city" required value={form.city} onChange={handleChange} disabled={loading} />
            <TextField label="Area/Locality" name="area" required value={form.area} onChange={handleChange} disabled={loading} />
            <TextField
              label="Aadhaar Number"
              name="aadhaarNumber"
              required
              value={form.aadhaarNumber}
              onChange={handleChange}
              inputProps={{ maxLength: 12 }}
              helperText="12 digit Aadhaar"
              disabled={loading}
            />
            <Button variant="outlined" component="label" disabled={loading}>
              Upload Aadhaar Card
              <input type="file" name="aadhaarDoc" hidden accept="image/*,.pdf" onChange={e => handleFileChange(e, setAadhaarFile)} />
            </Button>
            <TextField
              label="PAN Number"
              name="panNumber"
              required
              value={form.panNumber}
              onChange={handleChange}
              inputProps={{ maxLength: 10 }}
              helperText="Format: ABCDE1234F"
              disabled={loading}
            />
            <Button variant="outlined" component="label" disabled={loading}>
              Upload PAN Card
              <input type="file" name="panDoc" hidden accept="image/*,.pdf" onChange={e => handleFileChange(e, setPanFile)} />
            </Button>
            <TextField label="Bank Account Number" name="bankAccount" required value={form.bankAccount} onChange={handleChange} disabled={loading} />
            <TextField label="IFSC Code" name="ifsc" required value={form.ifsc} onChange={handleChange} disabled={loading} />
            <TextField label="Account Holder Name" name="accountHolder" required value={form.accountHolder} onChange={handleChange} disabled={loading} />
            <Button variant="contained" color="primary" type="submit" disabled={loading}>
              {loading ? "Registering..." : "Register"}
            </Button>
          </Stack>
        </form>
      </Paper>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2500}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
