import React, { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Divider,
  Snackbar,
  Alert,
  Stack,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", mobile: "", password: "" });
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "error" });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { register } = useAuth();

  // Allow sign up with either email OR mobile (one is required)
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setSnackbar({ open: true, message: "Name is required", severity: "error" }); return;
    }
    if (!form.email.trim() && !form.mobile.trim()) {
      setSnackbar({ open: true, message: "Email or Mobile number is required", severity: "error" }); return;
    }
    if (form.mobile && !/^\d{10}$/.test(form.mobile)) {
      setSnackbar({ open: true, message: "Enter a valid 10 digit mobile number", severity: "error" });
      return;
    }
    if (!form.password.trim()) {
      setSnackbar({ open: true, message: "Password is required", severity: "error" }); return;
    }
    setLoading(true);
    try {
      await register(form); // AuthContext handles API call
      setSnackbar({ open: true, message: "Registration successful! Please login.", severity: "success" });
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      setSnackbar({ open: true, message: err.message || "Registration failed", severity: "error" });
    }
    setLoading(false);
  };

  return (
    <Box sx={{ maxWidth: 410, mx: "auto", mt: 8 }}>
      <Card sx={{ p: 2, borderRadius: 4, boxShadow: 3 }}>
        <CardContent>
          <Typography variant="h5" sx={{ mb: 2, fontWeight: 700, color: "#1976d2" }}>
            Create your account
          </Typography>
          <form onSubmit={handleSubmit} autoComplete="off">
            <TextField
              fullWidth
              label="Full Name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              sx={{ mb: 2 }}
              required
            />
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <TextField
                label="Email (optional)"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Mobile (optional)"
                type="tel"
                value={form.mobile}
                onChange={e => setForm(f => ({
                  ...f,
                  mobile: e.target.value.replace(/\D/g, "").slice(0, 10)
                }))}
                sx={{ flex: 1 }}
                inputProps={{ maxLength: 10 }}
                helperText="10 digit number"
              />
            </Stack>
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              sx={{ mb: 2 }}
              required
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 1, fontWeight: 700 }}
              disabled={loading}
            >
              Sign Up
            </Button>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" align="center">
              Already have an account?{" "}
              <Button variant="text" onClick={() => navigate("/login")} sx={{ color: "#1976d2" }}>
                Sign In
              </Button>
            </Typography>
          </form>
        </CardContent>
      </Card>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2500}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity} sx={{ width: "100%" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
