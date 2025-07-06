// src/components/StepperStandalone.js
import React, { useState } from "react";
import { Box, TextField, Typography, Stack } from "@mui/material";

export default function StepperStandalone() {
  const [form, setForm] = useState({ name: "", ownerName: "" });
  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  return (
    <Box sx={{ maxWidth: 400, mx: "auto", mt: 6 }}>
      <Typography variant="h6">Standalone Typing Test</Typography>
      <Stack spacing={2} sx={{ mt: 2 }}>
        <TextField
          label="Pharmacy Name"
          name="name"
          value={form.name}
          onChange={handleChange}
        />
        <TextField
          label="Pharmacist's Name (Owner)"
          name="ownerName"
          value={form.ownerName}
          onChange={handleChange}
        />
      </Stack>
    </Box>
  );
}
