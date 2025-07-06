import React, { useState } from "react";
import { Box, Typography, Button, TextField, Snackbar, Alert } from "@mui/material";
import axios from "axios";

export default function DriverSimulator() {
  const [orderId, setOrderId] = useState("");
  const [msg, setMsg] = useState("");

  const startSim = async () => {
    if (!orderId) return setMsg("Order ID required!");
    try {
      // ---- PROD: Use relative URL (never localhost) ----
      await axios.post(`/api/simulate-driver/${orderId}`);
      setMsg("Driver simulation started!");
    } catch {
      setMsg("Failed to start simulation.");
    }
  };

  return (
    <Box sx={{ maxWidth: 400, mx: "auto", mt: 6, p: 3, border: "1px solid #ccc", borderRadius: 3 }}>
      <Typography variant="h5" mb={2}>Driver Simulator</Typography>
      <TextField
        label="Order ID"
        fullWidth
        value={orderId}
        onChange={e => setOrderId(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Button variant="contained" fullWidth onClick={startSim}>
        Start Driver Simulation (Live Tracking)
      </Button>
      <Snackbar open={!!msg} autoHideDuration={2100} onClose={() => setMsg("")}>
        <Alert onClose={() => setMsg("")} severity={msg.includes("fail") ? "error" : "success"}>{msg}</Alert>
      </Snackbar>
    </Box>
  );
}
