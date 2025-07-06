// src/components/PharmacyDashboard.js
import React, { useEffect, useState, useRef } from "react";
import {
  Box, Typography, Button, Card, CardContent, TextField, Stack, Chip,
  Snackbar, Alert, ThemeProvider, createTheme, CssBaseline, Divider, IconButton, MenuItem, Select, InputLabel, FormControl,
  Dialog, DialogTitle, DialogContent, DialogActions, Switch
} from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DoneIcon from "@mui/icons-material/Done";
import CloseIcon from "@mui/icons-material/Close";
import PrescriptionOrdersTab from "./PrescriptionOrdersTab";
import PhotoCamera from "@mui/icons-material/PhotoCamera";
import axios from "axios";
import { Table, TableHead, TableRow, TableCell, TableBody } from "@mui/material";

function PharmacyPayoutsSection({ token, pharmacyId }) {
  const [payouts, setPayouts] = useState([]);
  useEffect(() => {
    if (!token || !pharmacyId) return;
    fetch(`/api/payments?pharmacyId=${pharmacyId}&status=paid`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setPayouts(data));
  }, [token, pharmacyId]);
  const total = payouts.reduce((sum, p) => sum + (p.pharmacyAmount || 0), 0);
  return (
    <Box sx={{ mb: 3 }}>
      <Card sx={{ bgcolor: "#21272b", mb: 1 }}>
        <CardContent>
          <Typography variant="h6" color="success.main" fontWeight={700}>
            Your Earnings
          </Typography>
          <Typography variant="h4" fontWeight={900} sx={{ mb: 2 }}>
            ₹{total.toLocaleString("en-IN")}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {payouts.map(pay => (
                <TableRow key={pay._id}>
                  <TableCell>{pay.orderId?._id?.slice(-5)}</TableCell>
                  <TableCell>{new Date(pay.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>₹{pay.pharmacyAmount}</TableCell>
                  <TableCell>{pay.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {payouts.length === 0 && (
            <Typography color="warning.main" fontSize={15}>No payouts yet.</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#13C0A2" },
    secondary: { main: "#FFD43B" },
    success: { main: "#33C37E" },
  },
});
function formatRupees(val) {
  if (!val) return "₹0";
  return "₹" + Number(val).toLocaleString("en-IN");
}
function todayString() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
const MED_CATEGORIES = [
  "Pain Relief",
  "Fever",
  "Cough & Cold",
  "Antibiotic",
  "Digestive",
  "Diabetes",
  "Hypertension",
  "Supplements",
  "Other"
];

// --- Status helpers ---
function getStatusLabel(status) {
  if (status === "quoted") return "Quote Sent - Awaiting User";
  if (status === 0 || status === "placed" || status === "pending") return "Placed";
  if (status === 1 || status === "processing") return "Processing";
  if (status === 2 || status === "out_for_delivery") return "Out for Delivery";
  if (status === 3 || status === "delivered") return "Delivered";
  if (status === -1 || status === "rejected") return "Rejected";
  return "Unknown";
}
function getStatusColor(status) {
  if (status === "quoted") return "warning";
  if (status === 3 || status === "delivered") return "success";
  if (status === 2 || status === "out_for_delivery") return "secondary";
  if (status === 1 || status === "processing") return "primary";
  if (status === -1 || status === "rejected") return "error";
  return "default";
}

// --------- ADD REVENUE FILTER HELPERS ---------
function isToday(date) {
  const d = new Date(date);
  const today = new Date();
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}
function isThisWeek(date) {
  const d = new Date(date);
  const now = new Date();
  const firstDay = new Date(now.setDate(now.getDate() - now.getDay())); // Sunday
  firstDay.setHours(0,0,0,0);
  const lastDay = new Date(firstDay);
  lastDay.setDate(firstDay.getDate() + 6);
  lastDay.setHours(23,59,59,999);
  return d >= firstDay && d <= lastDay;
}

export default function PharmacyDashboard() {
  const [token, setToken] = useState(localStorage.getItem("pharmacyToken") || "");
  const [orders, setOrders] = useState([]);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [editOrderId, setEditOrderId] = useState("");
  const [edit, setEdit] = useState({ dosage: "", note: "" });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [pharmacy, setPharmacy] = useState({});
  const [active, setActive] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Medicines management
  const [showMeds, setShowMeds] = useState(false);
  const [medicines, setMedicines] = useState([]);
  const [medForm, setMedForm] = useState({
    name: "",
    brand: "",
    price: "",
    mrp: "",
    stock: "",
    category: "",
    discount: "",
    customCategory: ""
  });
  const [medMsg, setMedMsg] = useState("");
  const [editMedId, setEditMedId] = useState(null);
  const [editMedForm, setEditMedForm] = useState({
    name: "",
    brand: "",
    price: "",
    mrp: "",
    stock: "",
    category: "",
    customCategory: ""
  });
  const [medImage, setMedImage] = useState(null);
  const fileInputRef = useRef();

  // Stats
  const today = todayString();
  const ordersToday = orders.filter(o => (o.createdAt || "").slice(0, 10) === today);
  const completedOrders = orders.filter(o => o.status === 3 || o.status === "delivered");
  const [payouts, setPayouts] = useState([]);
  const [commissionRevenue, setCommissionRevenue] = useState(0);

  // ---- REVENUE FILTER STATE ----
  const [revenueFilter, setRevenueFilter] = useState('total'); // 'today' | 'week' | 'total'

  useEffect(() => {
    if (!token) return;
    const fetchAll = () => {
      axios.get("/api/pharmacy/orders", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setOrders(res.data))
        .catch(() => setOrders([]));
      axios.get("/api/pharmacy/me", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          setActive(res.data.active);
          setPharmacy(res.data);
          // Fetch commission revenue!
          if (res.data?._id) {
            axios.get(`/api/payments?pharmacyId=${res.data._id}&status=paid`, {
              headers: { Authorization: `Bearer ${token}` }
            }).then(resp => {
              setPayouts(resp.data || []);
              const total = (resp.data || []).reduce((sum, p) => sum + (p.pharmacyAmount || 0), 0);
              setCommissionRevenue(total);
            });
          }
        });
    };
    fetchAll(); // fetch once on mount
    const interval = setInterval(() => {
      if (!isEditing) {   // <-- Only fetch if NOT editing!
        fetchAll();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [token, msg, isEditing]);

  // Filtered revenue calculation
  const filteredCommissionRevenue = payouts.reduce((sum, p) => {
    if (revenueFilter === "today" && isToday(p.createdAt)) return sum + (p.pharmacyAmount || 0);
    if (revenueFilter === "week" && isThisWeek(p.createdAt)) return sum + (p.pharmacyAmount || 0);
    if (revenueFilter === "total") return sum + (p.pharmacyAmount || 0);
    return sum;
  }, 0);

  // Fetch medicines (always, so autocomplete works)
  useEffect(() => {
    if (!token) return;
    axios.get("/api/pharmacy/medicines", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => setMedicines(res.data))
      .catch(() => setMedicines([]));
  }, [token, medMsg]);

  // Login handler
  const handleLogin = async () => {
    setLoading(true);
    try {
      const res = await axios.post("/api/pharmacy/login", login);
      setToken(res.data.token);
      localStorage.setItem("pharmacyToken", res.data.token);
      setMsg("Logged in as pharmacy!");
    } catch {
      setMsg("Login failed. Check credentials.");
    }
    setLoading(false);
  };

  // Edit order
  const handleEditOrder = (order) => {
    setEditOrderId(order.id || order._id);
    setEdit({ dosage: order.dosage || "", note: order.note || "" });
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await axios.patch(
        `/api/pharmacy/orders/${editOrderId}`,
        edit,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setEditOrderId("");
      setMsg("Order updated!");
    } catch {
      setMsg("Update failed!");
    }
    setLoading(false);
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("pharmacyToken");
    setToken("");
    setMsg("Logged out.");
  };

  // Add medicine - multipart if image
  const handleAddMedicine = async () => {
    if (!medForm.name || !medForm.price || !medForm.mrp || !medForm.stock ||
      !medForm.category || (medForm.category === "Other" && !medForm.customCategory)) {
      setMedMsg("Fill all medicine fields.");
      return;
    }
    setLoading(true);

    try {
      let data, headers;
      if (medImage) {
        data = new FormData();
        data.append("name", medForm.name);
        data.append("brand", medForm.brand);
        data.append("price", medForm.price);
        data.append("mrp", medForm.mrp);
        data.append("discount", medForm.discount);
        data.append("stock", medForm.stock);
        if (medForm.category === "Other") {
          data.append("category", medForm.customCategory);
        } else {
          data.append("category", medForm.category);
        }
        data.append("image", medImage);
        headers = { Authorization: `Bearer ${token}` };
      } else {
        data = {
          name: medForm.name,
          brand: medForm.brand,
          price: medForm.price,
          mrp: medForm.mrp,
          discount: medForm.discount,
          stock: medForm.stock,
          category: medForm.category === "Other" ? medForm.customCategory : medForm.category
        };
        headers = { Authorization: `Bearer ${token}` };
      }

      await axios.post(
        "/api/pharmacy/medicines",
        data,
        { headers }
      );
      setMedMsg("Medicine added!");
      setMedForm({ name: "", brand: "", price: "", mrp: "", stock: "", category: "", discount: "", customCategory: "" });
      setMedImage(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setMedMsg("Failed to add medicine.");
    }
    setLoading(false);
  };

  // Start editing a medicine
  const handleEditMedicine = (med) => {
    setEditMedId(med.id || med._id);
    setEditMedForm({
      name: med.name,
      brand: med.brand || "",
      price: med.price,
      mrp: med.mrp,
      stock: med.stock,
      category: med.category,
      customCategory: ""
    });
  };

  // Save edit
  const handleSaveMedicine = async () => {
    if (!editMedForm.name || !editMedForm.price || !editMedForm.stock ||
      !editMedForm.category || (editMedForm.category === "Other" && !editMedForm.customCategory)) {
      setMedMsg("Fill all fields to edit.");
      return;
    }
    setLoading(true);
    try {
      await axios.patch(
        `/api/pharmacy/medicines/${editMedId}`,
        {
          name: editMedForm.name,
          brand: editMedForm.brand,
          price: editMedForm.price,
          mrp: editMedForm.mrp,
          stock: editMedForm.stock,
          category: editMedForm.category === "Other"
            ? editMedForm.customCategory
            : editMedForm.category
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setMedMsg("Medicine updated!");
      setEditMedId(null);
    } catch {
      setMedMsg("Failed to update medicine.");
    }
    setLoading(false);
  };

  // Delete medicine
  const handleDeleteMedicine = async (medId) => {
    setLoading(true);
    try {
      await axios.delete(
        `/api/pharmacy/medicines/${medId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMedMsg("Medicine deleted!");
    } catch {
      setMedMsg("Failed to delete medicine.");
    }
    setLoading(false);
  };

  // Handle file select
  const handleImageChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setMedImage(e.target.files[0]);
    }
  };

  const sortedOrders = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      {!token ? (
        <Box sx={{ mt: 7, maxWidth: 380, mx: "auto" }}>
          <Typography variant="h5" mb={2}>Pharmacy Login</Typography>
          <TextField
            label="Contact Email"
            fullWidth sx={{ mb: 2 }}
            value={login.email}
            onChange={e => setLogin({ ...login, email: e.target.value })}
            onFocus={() => setIsEditing(true)}
            onBlur={() => setIsEditing(false)}
          />
          <TextField
            label="Password"
            type="password"
            fullWidth sx={{ mb: 2 }}
            value={login.password}
            onChange={e => setLogin({ ...login, password: e.target.value })}
            onFocus={() => setIsEditing(true)}
            onBlur={() => setIsEditing(false)}
          />
          <Button
            variant="contained"
            fullWidth
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? "Logging in..." : "Login"}
          </Button>
          <Snackbar open={!!msg} autoHideDuration={2400} onClose={() => setMsg("")}>
            <Alert onClose={() => setMsg("")} severity={msg.includes("fail") ? "error" : "success"}>{msg}</Alert>
          </Snackbar>
        </Box>
      ) : (
        <Box sx={{ p: 2, maxWidth: 900, mx: "auto", position: "relative", minHeight: "95vh", pb: 8 }}>
          <Typography variant="h4" sx={{ fontWeight: 900, color: "#13C0A2", mb: 2 }}>
            Pharmacy Dashboard
          </Typography>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
            <Typography variant="h5" fontWeight={800} sx={{ color: "#FFD43B" }}>
              {pharmacy?.name || "Pharmacy"}
            </Typography>
            <Chip label={active ? "Active" : "Inactive"} color={active ? "success" : "default"} />
            <Switch
              checked={active}
              onChange={async (e) => {
                setActive(e.target.checked);
                await axios.patch(
                  "/api/pharmacy/active",
                  { active: e.target.checked },
                  { headers: { Authorization: `Bearer ${token}` } }
                );
              }}
              inputProps={{ 'aria-label': 'Active Status' }}
              color="success"
            />
          </Stack>

          {/* Stats Row */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
            <Card sx={{ flex: 1, bgcolor: "#21272b" }}>
              <CardContent>
                <Typography variant="subtitle2" color="#FFD43B">Orders Today</Typography>
                <Typography variant="h5" fontWeight={800}>{ordersToday.length}</Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1, bgcolor: "#21272b" }}>
              <CardContent>
                <Typography variant="subtitle2" color="#FFD43B">Completed Orders</Typography>
                <Typography variant="h5" fontWeight={800}>{completedOrders.length}</Typography>
              </CardContent>
            </Card>
            {/* --- REVENUE CARD WITH FILTER TOGGLE --- */}
            <Card sx={{ flex: 1, bgcolor: "#21272b" }}>
              <CardContent>
                <Typography variant="subtitle2" color="#FFD43B" sx={{ mb: 1 }}>Revenue</Typography>
                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                  <Chip
                    label="Today"
                    color={revenueFilter === "today" ? "primary" : "default"}
                    onClick={() => setRevenueFilter("today")}
                    size="small"
                    sx={{ cursor: "pointer" }}
                  />
                  <Chip
                    label="This Week"
                    color={revenueFilter === "week" ? "primary" : "default"}
                    onClick={() => setRevenueFilter("week")}
                    size="small"
                    sx={{ cursor: "pointer" }}
                  />
                  <Chip
                    label="Total"
                    color={revenueFilter === "total" ? "primary" : "default"}
                    onClick={() => setRevenueFilter("total")}
                    size="small"
                    sx={{ cursor: "pointer" }}
                  />
                </Stack>
                <Typography variant="h5" fontWeight={800}>{formatRupees(filteredCommissionRevenue)}</Typography>
              </CardContent>
            </Card>
          </Stack>

          <Divider sx={{ mb: 2 }} />

          {/* Orders List */}
          <Typography variant="h6" mb={1}>Orders</Typography>
          {!sortedOrders.length && <Typography>No orders yet.</Typography>}
          <Box sx={{ maxHeight: 450, overflowY: "auto", mb: 2 }}>
            {sortedOrders.map(order => (
              <Card sx={{ mb: 2, bgcolor: "#181d23" }} key={order.id || order._id}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6">Order #{order.id || order._id}</Typography>
                    <Chip
                      label={getStatusLabel(order.status)}
                      color={getStatusColor(order.status)}
                      sx={{
                        cursor: "default",
                        pointerEvents: "none",
                        fontWeight: "bold"
                      }}
                    />
                  </Stack>
                  <Typography sx={{ fontSize: 15 }}>
                    To: {order.address
                      ? [
                        order.address.addressLine,
                        order.address.landmark,
                        order.address.floor
                      ].filter(Boolean).join(", ")
                      : ""}
                  </Typography>
                  <Typography sx={{ fontSize: 15, color: "#FFD43B" }}>
                    Items: {order.items && order.items.map(i => `${i.name} x${i.qty || i.quantity || 1}`).join(", ")}
                  </Typography>
                  <Typography sx={{ fontSize: 14, color: "#DDD" }}>
                    Total: {formatRupees(order.total)}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: "#AAA" }}>
                    Placed: {order.createdAt ? new Date(order.createdAt).toLocaleString() : "-" }
                  </Typography>
                  {/* Dosage / Note Edit */}
                  {editOrderId === (order.id || order._id) ? (
                    <Box sx={{ mt: 1 }}>
                      <TextField
                        label="Dosage"
                        fullWidth
                        value={edit.dosage}
                        onChange={e => setEdit({ ...edit, dosage: e.target.value })}
                        sx={{ mb: 1 }}
                        onFocus={() => setIsEditing(true)}
                        onBlur={() => setIsEditing(false)}
                      />
                      <TextField
                        label="Note"
                        fullWidth
                        value={edit.note}
                        onChange={e => setEdit({ ...edit, note: e.target.value })}
                        sx={{ mb: 1 }}
                        onFocus={() => setIsEditing(true)}
                        onBlur={() => setIsEditing(false)}
                      />
                      <Button size="small" variant="contained" onClick={handleSave} sx={{ mr: 1 }} disabled={loading}>Save</Button>
                      <Button size="small" onClick={() => setEditOrderId("")} disabled={loading}>Cancel</Button>
                    </Box>
                  ) : (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2">Dosage: {order.dosage || "-"}</Typography>
                      <Typography variant="body2">Note: {order.note || "-"}</Typography>
                      <Button size="small" sx={{ mt: 1 }} onClick={() => handleEditOrder(order)} disabled={loading}>
                        Edit Dosage/Note
                      </Button>
                    </Box>
                  )}
                  {/* Status Buttons */}
                  <Box sx={{ mt: 2 }}>
                    {/* Accept/Reject if status is placed/pending/0 */}
                    {(order.status === "placed" || order.status === 0 || order.status === "pending") && (
                      <Stack direction="row" spacing={2}>
                        <Button
                          size="small"
                          color="primary"
                          variant="outlined"
                          onClick={async () => {
                            setLoading(true);
                            try {
                              await axios.patch(
                                `/api/pharmacy/orders/${order.id || order._id}`,
                                { status: "processing", pharmacyAccepted: true },
                                { headers: { Authorization: `Bearer ${token}` } }
                              );
                              setMsg("Order accepted!");
                            } catch {
                              setMsg("Failed to accept order!");
                            }
                            setLoading(false);
                          }}
                          disabled={loading}
                        >
                          Accept Order
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          onClick={async () => {
                            setLoading(true);
                            try {
                              await axios.patch(
                                `/api/pharmacy/orders/${order.id || order._id}`,
                                { status: "rejected", pharmacyAccepted: false },
                                { headers: { Authorization: `Bearer ${token}` } }
                              );
                              setMsg("Order rejected!");
                            } catch {
                              setMsg("Failed to reject order!");
                            }
                            setLoading(false);
                          }}
                          disabled={loading}
                        >
                          Reject Order
                        </Button>
                      </Stack>
                    )}

                    {/* Processing - show as DISABLED CHIP (not clickable, no onClick at all) */}
                    {(order.status === 1 || order.status === "processing") && (
                      <Chip
                        label="Processing"
                        color="primary"
                        sx={{ mt: 1, fontWeight: "bold", pointerEvents: "none", cursor: "default" }}
                      />
                    )}

                    {/* Delivered - also just a Chip */}
                    {(order.status === 3 || order.status === "delivered") && (
                      <Chip
                        label="Delivered"
                        color="success"
                        sx={{ mt: 1, fontWeight: "bold", pointerEvents: "none", cursor: "default" }}
                      />
                    )}
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
          {/* --- Prescription Orders Section --- */}
          <PrescriptionOrdersTab token={token} medicines={medicines} />

          {/* Medicines Management */}
          <Divider sx={{ my: 3 }} />
          <Button
            variant="contained"
            onClick={() => setShowMeds(!showMeds)}
            sx={{ mb: 2 }}
          >
            {showMeds ? "Hide Medicines" : "Manage Medicines"}
          </Button>
          {showMeds && (
            <Box sx={{ mt: 1, mb: 10 }}>
              <Typography variant="h6" mb={1}>Medicines</Typography>
              {medicines.map(med => (
                <Card key={med.id || med._id} sx={{ mb: 1, bgcolor: "#21272b" }}>
                  <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <Typography sx={{ flex: 1 }}>
                      <b>{med.name}</b>
                      {med.brand && (
                        <span style={{ color: "#13C0A2", fontWeight: 400 }}> ({med.brand})</span>
                      )}
                      {" — "}
                      <span style={{color:"#FFD43B"}}>{med.category || "Miscellaneous"}</span>
                      <br />
                      <b>Selling Price:</b> ₹{med.price} | <b>MRP:</b> ₹{med.mrp} | <b>Stock:</b> {med.stock}
                    </Typography>
                    <IconButton
                      color="primary"
                      size="small"
                      onClick={() => handleEditMedicine(med)}
                      disabled={loading}
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      color="error"
                      size="small"
                      onClick={() => handleDeleteMedicine(med.id || med._id)}
                      disabled={loading}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </CardContent>
                </Card>
              ))}
              {/* EDIT MEDICINE DIALOG */}
              <Dialog open={!!editMedId} onClose={() => setEditMedId(null)} fullWidth maxWidth="xs">
                <DialogTitle>Edit Medicine</DialogTitle>
                <DialogContent>
                  <Stack spacing={2} mt={1}>
                    <TextField
                      label="Name"
                      fullWidth
                      value={editMedForm.name}
                      onChange={e => setEditMedForm(f => ({ ...f, name: e.target.value }))}
                      onFocus={() => setIsEditing(true)}
                      onBlur={() => setIsEditing(false)}
                    />
                    <TextField
                      label="Brand"
                      fullWidth
                      value={editMedForm.brand}
                      onChange={e => setEditMedForm(f => ({ ...f, brand: e.target.value }))}
                      onFocus={() => setIsEditing(true)}
                      onBlur={() => setIsEditing(false)}
                    />
                    <TextField
                      label="Selling Price"
                      type="number"
                      fullWidth
                      value={editMedForm.price}
                      onChange={e => setEditMedForm(f => ({ ...f, price: e.target.value }))}
                      onFocus={() => setIsEditing(true)}
                      onBlur={() => setIsEditing(false)}
                    />
                    <TextField
                      label="MRP"
                      type="number"
                      fullWidth
                      value={editMedForm.mrp}
                      onChange={e => setEditMedForm(f => ({ ...f, mrp: e.target.value }))}
                      onFocus={() => setIsEditing(true)}
                      onBlur={() => setIsEditing(false)}
                    />
                    <TextField
                      label="Stock"
                      type="number"
                      fullWidth
                      value={editMedForm.stock}
                      onChange={e => setEditMedForm(f => ({ ...f, stock: e.target.value }))}
                      onFocus={() => setIsEditing(true)}
                      onBlur={() => setIsEditing(false)}
                    />
                    <FormControl fullWidth>
                      <InputLabel>Category</InputLabel>
                      <Select
                        value={editMedForm.category || ""}
                        label="Category"
                        onChange={e => setEditMedForm(f => ({ ...f, category: e.target.value }))}
                      >
                        {MED_CATEGORIES.map(opt => (
                          <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {editMedForm.category === "Other" && (
                      <TextField
                        label="Custom Category"
                        fullWidth
                        value={editMedForm.customCategory}
                        onChange={e => setEditMedForm(f => ({ ...f, customCategory: e.target.value }))}
                        onFocus={() => setIsEditing(true)}
                        onBlur={() => setIsEditing(false)}
                      />
                    )}
                  </Stack>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setEditMedId(null)} color="error">Cancel</Button>
                  <Button variant="contained" onClick={handleSaveMedicine} color="success" disabled={loading}>
                    Save
                  </Button>
                </DialogActions>
              </Dialog>

              {/* ADD MEDICINE SECTION */}
              <Box sx={{
                mt: 2, pb: 8, position: "relative",
                bgcolor: "#181d23", borderRadius: 2, p: 2, boxShadow: 1
              }}>
                <Stack spacing={2}>
                  <TextField
                    label="Name"
                    value={medForm.name}
                    onChange={e => setMedForm(f => ({ ...f, name: e.target.value }))}
                    onFocus={() => setIsEditing(true)}
                    onBlur={() => setIsEditing(false)}
                  />
                  <TextField
                    label="Brand"
                    value={medForm.brand}
                    onChange={e => setMedForm(f => ({ ...f, brand: e.target.value }))}
                    onFocus={() => setIsEditing(true)}
                    onBlur={() => setIsEditing(false)}
                  />
                  <TextField
                    label="Selling Price"
                    type="number"
                    value={medForm.price}
                    onChange={e => setMedForm(f => ({ ...f, price: e.target.value }))}
                    onFocus={() => setIsEditing(true)}
                    onBlur={() => setIsEditing(false)}
                  />
                  <TextField
                    label="MRP"
                    type="number"
                    value={medForm.mrp}
                    onChange={e => setMedForm(f => ({ ...f, mrp: e.target.value }))}
                    onFocus={() => setIsEditing(true)}
                    onBlur={() => setIsEditing(false)}
                  />
                  <TextField
                    label="Discount (%)"
                    type="number"
                    value={medForm.discount}
                    onChange={(e) => setMedForm(f => ({ ...f, discount: e.target.value }))}
                    inputProps={{ min: 0, max: 90 }}
                    onFocus={() => setIsEditing(true)}
                    onBlur={() => setIsEditing(false)}
                  />
                  <TextField
                    label="Stock"
                    type="number"
                    value={medForm.stock}
                    onChange={e => setMedForm(f => ({ ...f, stock: e.target.value }))}
                    onFocus={() => setIsEditing(true)}
                    onBlur={() => setIsEditing(false)}
                  />
                  <FormControl fullWidth>
                    <InputLabel>Category</InputLabel>
                    <Select
                      value={medForm.category || ""}
                      label="Category"
                      onChange={e => setMedForm(f => ({ ...f, category: e.target.value }))}
                      MenuProps={{
                        PaperProps: {
                          style: {
                            zIndex: 2000,
                          }
                        }
                      }}
                    >
                      {MED_CATEGORIES.map(opt => (
                        <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {medForm.category === "Other" && (
                    <TextField
                      label="Custom Category"
                      value={medForm.customCategory}
                      onChange={e => setMedForm(f => ({ ...f, customCategory: e.target.value }))}
                      onFocus={() => setIsEditing(true)}
                      onBlur={() => setIsEditing(false)}
                    />
                  )}
                  <Stack direction="row" spacing={2} alignItems="center">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      ref={fileInputRef}
                      onChange={handleImageChange}
                    />
                    <Button
                      startIcon={<PhotoCamera />}
                      variant={medImage ? "contained" : "outlined"}
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                      color={medImage ? "success" : "primary"}
                      sx={{ minWidth: 120 }}
                    >
                      {medImage ? "Image Ready" : "Upload Image"}
                    </Button>
                  </Stack>
                  <Button
                    variant="contained"
                    onClick={handleAddMedicine}
                    disabled={loading}
                    sx={{
                      width: "100%",
                      mt: 1,
                      position: "sticky",
                      bottom: 56,
                      zIndex: 2
                    }}
                  >
                    Add Medicine
                  </Button>
                  <Typography color={ medMsg.toLowerCase().includes("fail") || medMsg.toLowerCase().includes("error") ? "error" : "success.main"} variant="body2">
                    {medMsg}
                  </Typography>
                </Stack>
              </Box>
            </Box>
          )}
          <PharmacyPayoutsSection token={token} pharmacyId={pharmacy?._id} />
          {/* LOGOUT BUTTON */}
          <Box sx={{
            width: "100%",
            position: "relative",
            pb: 7,
            textAlign: "center"
          }}>
            <Button
              variant="outlined"
              color="error"
              size="large"
              onClick={handleLogout}
              sx={{ width: 200, mx: "auto", mb: 2 }}
            >
              Logout
            </Button>
          </Box>

          <Snackbar open={!!msg} autoHideDuration={2500} onClose={() => setMsg("")}>
            <Alert onClose={() => setMsg("")} severity={msg.includes("fail") ? "error" : "success"}>{msg}</Alert>
          </Snackbar>
          <Snackbar open={!!medMsg} autoHideDuration={2200} onClose={() => setMedMsg("")}>
            <Alert onClose={() => setMedMsg("")} severity={medMsg.includes("fail") ? "error" : "success"}>{medMsg}</Alert>
          </Snackbar>
        </Box>
      )}
    </ThemeProvider>
  );
}
