// src/components/PrescriptionUploadModal.js
import React, { useRef, useState, useEffect } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Stack, CircularProgress,
  Alert, Snackbar, RadioGroup, FormControlLabel, Radio, TextField,
  FormControl, InputLabel, Select, MenuItem, Chip
} from "@mui/material";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import HomeIcon from "@mui/icons-material/Home";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";
import AddressForm from "./AddressForm";

export default function PrescriptionUploadModal({
  open, onClose, userCity = "Delhi", userArea = "", afterOrder,
  initialMode,        // NEW
  initialNotes,       // NEW
  initialFileUrl,     // NEW
  initialAddress      // NEW
}) {
  const fileInputRef = useRef();
  const { addresses, updateAddresses } = useAuth();

  // Address selection state
  const [selectedAddressId, setSelectedAddressId] = useState(addresses[0]?.id || null);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(null);

  // File and prescription order
  const [step, setStep] = useState(1); // 1=choose, 2=wait, 3=quote ready
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [order, setOrder] = useState(null);
  const [quoteReady, setQuoteReady] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  // --- NEW FIELDS ---
  const [uploadType, setUploadType] = useState("auto"); // "auto" | "manual"
  const [notes, setNotes] = useState("");
  const [pharmacyList, setPharmacyList] = useState([]);
  const [pharmacyLoading, setPharmacyLoading] = useState(false);
  const [selectedPharmacy, setSelectedPharmacy] = useState("");

  // --- PREFILL SUPPORT ---
  useEffect(() => {
    if (open) {
      if (initialMode) setUploadType(initialMode);
      if (initialNotes !== undefined) setNotes(initialNotes);
      if (initialAddress && initialAddress.id) setSelectedAddressId(initialAddress.id);
      if (initialFileUrl) setPreview(initialFileUrl); // Just for preview, won't set file object
    }
    // eslint-disable-next-line
  }, [open, initialMode, initialNotes, initialFileUrl, initialAddress]);

  // Sync selected address on context update
  useEffect(() => {
    if (!selectedAddressId && addresses.length > 0) setSelectedAddressId(addresses[0].id);
  }, [addresses, selectedAddressId]);

  // Poll for quote status when waiting for quote
  useEffect(() => {
    let interval;
    if (step === 2 && order?._id && !quoteReady) {
      interval = setInterval(async () => {
        try {
          const token = localStorage.getItem("token");
          const res = await axios.get(
            `/api/prescriptions/order/${order._id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (res.data.status === "quoted" || (res.data.quotes && res.data.quotes.length)) {
            setQuoteReady(true);
            clearInterval(interval);
            setSnackbar({
              open: true,
              message: "Quote received for your prescription!",
              severity: "success",
            });
            setTimeout(() => handleClose(), 1600);
          }
        } catch {}
      }, 3500);
    }
    return () => interval && clearInterval(interval);
    // eslint-disable-next-line
  }, [step, order, quoteReady]);

  // Manual: Fetch pharmacy list if needed
  useEffect(() => {
    if (open && uploadType === "manual") {
      setPharmacyLoading(true);
      axios.get(`/api/pharmacies?city=${encodeURIComponent(userCity)}${userArea ? `&area=${encodeURIComponent(userArea)}` : ""}`)
        .then(res => setPharmacyList(res.data))
        .catch(() => setPharmacyList([]))
        .finally(() => setPharmacyLoading(false));
    }
  }, [uploadType, open, userCity, userArea]);

  // File change
  const handleFileChange = (e) => {
    const f = e.target.files[0];
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : "");
  };

  // File picker open
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Prevent mobile number in notes
  function sanitizeNotes(str) {
    return str.replace(/\d{10,}/g, "[blocked]");
  }

  // Address save (add/edit)
  const handleSaveAddress = async (addr) => {
    let updated;
    if (addr.id && addresses.some(a => a.id === addr.id)) {
      updated = addresses.map(a => (a.id === addr.id ? addr : a));
    } else {
      addr.id = Date.now().toString();
      updated = [...addresses, addr];
    }
    await updateAddresses(updated);
    setSelectedAddressId(addr.id);
    setAddressFormOpen(false);
    setEditingAddress(null);
  };

  // Confirm-before-delete handler
  const handleDeleteAddress = async (addr) => {
    if (!window.confirm("Are you sure you want to delete this address?")) return;
    const updated = addresses.filter(a => a.id !== addr.id);
    await updateAddresses(updated);
    setSnackbar({ open: true, message: "Address deleted!", severity: "success" });
    if (selectedAddressId === addr.id && updated.length) {
      setSelectedAddressId(updated[0].id);
    } else if (updated.length === 0) {
      setSelectedAddressId(null);
    }
  };

  // Submit prescription order
  const handleSubmit = async () => {
    if (!selectedAddressId) return setError("Please select or add a delivery address.");
    if (!file && !preview) return setError("Upload a prescription file first.");
    if (uploadType === "manual" && !selectedPharmacy)
      return setError("Select a pharmacy.");
    if (/\d{10,}/.test(notes))
      return setError("Mobile numbers not allowed in notes.");
    setError("");
    setStep(2);
    try {
      const token = localStorage.getItem("token");
      let prescriptionUrl = preview;
      if (file) {
        const data = new FormData();
        data.append("prescription", file);
        const uploadRes = await axios.post(
          "/api/prescriptions/upload",
          data,
          {
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "multipart/form-data"
            }
          }
        );
        prescriptionUrl = uploadRes.data.prescriptionUrl || uploadRes.data.url;
      }
      const orderRes = await axios.post(
        "/api/prescriptions/order",
        {
          prescriptionUrl,
          city: userCity,
          area: userArea,
          notes: sanitizeNotes(notes),
          uploadType,
          chosenPharmacyId: uploadType === "manual" ? selectedPharmacy : undefined,
          address: addresses.find(a => a.id === selectedAddressId) || {},
        },
        {
          headers: { "Authorization": `Bearer ${token}` }
        }
      );
      setOrder(orderRes.data);
      setSnackbar({
        open: true,
        message: "Prescription submitted! We'll notify you when quotes arrive.",
        severity: "info",
      });
      afterOrder?.(orderRes.data);
    } catch (e) {
      setError("Failed to submit. Try again.");
      setStep(1);
    }
  };

  // Reset on close
  const handleClose = () => {
    setStep(1);
    setFile(null);
    setPreview("");
    setError("");
    setOrder(null);
    setQuoteReady(false);
    setSnackbar({ open: false, message: "", severity: "success" });
    setNotes("");
    setUploadType("auto");
    setPharmacyList([]);
    setSelectedPharmacy("");
    setAddressFormOpen(false);
    setSelectedAddressId(addresses[0]?.id || null);
    setEditingAddress(null);
    onClose();
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
        <DialogTitle>
          {step === 1 && "Upload Prescription"}
          {step === 2 && (quoteReady ? "Quote Received!" : "Waiting for Quotes")}
        </DialogTitle>
        <DialogContent dividers>
          {step === 1 && (
            <Stack spacing={2} alignItems="center">
              {/* MOBILE-OPTIMIZED ADDRESS SELECTION */}
              <Box sx={{ width: "100%", mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                  Delivery Address
                </Typography>
                {addresses.length === 0 ? (
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    startIcon={<AddLocationAltIcon />}
                    onClick={() => { setEditingAddress(null); setAddressFormOpen(true); }}
                    sx={{ mb: 1 }}
                  >
                    Add New Address
                  </Button>
                ) : (
                  addresses
                    .filter(addr => !selectedAddressId || addr.id === selectedAddressId)
                    .map(addr => (
                      <Box
                        key={addr.id}
                        sx={{
                          bgcolor: "#15171C",
                          borderRadius: 2,
                          p: 2,
                          mb: 1,
                          color: "#fff",
                          boxShadow: 3,
                          minWidth: 0,
                          maxWidth: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 1,
                        }}
                      >
                        <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                          <Chip
                            size="small"
                            icon={<HomeIcon sx={{ color: "#31c48d" }} />}
                            label={addr.type}
                            sx={{ bgcolor: "#232a36", color: "#fff", fontWeight: 600, height: 24 }}
                          />
                          <Typography fontWeight={700} fontSize={15} sx={{ ml: 1 }}>
                            {addr.name}
                          </Typography>
                          <Typography fontSize={12} sx={{ ml: 2, opacity: 0.8 }}>
                            {addr.phone}
                          </Typography>
                        </Stack>
                        <Typography fontSize={14} sx={{ opacity: 0.92 }}>
                          {addr.addressLine}
                        </Typography>
                        <Stack direction="row" spacing={1} mt={1}>
                          <Button
                            size="small"
                            variant="text"
                            sx={{ color: "#FFD43B", fontWeight: 600, px: 1.5, minWidth: 0 }}
                            onClick={e => {
                              e.stopPropagation();
                              setEditingAddress(addr);
                              setAddressFormOpen(true);
                            }}
                            startIcon={<EditIcon />}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            variant="text"
                            sx={{ color: "#ff3333", fontWeight: 600, px: 1.5, minWidth: 0 }}
                            onClick={e => {
                              e.stopPropagation();
                              handleDeleteAddress(addr);
                            }}
                            startIcon={<DeleteIcon />}
                          >
                            Delete
                          </Button>
                        </Stack>
                      </Box>
                    ))
                )}
                {addresses.length > 0 && (
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    startIcon={<AddLocationAltIcon />}
                    onClick={() => { setEditingAddress(null); setAddressFormOpen(true); }}
                    sx={{ mb: 1 }}
                  >
                    Add New Address
                  </Button>
                )}
                <AddressForm
                  open={addressFormOpen}
                  onClose={() => { setAddressFormOpen(false); setEditingAddress(null); }}
                  onSave={handleSaveAddress}
                  initial={editingAddress || addresses.find(a => a.id === selectedAddressId) || {}}
                />
              </Box>
              {/* END MOBILE ADDRESS */}

              {/* CHOOSE TYPE */}
              <RadioGroup
                row
                value={uploadType}
                onChange={e => setUploadType(e.target.value)}
                sx={{ width: "100%", mb: 1, justifyContent: "center" }}
              >
                <FormControlLabel value="auto" control={<Radio />} label="Let GoDavai Handle" />
                <FormControlLabel value="manual" control={<Radio />} label="Choose Pharmacy Yourself" />
              </RadioGroup>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                hidden
                onChange={handleFileChange}
              />
              <Button variant="outlined" color="primary" onClick={handleUploadClick}>
                {file || preview ? "Change File" : "Choose File"}
              </Button>
              {(preview) && (
                <Box sx={{
                  mt: 1, mb: 1, maxWidth: 180, maxHeight: 180, borderRadius: 2,
                  overflow: "hidden", border: "1px solid #ddd"
                }}>
                  <img src={preview} alt="Preview" style={{ width: "100%" }} />
                </Box>
              )}
              <TextField
                label="Add a note for pharmacy (no mobile numbers allowed)"
                value={notes}
                onChange={e => setNotes(e.target.value.replace(/\d{10,}/g, ""))}
                fullWidth
                size="small"
                inputProps={{ maxLength: 120 }}
                multiline
                rows={2}
              />
              {/* PHARMACY DROPDOWN FOR MANUAL */}
              {uploadType === "manual" && (
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel id="select-pharmacy-label">Select a Pharmacy</InputLabel>
                  <Select
                    labelId="select-pharmacy-label"
                    value={selectedPharmacy}
                    label="Select a Pharmacy"
                    onChange={e => setSelectedPharmacy(e.target.value)}
                    disabled={pharmacyLoading || pharmacyList.length === 0}
                  >
                    {pharmacyLoading && (
                      <MenuItem disabled>Loading pharmacies...</MenuItem>
                    )}
                    {pharmacyList.length === 0 && !pharmacyLoading && (
                      <MenuItem disabled>No pharmacies found in this location.</MenuItem>
                    )}
                    {pharmacyList.map(ph => (
                      <MenuItem key={ph._id} value={ph._id}>
                        {ph.name} ({ph.area}, {ph.city})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <Typography variant="body2" color="text.secondary">
                Upload a photo or PDF of your prescription to get a quote from pharmacy.
              </Typography>
              {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
            </Stack>
          )}
          {step === 2 && (
            <Stack alignItems="center" spacing={2} sx={{ minHeight: 120 }}>
              {!quoteReady ? (
                <>
                  <CircularProgress color="warning" />
                  <Typography color="primary">
                    Prescription sent!<br />
                    Waiting for quote from pharmacy…
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    We’ll notify you as soon as a pharmacy sends a quote.<br />
                    You can close this window and continue using the app.
                  </Typography>
                </>
              ) : (
                <>
                  <Typography fontSize={48} color="success.main">✔️</Typography>
                  <Typography color="success.main" fontWeight={700}>
                    Quote received! Check details on your orders page.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Pharmacy has sent a quote for your prescription.
                  </Typography>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {step === 1 && <Button onClick={handleClose}>Cancel</Button>}
          {step === 1 && (
            <Button
              onClick={handleSubmit}
              variant="contained"
              color="primary"
              sx={{
                bgcolor: "#FFD43B",
                color: "#1199a6",
                fontWeight: 700,
                "&:hover": { bgcolor: "#f2c200" }
              }}
              fullWidth
            >
              Upload Prescription
            </Button>
          )}
          {step === 2 && <Button onClick={handleClose}>Close</Button>}
        </DialogActions>
      </Dialog>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity} sx={{ width: "100%" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
