import React, { useState } from "react"; 
import {
  Box, Typography, TextField, Button, Stack, Snackbar, Alert
} from "@mui/material";
import axios from "axios";

export default function AdminRegistration() {
  // Add 'code' to the state
  const [data, setData] = useState({ email: "", password: "", name: "", code: "" });
  const [msg, setMsg] = useState("");

  const handleChange = (e) =>
    setData({ ...data, [e.target.name]: e.target.value });

  const handleSubmit = async () => {
    try {
      // Use relative URL for production!
      await axios.post("/api/admin/register", data);
      setMsg("Admin registered!");
      setData({ email: "", password: "", name: "", code: "" });
    } catch (e) {
      setMsg("Registration failed.");
    }
  };

  return (
    <Box sx={{ maxWidth: 400, mx: "auto", mt: 7, p: 3, borderRadius: 3, boxShadow: 2, bgcolor: "background.paper" }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 900, color: "#1188A3" }}>Admin Registration</Typography>
      <Stack spacing={2}>
        <TextField label="Name" name="name" value={data.name} onChange={handleChange} required />
        <TextField label="Email" name="email" value={data.email} onChange={handleChange} required />
        <TextField label="Password" name="password" value={data.password} onChange={handleChange} type="password" required />
        {/* --- Add this for secret code --- */}
        <TextField label="Secret Code" name="code" value={data.code} onChange={handleChange} required />
        <Button variant="contained" onClick={handleSubmit} sx={{ fontWeight: 700 }}>Register</Button>
      </Stack>
      <Snackbar open={!!msg} autoHideDuration={2100} onClose={() => setMsg("")}>
        <Alert onClose={() => setMsg("")} severity={msg.includes("fail") ? "error" : "success"}>{msg}</Alert>
      </Snackbar>
    </Box>
  );
}
