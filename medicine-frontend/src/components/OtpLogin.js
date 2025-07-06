// src/components/OtpLogin.js
import React, { useState } from "react";
import {
  Box, TextField, Button, Typography, CircularProgress, Snackbar, Alert
} from "@mui/material";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { jwtDecode } from "jwt-decode";

export default function OtpLogin({ onLogin }) {
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "info" });

  const { login } = useAuth();

  const handleSendOtp = async () => {
    if (!identifier) {
      setSnack({ open: true, msg: "Enter mobile or email.", severity: "warning" });
      return;
    }
    setLoading(true);
    try {
      await axios.post("/api/auth/send-otp", { identifier });
      setStep(2);
      setSnack({ open: true, msg: "OTP sent!", severity: "success" });
    } catch (err) {
      setSnack({ open: true, msg: err.response?.data?.error || "Error sending OTP.", severity: "error" });
    }
    setLoading(false);
  };

  const handleVerifyOtp = async () => {
    if (!otp) {
      setSnack({ open: true, msg: "Enter OTP.", severity: "warning" });
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post("/api/auth/verify-otp", { identifier, otp });
      setSnack({ open: true, msg: "Login Successful!", severity: "success" });

      // Save token, decode user, update AuthContext
      const token = res.data.token;
      const decoded = jwtDecode(token);
      const userObj = {
        _id: decoded.userId,
        mobile: decoded.mobile,
        email: decoded.email,
        name: decoded.name,
      };
      login(userObj, token);

      if (onLogin) onLogin(userObj);

      window.location.href = "/"; // Or use navigate("/home");
    } catch (err) {
      setSnack({ open: true, msg: err.response?.data?.error || "OTP verification failed.", severity: "error" });
    }
    setLoading(false);
  };

  return (
    <Box sx={{
      maxWidth: 360,
      mx: "auto",
      mt: 6,
      p: 3,
      boxShadow: 2,
      borderRadius: 3,
      bgcolor: "#fff",
      minHeight: 360,
      display: "flex",
      flexDirection: "column",
      gap: 2
    }}>
      <Typography variant="h5" textAlign="center" fontWeight={600}>
        Login / Register
      </Typography>
      {step === 1 ? (
        <>
          <TextField
            label="Mobile number or Email"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            fullWidth
            autoFocus
            inputProps={{ maxLength: 50 }}
          />
          <Button
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            disabled={loading}
            onClick={handleSendOtp}
            sx={{ mt: 2 }}
          >
            {loading ? <CircularProgress size={24} /> : "Send OTP"}
          </Button>
        </>
      ) : (
        <>
          <Typography fontWeight={500}>
            OTP sent to <span style={{ color: "#13C0A2" }}>{identifier}</span>
          </Typography>
          <TextField
            label="Enter OTP"
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
            fullWidth
            autoFocus
            inputProps={{ maxLength: 6, style: { letterSpacing: 6, fontSize: 24, textAlign: "center" } }}
          />
          <Button
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            disabled={loading}
            onClick={handleVerifyOtp}
            sx={{ mt: 2 }}
          >
            {loading ? <CircularProgress size={24} /> : "Verify & Login"}
          </Button>
          <Button
            fullWidth
            sx={{ mt: 1 }}
            onClick={() => setStep(1)}
          >
            Change number/email
          </Button>
        </>
      )}
      <Snackbar
        open={snack.open}
        autoHideDuration={3500}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
      >
        <Alert severity={snack.severity}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
