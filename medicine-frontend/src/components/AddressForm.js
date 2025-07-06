import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  Button,
  Stack,
  ToggleButtonGroup,
  ToggleButton
} from "@mui/material";

export default function AddressForm({ open, onClose, onSave, initial = {} }) {
  const [type, setType] = useState(initial.type || "Home");
  const [name, setName] = useState(initial.name || "");
  const [phone, setPhone] = useState(initial.phone || "");
  const [addressLine, setAddressLine] = useState(initial.addressLine || "");
  const [floor, setFloor] = useState(initial.floor || "");
  const [landmark, setLandmark] = useState(initial.landmark || "");

  useEffect(() => {
    setType(initial.type || "Home");
    setName(initial.name || "");
    setPhone(initial.phone || "");
    setAddressLine(initial.addressLine || "");
    setFloor(initial.floor || "");
    setLandmark(initial.landmark || "");
  }, [open, initial]);

  const handleSave = () => {
    if (!name || !phone || !addressLine) return;
    onSave({
      type,
      name,
      phone,
      addressLine,
      floor,
      landmark,
      id: initial.id || Date.now(),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add/Edit Address</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <ToggleButtonGroup value={type} exclusive onChange={(_, t) => t && setType(t)}>
            <ToggleButton value="Home">Home</ToggleButton>
            <ToggleButton value="Work">Work</ToggleButton>
            <ToggleButton value="Other">Other</ToggleButton>
          </ToggleButtonGroup>
          <TextField label="Name" fullWidth value={name} onChange={e => setName(e.target.value)} />
          <TextField
            label="Phone"
            fullWidth
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/[^\d+]/g, ""))}
            inputProps={{ maxLength: 15, pattern: "[0-9+ ]*" }}
          />
          <TextField label="Address" fullWidth value={addressLine} onChange={e => setAddressLine(e.target.value)} />
          <TextField label="Floor (optional)" fullWidth value={floor} onChange={e => setFloor(e.target.value)} />
          <TextField label="Landmark (optional)" fullWidth value={landmark} onChange={e => setLandmark(e.target.value)} />
          <Button variant="contained" onClick={handleSave}>
            Save Address
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
