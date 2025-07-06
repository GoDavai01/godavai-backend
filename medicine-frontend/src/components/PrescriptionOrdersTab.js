// src/components/PrescriptionOrdersTab.js
import React, { useEffect, useState } from "react";
import {
  Box, Typography, Card, CardContent, Button, Stack, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Select, Snackbar, Alert, Autocomplete
} from "@mui/material";
import axios from "axios";

// Helper: returns seconds left from now to expiry
function getSecondsLeft(expiry) {
  if (!expiry) return 0;
  const t = Math.floor((new Date(expiry) - new Date()) / 1000);
  return t > 0 ? t : 0;
}

// --- Add this function ---
function isPartialQuoteValid(quote) {
  if (!Array.isArray(quote) || !quote.length) return false;
  return quote.every(row =>
    row.available !== false
      ? (row.medicineName && row.brand && row.quantity && row.price)
      : (row.medicineName)
  );
}

// Set API base
const API_BASE =
  process.env.REACT_APP_API_BASE_URL ||
  (typeof window !== "undefined" && window.REACT_APP_API_BASE_URL) ||
  "";

export default function PrescriptionOrdersTab({ token, medicines }) {
  const [orders, setOrders] = useState([]);
  const [timers, setTimers] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [quote, setQuote] = useState([
    { medicineName: "", brand: "", price: "", quantity: "", available: true }
  ]);
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [pharmacyMeds, setPharmacyMeds] = useState([]);
  const [quoteMode, setQuoteMode] = useState(""); // "accept" or "partial"
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [acceptDialogData, setAcceptDialogData] = useState([]); // [{ name, qty, brand, ... }]

  // Get all prescription orders for this pharmacy
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    axios
      .get("/api/prescriptions/pharmacy-orders", {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then((res) => setOrders(res.data || []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [token, msg, showQuoteDialog, showRejectDialog]);

  // Set up timers (global tick every 1s, update all order timers)
  useEffect(() => {
    if (!orders.length) return;
    const newTimers = {};
    orders.forEach(order => {
      newTimers[order._id] = getSecondsLeft(order.quoteExpiry);
    });
    setTimers(newTimers);

    const interval = setInterval(() => {
      setTimers(timers => {
        const updated = {};
        orders.forEach(order => {
          updated[order._id] = getSecondsLeft(order.quoteExpiry);
        });
        return updated;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [orders]);

  // --- FIX: Auto-close quote dialog if timer runs out
  useEffect(() => {
    if (
      showQuoteDialog &&
      selectedOrder &&
      (timers[selectedOrder._id] <= 0 || selectedOrder.status !== "waiting_for_quotes")
    ) {
      setShowQuoteDialog(false);
      setMsg("Quote window expired. You cannot submit a quote now.");
    }
  }, [timers, selectedOrder, showQuoteDialog]);

  // Get all medicines available at this pharmacy
  useEffect(() => {
    if (!token) return;
    axios
      .get("/api/pharmacy/medicines", {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then((res) => setPharmacyMeds(res.data || []))
      .catch(() => setPharmacyMeds([]));
  }, [token]);

  // --- QUOTE ACTIONS START ---

  // For Accept: all medicines must be available
  const handleAcceptOrder = (order) => {
    setSelectedOrder(order);
    setQuoteMode("accept");
    setAcceptDialogData((order.medicinesRequested || []).map(med => ({
      medicineName: med.name,
      quantity: med.quantity || 1,
      brand: "",
      price: "",
    })));
    setAcceptDialogOpen(true);
  };

  // For Partial: pharmacist can select available/unavailable
  const handlePartialFulfill = (order) => {
    setSelectedOrder(order);
    setQuoteMode("partial");
    const meds = (order.medicinesRequested || []).length
      ? order.medicinesRequested.map((med) => ({
          medicineName: med.name,
          brand: med.brand || "",
          price: "",
          quantity: med.quantity || 1,
          available: true
        }))
      : [{ medicineName: "", brand: "", price: "", quantity: "", available: true }];
    setQuote(meds);
    setShowQuoteDialog(true);
  };

  // For Reject: just show confirm dialog
  const handleRejectOrder = (order) => {
    setSelectedOrder(order);
    setShowRejectDialog(true);
  };

  // Confirm reject
  const confirmRejectOrder = async () => {
    try {
      await axios.post(
        `/api/prescriptions/respond/${selectedOrder._id}`,
        { response: "rejected" },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMsg("Order rejected!");
      setShowRejectDialog(false);
      setSelectedOrder(null);
    } catch {
      setMsg("Failed to reject order!");
      setShowRejectDialog(false);
    }
  };

  // Submit quote for this prescription order
  const handleSubmitQuote = async () => {
    // Extra guard on frontend (backend also has a check!)
    if (
      !selectedOrder ||
      timers[selectedOrder._id] <= 0 ||
      selectedOrder.status !== "waiting_for_quotes"
    ) {
      setMsg("Quote window expired. You cannot submit a quote now.");
      setShowQuoteDialog(false);
      return;
    }
     if (quoteMode === "partial" && !isPartialQuoteValid(quote)) {
    setMsg("Fill all fields for available items!");
    return;
  }
    if (quoteMode === "accept" && quote.some(row => !row.available)) {
      setMsg("All medicines must be available to accept the order!");
      return;
    }
    // PATCH: Make sure every quote line has available as true/false (default true)
    const cleanedQuote = quote.map(row => ({
      ...row,
      available: row.available === false ? false : true
    }));
    try {
      await axios.post(
        `/api/prescriptions/quote/${selectedOrder._id}`,
        { quote: cleanedQuote, mode: quoteMode },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMsg("Quote submitted!");
      setShowQuoteDialog(false);
    } catch {
      setMsg("Failed to submit quote!");
    }
  };

  // Add/remove/edit quote lines
  const addRow = () =>
    setQuote([
      ...quote,
      { medicineName: "", brand: "", price: "", quantity: "", available: true }
    ]);
  const updateRow = (i, key, val) => {
    const arr = [...quote];
    arr[i][key] = val;
    setQuote(arr);
  };

  // --- AcceptDialog total calculation ---
  const acceptDialogTotal = acceptDialogData.reduce(
    (sum, row) => sum + ((Number(row.price) || 0) * (Number(row.quantity) || 1)),
    0
  );

  if (loading) return <Typography>Loading prescription orders…</Typography>;
  if (!orders.length) return <Typography>No prescription orders yet.</Typography>;

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" mb={1}>Prescription Orders</Typography>
      {orders.map((order) => {
        const timer = timers[order._id] ?? 0;
        const isRejected = order.status === "cancelled" || order.userResponse === "rejected";
        const showActions = order.status === "waiting_for_quotes" && timer > 0 && !isRejected;

        return (
          <Card key={order._id} sx={{ mb: 2, bgcolor: "#21272b" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600}>
                Order #{order._id.slice(-5)} —{" "}
                <span style={{ color: "#FFD43B" }}>{order.status || "pending"}</span>
              </Typography>

              <Typography sx={{ mt: 1 }}>
                Prescription:{" "}
                {order.prescriptionUrl ? (
                  <a
                    href={
                      order.prescriptionUrl.startsWith("/uploads/")
                        ? `${API_BASE}${order.prescriptionUrl}`
                        : order.prescriptionUrl
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#FFD43B" }}
                  >
                    View
                  </a>
                ) : (
                  <span style={{ color: "#AAA" }}>Not Available</span>
                )}
              </Typography>
              {/* Already Fulfilled Items from Parent */}
{order.alreadyFulfilledItems && order.alreadyFulfilledItems.length > 0 && (
  <Box sx={{ mt: 1, mb: 1, bgcolor: "#23292e", borderRadius: 1.5, p: 1.5, border: "1.5px solid #FFD43B" }}>
    <Typography sx={{ color: "#FFD43B", fontWeight: 700, fontSize: 14 }}>
      Already fulfilled in this order:
    </Typography>
    <Typography sx={{ color: "#f18e1b", fontWeight: 600, fontSize: 15 }}>
      {order.alreadyFulfilledItems.map(med =>
        med.medicineName + (med.quantity ? ` (${med.quantity})` : '')
      ).join(", ")}
    </Typography>
    <Typography sx={{ color: "#bbb", fontSize: 13, mt: 1 }}>
      Please quote for the <b>remaining</b> medicines below.
    </Typography>
  </Box>
)}
              {order.notes && (
                <Typography sx={{ mt: 1, color: "#FFD43B" }}>
                  User Message: {order.notes}
                </Typography>
              )}
              {order.unavailableItems && order.unavailableItems.length > 0 && (
                <Typography color="error">
                  Unavailable: {order.unavailableItems.join(", ")}
                </Typography>
              )}

              <Typography variant="body2" color="#bbb" sx={{ mt: 0.5 }}>
                Created: {order.createdAt ? new Date(order.createdAt).toLocaleString() : "-"}
              </Typography>

              {/* Actions */}
              {showActions && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ mb: 1, color: "#FFD43B", fontWeight: 600 }}>
                    Select Action:
                  </Typography>
                  <Stack spacing={1}>
                    <Button
                      variant="contained"
                      color="success"
                      size="large"
                      fullWidth
                      sx={{ fontWeight: 700, letterSpacing: 0.5 }}
                      onClick={() => handleAcceptOrder(order)}
                    >
                      ACCEPT (ALL AVAILABLE)
                    </Button>
                    <Button
                      variant="contained"
                      color="warning"
                      size="large"
                      fullWidth
                      sx={{ fontWeight: 700, letterSpacing: 0.5 }}
                      onClick={() => handlePartialFulfill(order)}
                    >
                      PARTIAL FULFILL
                    </Button>
                    <Button
                      variant="contained"
                      color="error"
                      size="large"
                      fullWidth
                      sx={{ fontWeight: 700, letterSpacing: 0.5 }}
                      onClick={() => handleRejectOrder(order)}
                    >
                      REJECT
                    </Button>
                  </Stack>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2 }}>
                    <Typography color="secondary" fontWeight={600}>
                      ⏳ {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, "0")} left
                    </Typography>
                  </Stack>
                </Box>
              )}

              {/* After actions or other statuses */}
              {!showActions && !isRejected && (
  <>
    {order.status === "quoted" ? (
      <Typography color="success.main" fontWeight={600} sx={{ mt: 2 }}>
        Quote submitted
      </Typography>
    ) : timer > 0 ? (
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 2 }}>
        <Typography color="secondary" fontWeight={600}>
          ⏳ {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, "0")} left to quote
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={() => handlePartialFulfill(order)}
        >
          Submit Quote
        </Button>
      </Stack>
    ) : (
      <Typography color="error" fontWeight={600} sx={{ mt: 2 }}>
        Quote window expired
      </Typography>
    )}
  </>
)}
{isRejected && (
  <Typography color="error" fontWeight={700} sx={{ mt: 2 }}>
    Order rejected
  </Typography>
)}
            </CardContent>
          </Card>
        );
      })}

      {/* --- AcceptDialog (All Available) --- */}
      <Dialog open={acceptDialogOpen} onClose={() => setAcceptDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Accept (All Available) - Specify Brands, Qty & Price</DialogTitle>
        <DialogContent>
          <Box sx={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                background: "transparent",
                color: "#fff",
                borderCollapse: "collapse"
              }}
            >
              <thead>
                <tr style={{ background: "#222", fontWeight: 700 }}>
                  <th style={{ padding: 8 }}>Medicine</th>
                  <th style={{ padding: 8 }}>Brand</th>
                  <th style={{ padding: 8 }}>Qty</th>
                  <th style={{ padding: 8 }}>Price</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {acceptDialogData.map((row, i) => (
                  <tr key={i} style={{ background: "#181d23" }}>
                    <td style={{ padding: 6 }}>
                      <Autocomplete
                        freeSolo
                        options={pharmacyMeds || []}
                        getOptionLabel={(option) =>
                          typeof option === "string" ? option : option.name
                        }
                        value={
                          pharmacyMeds.find(
                            (med) => med.name === row.medicineName
                          ) || { name: row.medicineName }
                        }
                        onChange={(_, value) => {
                          const arr = [...acceptDialogData];
                          if (typeof value === "string") {
                            arr[i].medicineName = value;
                          } else if (value && value.name) {
                            arr[i].medicineName = value.name;
                            arr[i].brand = value.brand || "";
                            arr[i].price = value.price || "";
                          }
                          setAcceptDialogData(arr);
                        }}
                        onInputChange={(_, value) => {
                          const arr = [...acceptDialogData];
                          arr[i].medicineName = value;
                          setAcceptDialogData(arr);
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            placeholder="Medicine"
                            size="small"
                            variant="standard"
                            InputProps={{ ...params.InputProps, style: { color: "#fff" } }}
                          />
                        )}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <TextField
                        placeholder="Brand"
                        value={row.brand}
                        onChange={e => {
                          const arr = [...acceptDialogData];
                          arr[i].brand = e.target.value;
                          setAcceptDialogData(arr);
                        }}
                        size="small"
                        variant="standard"
                        InputProps={{ style: { color: "#fff" } }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <TextField
                        placeholder="Qty"
                        type="number"
                        value={row.quantity}
                        onChange={e => {
                          const arr = [...acceptDialogData];
                          arr[i].quantity = e.target.value;
                          setAcceptDialogData(arr);
                        }}
                        size="small"
                        variant="standard"
                        InputProps={{ style: { color: "#fff" } }}
                        sx={{ width: 60 }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <TextField
                        placeholder="Price"
                        type="number"
                        value={row.price}
                        onChange={e => {
                          const arr = [...acceptDialogData];
                          arr[i].price = e.target.value;
                          setAcceptDialogData(arr);
                        }}
                        size="small"
                        variant="standard"
                        InputProps={{ style: { color: "#fff" } }}
                        sx={{ width: 80 }}
                      />
                    </td>
                    <td>
                      {acceptDialogData.length > 1 && (
                        <Button
                          variant="text"
                          size="small"
                          color="error"
                          onClick={() =>
                            setAcceptDialogData(acceptDialogData.filter((_, j) => j !== i))
                          }
                        >
                          ✖
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5} style={{ textAlign: "right", padding: 8 }}>
                    <Button variant="outlined" onClick={() =>
                      setAcceptDialogData([...acceptDialogData, { medicineName: "", brand: "", quantity: 1, price: "" }])
                    } size="small">
                      + Add Medicine
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </Box>
          <Typography sx={{ mt: 2, fontWeight: 700, color: "#FFD43B", fontSize: 18 }}>
            Total Price: ₹{acceptDialogTotal}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAcceptDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              const cleanedQuote = acceptDialogData.map(row => ({
                medicineName: row.medicineName,
                brand: row.brand,
                price: Number(row.price) || 0,
                quantity: Number(row.quantity) || 1,
                available: true
              }));
              await axios.post(
                `/api/prescriptions/quote/${selectedOrder._id}`,
                {
                  quote: cleanedQuote,
                  mode: "accept",
                  approxPrice: acceptDialogTotal
                },
                { headers: { Authorization: `Bearer ${token}` } }
              );
              setAcceptDialogOpen(false);
              setMsg("Quote sent to user for confirmation.");
            }}
            disabled={
              acceptDialogData.length === 0 ||
              acceptDialogData.some(row => !row.brand || !row.medicineName || !row.quantity || !row.price) ||
              !selectedOrder ||
              timers[selectedOrder._id] <= 0 ||
              selectedOrder.status !== "waiting_for_quotes"
            }
          >
            Submit
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Quote Submission Dialog --- */}
      <Dialog
        open={showQuoteDialog}
        onClose={() => setShowQuoteDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {quoteMode === "accept"
            ? "Submit Quote (All Medicines Available)"
            : "Submit Partial Quote"}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                background: "transparent",
                color: "#fff",
                borderCollapse: "collapse"
              }}
            >
              <thead>
                <tr style={{ background: "#222", fontWeight: 700 }}>
                  <th style={{ padding: 8 }}>Medicine</th>
                  <th style={{ padding: 8 }}>Brand</th>
                  <th style={{ padding: 8 }}>Qty</th>
                  <th style={{ padding: 8 }}>Price</th>
                  <th style={{ padding: 8 }}>Available</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {quote.map((row, i) => (
                  <tr key={i} style={{ background: "#181d23" }}>
                    <td style={{ padding: 6 }}>
                      <Autocomplete
                        freeSolo
                        options={pharmacyMeds || []}
                        getOptionLabel={(option) =>
                          typeof option === "string" ? option : option.name
                        }
                        value={
                          pharmacyMeds.find(
                            (med) => med.name === row.medicineName
                          ) || { name: row.medicineName }
                        }
                        onChange={(_, value) => {
                          if (typeof value === "string") {
                            updateRow(i, "medicineName", value);
                          } else if (value && value.name) {
                            updateRow(i, "medicineName", value.name);
                            updateRow(i, "price", value.price || "");
                            updateRow(i, "brand", value.brand || "");
                            updateRow(i, "available", value.stock > 0);
                          }
                        }}
                        onInputChange={(_, value) =>
                          updateRow(i, "medicineName", value)
                        }
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            placeholder="Medicine"
                            size="small"
                            variant="standard"
                            InputProps={{
                              ...params.InputProps,
                              style: { color: "#fff" }
                            }}
                          />
                        )}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <TextField
                        placeholder="Brand"
                        value={row.brand}
                        onChange={(e) =>
                          updateRow(i, "brand", e.target.value)
                        }
                        size="small"
                        variant="standard"
                        InputProps={{ style: { color: "#fff" } }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <TextField
                        placeholder="Qty"
                        type="number"
                        value={row.quantity}
                        onChange={(e) =>
                          updateRow(i, "quantity", e.target.value)
                        }
                        size="small"
                        variant="standard"
                        InputProps={{ style: { color: "#fff" } }}
                        sx={{ width: 60 }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <TextField
                        placeholder="Price"
                        type="number"
                        value={row.price}
                        onChange={(e) =>
                          updateRow(i, "price", e.target.value)
                        }
                        size="small"
                        variant="standard"
                        InputProps={{ style: { color: "#fff" } }}
                        sx={{ width: 80 }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <Select
                        value={String(row.available)}
                        onChange={(e) =>
                          updateRow(i, "available", e.target.value === "true")
                        }
                        size="small"
                        variant="standard"
                        sx={{ color: "#fff", width: 100 }}
                        disabled={quoteMode === "accept"}
                      >
                        <MenuItem value="true">✓</MenuItem>
                        <MenuItem value="false">✗</MenuItem>
                      </Select>
                    </td>
                    <td>
                      {quote.length > 1 && (
                        <Button
                          variant="text"
                          size="small"
                          color="error"
                          onClick={() =>
                            setQuote(quote.filter((_, j) => j !== i))
                          }
                        >
                          ✖
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} style={{ textAlign: "right", padding: 8 }}>
                    <Button variant="outlined" onClick={addRow} size="small">
                      + Add Medicine
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </Box>
        </DialogContent>
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ m: 2 }}>
          <Button onClick={() => setShowQuoteDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmitQuote}
            disabled={
              !selectedOrder ||
              timers[selectedOrder._id] <= 0 ||
              selectedOrder.status !== "waiting_for_quotes" ||
              (quoteMode === "partial" && !isPartialQuoteValid(quote))
            }
          >
            Submit Quote
          </Button>
        </Stack>
      </Dialog>

      {/* --- Reject Confirmation Dialog --- */}
      <Dialog open={showRejectDialog} onClose={() => setShowRejectDialog(false)}>
        <DialogTitle>Reject Order?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to <span style={{ color: "red", fontWeight: 600 }}>reject</span> this prescription order? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowRejectDialog(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={confirmRejectOrder}>
            Yes, Reject
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!msg}
        autoHideDuration={2200}
        onClose={() => setMsg("")}
      >
        <Alert
          onClose={() => setMsg("")}
          severity={msg.toLowerCase().includes("fail") ? "error" : "success"}
        >
          {msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
