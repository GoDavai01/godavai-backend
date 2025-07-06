// src/components/AdminDashboard.js
import React, { useState, useEffect } from "react";
import {
  Box, Typography, Button, Card, CardContent, TextField, Stack, Snackbar, Alert, Chip,
  ThemeProvider, createTheme, CssBaseline, Divider, MenuItem, Select, Dialog, DialogTitle,
  DialogContent, DialogActions, IconButton, InputLabel, FormControl, Tabs, Tab
} from "@mui/material";
import { Visibility, Delete, LocalPharmacy, NotificationsNone, DirectionsRun } from "@mui/icons-material";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import axios from "axios";


function renderAssignmentHistory(history = []) {
  if (!history.length) return null;
  return (
    <>
      <Typography sx={{ mt: 1 }}><b>Delivery Timeline:</b></Typography>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {history.map((h, i) => (
          <li key={i}>
            {h.status.charAt(0).toUpperCase() + h.status.slice(1)}:
            &nbsp;{h.at ? new Date(h.at).toLocaleString() : "—"}
          </li>
        ))}
      </ul>
    </>
  );
}

// --- SUPPORT CHATS ADMIN PANEL COMPONENT ---
function SupportChatsAdminPanel() {
  const [chats, setChats] = useState([]);
  const [filter, setFilter] = useState("pending_admin"); // or "all", "closed"
  const [replyMsg, setReplyMsg] = useState("");
  const [chat, setChat] = useState(null);

  useEffect(() => {
    const fetchChats = () =>
      axios.get(`/api/support-chat/all?status=${filter !== "all" ? filter : ""}`)
        .then(res => setChats(res.data));
    fetchChats();
    const interval = setInterval(fetchChats, 3000);
    return () => clearInterval(interval);
  }, [filter]);

  const handleReply = async () => {
    await axios.post("/api/support-chat/admin-reply", { chatId: chat._id, text: replyMsg });
    setReplyMsg("");
    setChat(null);
  };

  const handleCloseChat = async (chatId) => {
    await axios.post("/api/support-chat/close", { chatId });
    setChat(null);
  };

  return (
    <Box sx={{ my: 3 }}>
      <Typography variant="h6" sx={{ color: "#FFD43B", mb: 2 }}>Support Chats</Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <Button variant={filter === "pending_admin" ? "contained" : "outlined"} onClick={() => setFilter("pending_admin")}>Pending</Button>
        <Button variant={filter === "closed" ? "contained" : "outlined"} onClick={() => setFilter("closed")}>Closed</Button>
        <Button variant={filter === "all" ? "contained" : "outlined"} onClick={() => setFilter("all")}>All</Button>
      </Stack>
      <Stack spacing={2}>
        {chats.length === 0 && <Typography color="success.main">No chats!</Typography>}
        {chats.map((c) => (
          <Box key={c._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2, mb: 2 }}>
            <Typography>From: {c.userId?.name} ({c.userId?.email || c.userId?.mobile})</Typography>
            <Typography>Order: {c.orderId?.id || c.orderId?._id}</Typography>
            <Typography>Status: <b>{c.status}</b></Typography>
            <Button variant="outlined" color="success" size="small" onClick={() => setChat(c)}>View & Reply</Button>
          </Box>
        ))}
      </Stack>
      <Dialog open={!!chat} onClose={() => setChat(null)}>
        <DialogTitle>
          <SupportAgentIcon sx={{ mb: "-5px", mr: 1 }} />
          Support Chat with {chat?.userId?.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mb: 2, maxHeight: 250, overflowY: 'auto' }}>
            {chat?.messages.map((msg, i) =>
              <Typography key={i} sx={{ color: msg.sender === "user" ? "#FFD43B" : (msg.sender === "admin" ? "#13C0A2" : "#fff") }}>
                <b>{msg.sender}:</b> {msg.text}
              </Typography>
            )}
          </Stack>
          <TextField
            label="Reply Message"
            fullWidth
            value={replyMsg}
            onChange={e => setReplyMsg(e.target.value)}
            multiline
            rows={2}
            sx={{ mb: 2 }}
          />
          <Stack direction="row" spacing={2}>
            <Button onClick={handleReply} variant="contained" disabled={!replyMsg.trim()}>Send Reply</Button>
            {chat?.status !== "closed" &&
              <Button onClick={() => handleCloseChat(chat._id)} variant="outlined" color="error">Close Chat</Button>
            }
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChat(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function DeliveryPartnerChatsAdminPanel() {
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);

  useEffect(() => {
    const fetchChats = () => axios.get("/api/admin/delivery-chats")
      .then(res => setChats(res.data));
    fetchChats();
    const interval = setInterval(fetchChats, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box sx={{ my: 4 }}>
      <Typography variant="h6" sx={{ color: "#FFD43B", mb: 2 }}>Delivery Partner Chats</Typography>
      <Stack spacing={2}>
        {chats.length === 0 && <Typography color="success.main">No chats yet!</Typography>}
        {chats.map((c) => (
          <Box key={c.orderId} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2, mb: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography><b>Order:</b> #{c.orderId?.slice(-5)}</Typography>
                <Typography><b>Customer:</b> {c.customer}</Typography>
                <Typography><b>Partner:</b> {c.deliveryPartner}</Typography>
                <Typography variant="body2" sx={{ color: "#FFD43B" }}>
                  {new Date(c.orderDate).toLocaleString()}
                </Typography>
              </Box>
              <Button variant="outlined" color="primary" size="small" onClick={() => setSelectedChat(c)}>View Chat</Button>
            </Stack>
          </Box>
        ))}
      </Stack>
      <Dialog open={!!selectedChat} onClose={() => setSelectedChat(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Delivery Partner Chat</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mb: 2, maxHeight: 320, overflowY: "auto" }}>
            {selectedChat?.messages.map((msg, i) => (
              <Typography
                key={i}
                sx={{
                  color: msg.senderType === "user" ? "#FFD43B" :
                    msg.senderType === "delivery" ? "#13C0A2" : "#fff"
                }}
              >
                <b>{msg.senderType === "user" ? "Customer" : "Delivery Partner"}:</b> {msg.message}
                <span style={{ color: "#aaa", marginLeft: 8, fontSize: 12 }}>
                  {new Date(msg.createdAt).toLocaleString()}
                </span>
              </Typography>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedChat(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// --- DARK THEME ---
const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#13C0A2" },
    secondary: { main: "#FFD43B" },
    error: { main: "#e74c3c" },
  },
});

// ------------------------ PAYMENTS TAB PANEL ---------------------------
function PaymentsPayoutsPanel({ token }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("all");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchPayments();
    // eslint-disable-next-line
  }, [token]);

  const fetchPayments = async () => {
    try {
      const res = await fetch("/api/payments", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setPayments(data);
    } finally {
      setLoading(false);
    }
  };

  // Helper to safely format all numbers
  const fmt = (v) =>
    (typeof v === "number" ? v : parseFloat(v || "0")).toFixed(2);

  // Payout sum for summary chips
  const payoutSum = (key) =>
    payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + (Number(p[key]) || 0), 0);

  // Show amount in alert if admin clicks chip
  const showFullAmount = (label, amount) => {
    alert(`${label}: ₹${amount}`);
  };

  // Filter for current tab
  const filteredPayments = payments.filter((p) =>
    tab === "all"
      ? true
      : tab === "pharmacy"
      ? !!p.pharmacyId
      : tab === "delivery"
      ? !!p.deliveryPartnerId
      : tab === "admin"
      ? !!p.adminAmount
      : true
  );

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2, color: "#FFD43B" }}>
        Payments & Payouts
      </Typography>
      {/* Responsive summary chips row */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          mb: 2,
          overflowX: "auto",
          whiteSpace: "nowrap",
          width: "100%",
          pb: 1,
          "& > *": { minWidth: 145, fontSize: { xs: 13, sm: 15 } },
        }}
      >
        <Chip
          label={`Total Collected: ₹${fmt(payoutSum("totalAmount"))}`}
          color="primary"
          onClick={() => showFullAmount("Total Collected", fmt(payoutSum("totalAmount")))}
          sx={{ cursor: "pointer", fontWeight: 700 }}
        />
        <Chip
          label={`To Pharmacy: ₹${fmt(payoutSum("pharmacyAmount"))}`}
          color="success"
          onClick={() => showFullAmount("To Pharmacy", fmt(payoutSum("pharmacyAmount")))}
          sx={{ cursor: "pointer", fontWeight: 700 }}
        />
        <Chip
          label={`To Delivery: ₹${fmt(payoutSum("deliveryAmount"))}`}
          color="secondary"
          onClick={() => showFullAmount("To Delivery", fmt(payoutSum("deliveryAmount")))}
          sx={{ cursor: "pointer", fontWeight: 700 }}
        />
        <Chip
          label={`To Admin: ₹${fmt(payoutSum("adminAmount"))}`}
          color="warning"
          onClick={() => showFullAmount("To Admin", fmt(payoutSum("adminAmount")))}
          sx={{ cursor: "pointer", fontWeight: 700 }}
        />
      </Stack>

      {/* Tab buttons */}
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: "wrap" }}>
        <Button
          variant={tab === "all" ? "contained" : "outlined"}
          onClick={() => setTab("all")}
        >
          All
        </Button>
        <Button
          variant={tab === "pharmacy" ? "contained" : "outlined"}
          onClick={() => setTab("pharmacy")}
        >
          Pharmacy Payouts
        </Button>
        <Button
          variant={tab === "delivery" ? "contained" : "outlined"}
          onClick={() => setTab("delivery")}
        >
          Delivery Payouts
        </Button>
        <Button
          variant={tab === "admin" ? "contained" : "outlined"}
          onClick={() => setTab("admin")}
        >
          Admin Commission
        </Button>
      </Stack>

      {loading && (
        <Typography sx={{ mb: 2, color: "#FFD43B" }}>Loading...</Typography>
      )}

      <Stack spacing={2}>
        {filteredPayments.map((pay) => (
          <Card
            key={pay._id}
            sx={{
              p: 2,
              bgcolor: "#212325",
              borderRadius: 2,
              mb: 1,
              boxShadow: "0 2px 8px #1115",
            }}
          >
            <Typography fontWeight={700} sx={{ fontSize: 17, color: "#FFD43B" }}>
              Order: #{pay.orderId?._id?.slice(-5) || "NA"}
            </Typography>
            <Typography variant="body2">
              <b>User:</b> {pay.userId?.name || "NA"}
            </Typography>
            <Typography variant="body2">
              <b>Pharmacy:</b> {pay.pharmacyId?.name || "NA"}
            </Typography>
            <Typography variant="body2">
              <b>Delivery Partner:</b> {pay.deliveryPartnerId?.name || "NA"}
            </Typography>
            <Typography sx={{ color: "#13C0A2", fontSize: 15 }}>
              <b>Total Paid:</b> ₹{fmt(pay.totalAmount)}{" "}
              — <b>Pharmacy:</b> ₹{fmt(pay.pharmacyAmount)}{" "}
              — <b>Delivery:</b> ₹{fmt(pay.deliveryAmount)}{" "}
              — <b>Admin:</b> ₹{fmt(pay.adminAmount)}
            </Typography>
            <Typography>Status: <b>{pay.status}</b></Typography>
            <Typography variant="body2" color="text.secondary">
              {pay.createdAt
                ? new Date(pay.createdAt).toLocaleString()
                : ""}
            </Typography>
            {pay.coupon && (
              <Typography variant="body2" color="primary">
                Coupon Used: {pay.coupon.code} (Discount: ₹{fmt(pay.coupon.discount)})
              </Typography>
            )}
            {pay.paymentGatewayDetails && (
              <Typography variant="body2" sx={{ color: "#FFD43B" }}>
                Razorpay: {pay.paymentGatewayDetails.razorpay_payment_id || ""}
              </Typography>
            )}
          </Card>
        ))}
        {filteredPayments.length === 0 && !loading && (
          <Typography>No payments found.</Typography>
        )}
      </Stack>
    </Box>
  );
}

export default function AdminDashboard() {
  const [token, setToken] = useState(localStorage.getItem("adminToken") || "");
  const [login, setLogin] = useState({ email: "", password: "" });
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState({ orders: 0, users: 0, pharmacies: 0 });
  const [offers, setOffers] = useState([]);
  const [offer, setOffer] = useState({ title: "", description: "", code: "", image: "" });
  const [orderList, setOrderList] = useState([]);
  const [userList, setUserList] = useState([]);
  const [pharmacyList, setPharmacyList] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [pendingPharmacies, setPendingPharmacies] = useState([]);
  const [pendingDeliveryPartners, setPendingDeliveryPartners] = useState([]);
  const [deliveryPartners, setDeliveryPartners] = useState([]);
  const [deliveryDetailOpen, setDeliveryDetailOpen] = useState(false);
  const [deliveryDetail, setDeliveryDetail] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, partner: null });
  const [cityList, setCityList] = useState([]);
  const [areaList, setAreaList] = useState([]);
  const [city, setCity] = useState("All");
  const [area, setArea] = useState("All");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationData, setNotificationData] = useState({ title: "", message: "", to: "all" });
  const [medicineModal, setMedicineModal] = useState({ open: false, list: [], pharmacy: null });
  const [showStats, setShowStats] = useState({ open: false, type: "" });
  const [activeTab, setActiveTab] = useState(0);
  // --- ONLY CHANGE: Expanded Order Dialog ---
  const [expandedOrder, setExpandedOrder] = useState(null);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      axios.get("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setStats(res.data)).catch(() => { });
      axios.get("/api/admin/pending-pharmacies", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setPendingPharmacies(res.data)).catch(() => { });
      axios.get("/api/offers").then((res) => setOffers(res.data)).catch(() => { });
      axios.get("/api/orders", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setOrderList(res.data)).catch(() => { });
      axios.get("/api/users", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setUserList(res.data)).catch(() => { });
      axios.get("/api/admin/pharmacies").then(res => setPharmacyList(res.data)).catch(() => { });
      axios.get("/api/pharmacies?all=1").then((res) => {
        setPharmacies(res.data);
        const cities = Array.from(new Set(res.data.map(p => p.city).filter(Boolean)));
        setCityList(["All", ...cities]);
        const filteredPharms = city === "All" ? res.data : res.data.filter(p => p.city === city);
        const areas = Array.from(new Set(filteredPharms.map(p => p.area).filter(Boolean)));
        setAreaList(["All", ...areas]);
      }).catch(() => { });
      axios.get("/api/delivery/partners", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setDeliveryPartners(res.data)).catch(() => { });
      axios.get("/api/delivery/pending", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setPendingDeliveryPartners(res.data)).catch(() => { });
    }, 3000);
    return () => clearInterval(interval);
  }, [token, city]);

  const handleLogin = async () => {
    try {
      const res = await axios.post("/api/admin/login", login);
      setToken(res.data.token);
      localStorage.setItem("adminToken", res.data.token);
      setMsg("Logged in as admin!");
    } catch {
      setMsg("Admin login failed.");
    }
  };

  const handleLogout = () => {
    setToken("");
    localStorage.removeItem("adminToken");
    setMsg("Logged out.");
  };

  const approveDeliveryPartner = async (id) => {
    try {
      await axios.post("/api/delivery/approve", { id }, { headers: { Authorization: `Bearer ${token}` } });
      setMsg("Delivery Partner approved!");
      setPendingDeliveryPartners(prev => prev.filter(p => p._id !== id));
    } catch {
      setMsg("Failed to approve delivery partner");
    }
  };

  const handleDeleteDeliveryPartner = async (id) => {
    try {
      await axios.delete(`/api/delivery/delete/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setMsg("Delivery Partner deleted!");
      setDeliveryPartners(prev => prev.filter(p => p._id !== id));
      setDeleteDialog({ open: false, partner: null });
    } catch {
      setMsg("Failed to delete delivery partner");
    }
  };

  const openDeliveryDetail = async (partner) => {
    try {
      const { data } = await axios.get(`/api/delivery/partner/${partner._id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDeliveryDetail(data);
      setDeliveryDetailOpen(true);
    } catch {
      setMsg("Failed to load delivery partner info");
    }
  };

  const approvePharmacy = async (id) => {
    try {
      await axios.post("/api/admin/approve-pharmacy", { pharmacyId: id }, { headers: { Authorization: `Bearer ${token}` } });
      setMsg("Pharmacy approved!");
      setPendingPharmacies((prev) => prev.filter((p) => p._id !== id));
    } catch {
      setMsg("Failed to approve pharmacy");
    }
  };

  const deletePharmacy = async (id) => {
    if (!window.confirm("Are you sure you want to remove this pharmacy?")) return;
    try {
      await axios.delete(`/api/pharmacy/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setMsg("Pharmacy deleted!");
      setPharmacies(pharmacies.filter((p) => p._id !== id));
    } catch {
      setMsg("Failed to delete pharmacy");
    }
  };

  const handleViewMedicines = async (pharmacyId, pharmacy) => {
    try {
      const res = await axios.get(`/api/medicines?pharmacyId=${pharmacyId}`);
      setMedicineModal({ open: true, list: res.data, pharmacy });
    } catch {
      setMsg("Failed to load medicines");
    }
  };

  const handleDeleteMedicine = async (medId) => {
    if (!window.confirm("Delete this medicine?")) return;
    try {
      await axios.delete(`/api/medicines/${medId}`, { headers: { Authorization: `Bearer ${token}` } });
      setMedicineModal((m) => ({ ...m, list: m.list.filter(x => x._id !== medId) }));
      setMsg("Medicine deleted");
    } catch {
      setMsg("Failed to delete medicine");
    }
  };

  const handleSendNotification = async () => {
    setNotificationOpen(false);
    setNotificationData({ title: "", message: "", to: "all" });
    setMsg(`Notification sent to ${notificationData.to} (demo)`);
  };

  const filteredPharmacies = pharmacies.filter(p =>
    (city === "All" || p.city === city) && (area === "All" || p.area === area)
  );
  const filteredActivePharmacies = filteredPharmacies.filter(p => p.active);
  const activeDeliveryPartners = deliveryPartners.filter(p => p.active);

  if (!token) {
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Box sx={{ mt: 7, maxWidth: 400, mx: "auto" }}>
          <Typography variant="h5" mb={2}>Admin Login</Typography>
          <TextField label="Email" fullWidth sx={{ mb: 2 }} value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} />
          <TextField label="Password" type="password" fullWidth sx={{ mb: 2 }} value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} />
          <Button variant="contained" fullWidth onClick={handleLogin}>Login</Button>
          <Snackbar open={!!msg} autoHideDuration={2400} onClose={() => setMsg("")}><Alert onClose={() => setMsg("")} severity={msg.includes("fail") ? "error" : "success"}>{msg}</Alert></Snackbar>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ p: 2, maxWidth: 900, mx: "auto" }}>
        <Typography variant="h4" sx={{ fontWeight: 900, color: "#FFD43B", mb: 3 }}>Admin Dashboard</Typography>
        {/* TOP BAR */}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center" flexWrap="wrap" sx={{ mb: 2, gap: 2, rowGap: 2, width: "100%", justifyContent: { xs: "flex-start", sm: "flex-start", md: "space-between" } }}>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Chip label={`Total Orders: ${stats.orders}`} color="primary" clickable onClick={() => setShowStats({ open: true, type: "orders" })} sx={{ mb: { xs: 1, sm: 0 } }} />
            <Chip label={`Users: ${stats.users}`} color="secondary" clickable onClick={() => setShowStats({ open: true, type: "users" })} sx={{ mb: { xs: 1, sm: 0 } }} />
            <Chip label={`Pharmacies: ${stats.pharmacies}`} color="success" clickable onClick={() => setShowStats({ open: true, type: "pharmacies" })} sx={{ mb: { xs: 1, sm: 0 } }} />
          </Stack>
          <Stack direction="row" spacing={2}>
            <Button variant="outlined" color="primary" size="small" sx={{ fontWeight: 700 }} startIcon={<NotificationsNone />} onClick={() => setNotificationOpen(true)}>Send Notification</Button>
            <Button variant="outlined" color="error" size="small" sx={{ fontWeight: 700 }} onClick={handleLogout}>Logout</Button>
          </Stack>
        </Stack>
        {/* FILTERS */}
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <FormControl sx={{ minWidth: 140 }}>
            <InputLabel>City</InputLabel>
            <Select label="City" value={city} size="small" onChange={e => { setCity(e.target.value); setArea("All"); }}>
              {cityList.map(cty => (<MenuItem key={cty} value={cty}>{cty}</MenuItem>))}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 140 }}>
            <InputLabel>Area</InputLabel>
            <Select label="Area" value={area} size="small" onChange={e => setArea(e.target.value)}>
              {areaList.map(ar => (<MenuItem key={ar} value={ar}>{ar}</MenuItem>))}
            </Select>
          </FormControl>
        </Stack>

        {/* === TABS FOR FAST SWITCHING === */}
        <Box sx={{ mb: 3, bgcolor: "#16181a", borderRadius: 2 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto">
            <Tab label={`All Orders (${orderList.length})`} />
            <Tab label={`All Users (${userList.length})`} />
            <Tab label={`All Pharmacies (${filteredPharmacies.length})`} />
            <Tab label={`Active Pharmacies (${filteredActivePharmacies.length})`} />
            <Tab label={`Delivery Partners (${deliveryPartners.length})`} />
            <Tab label={`Active Delivery Partners (${activeDeliveryPartners.length})`} />
            <Tab label="Payments & Payouts" />
          </Tabs>
        </Box>

        {/* === TAB PANELS === */}
        <Box sx={{ mb: 3 }}>
  {activeTab === 0 && (
    <Box>
      <Typography variant="h6" mb={1}>All Orders</Typography>
      {orderList.length === 0 ? (
        <Typography sx={{ color: "#aaa" }}>No orders found.</Typography>
      ) : (
        <Stack spacing={2}>
          {orderList.map(order => (
            <Card key={order._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2 }}>
              <Typography fontWeight={700}>Order #{order._id?.slice(-5)}</Typography>
              <Typography variant="body2" sx={{ color: "#aaf" }}>
                User: {order.address?.name} | Pharmacy: {order.pharmacy?.name}
              </Typography>
              <Typography variant="body2" sx={{ color: "#FFD43B" }}>
                {order.items?.map(i => `${i.name} x${i.qty || i.quantity || 1}`).join(", ")}
              </Typography>
              <Typography variant="body2" sx={{ color: "#aaa" }}>
                Total: ₹{order.total} | Status: {order.status}
              </Typography>
              <Button
                variant="outlined"
                sx={{ mt: 1 }}
                color="primary"
                size="small"
                onClick={() => setExpandedOrder(order)}
              >
                View Details
              </Button>
            </Card>
          ))}
        </Stack>
      )}

      {/* Expanded Order Details Dialog */}
      <Dialog open={!!expandedOrder} onClose={() => setExpandedOrder(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Order #{expandedOrder?._id?.slice(-5)}</DialogTitle>
        <DialogContent dividers>
          {expandedOrder ? (
            <Stack spacing={1}>
              {/* USER & ADDRESS */}
              <Typography>
                <b>User:</b> {expandedOrder.userId?.name || expandedOrder.address?.name}
                {" "}
                (
                {expandedOrder.userId?.email ||
                  expandedOrder.userId?.mobile ||
                  expandedOrder.address?.mobile ||
                  "NA"}
                )
              </Typography>
              <Typography>
                <b>Address:</b> {expandedOrder.address?.addressLine}, {expandedOrder.address?.city}
                {expandedOrder.address?.pincode && ` - ${expandedOrder.address?.pincode}`}
              </Typography>

              {/* PHARMACY */}
              <Typography>
                <b>Pharmacy:</b> {expandedOrder.pharmacy?.name}
                {expandedOrder.pharmacy?.city && `, ${expandedOrder.pharmacy.city}`}
                {expandedOrder.pharmacy?.area && `, ${expandedOrder.pharmacy.area}`}
                {expandedOrder.pharmacy?.contact && <> ({expandedOrder.pharmacy.contact})</>}
              </Typography>

              {/* DELIVERY PARTNER */}
              <Typography>
                <b>Delivery Partner:</b> {expandedOrder.deliveryPartner?.name || "Not assigned"}
                {expandedOrder.deliveryPartner?.mobile && <> ({expandedOrder.deliveryPartner.mobile})</>}
              </Typography>

              {/* ORDER ITEMS */}
              <Typography><b>Items:</b></Typography>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {expandedOrder.items?.map(i =>
                  <li key={i._id || i.name}>
                    {i.name} x{i.qty || i.quantity || 1}
                    {i.price ? ` — ₹${i.price}` : ""}
                  </li>
                )}
              </ul>

              {/* QUOTE DETAILS */}
              {expandedOrder.quote?.itemsAvailable?.length > 0 && (
                <Typography sx={{ color: "#13C0A2" }}>
                  <b>Available:</b> {expandedOrder.quote.itemsAvailable.map(i => i.name).join(", ")}
                </Typography>
              )}
              {expandedOrder.quote?.itemsUnavailable?.length > 0 && (
                <Typography sx={{ color: "#e74c3c" }}>
                  <b>Unavailable:</b> {expandedOrder.quote.itemsUnavailable.map(i => i.name).join(", ")}
                </Typography>
              )}

              {/* QUOTE AMOUNT & TIME */}
              <Typography>
                <b>Quote:</b> ₹{expandedOrder.quote?.price || "NA"}
                {expandedOrder.quote?.quotedAt && <> (at {new Date(expandedOrder.quote.quotedAt).toLocaleString()})</>}
              </Typography>

              {/* ORDER AMOUNT & PAYMENT STATUS */}
              <Typography><b>Total Amount:</b> ₹{expandedOrder.total}</Typography>
              {expandedOrder.paymentStatus && (
                <Typography><b>Payment Status:</b> {expandedOrder.paymentStatus}</Typography>
              )}

             {/* STATUS TIMELINE */}
<Typography><b>Status Timeline:</b></Typography>
<ul style={{ margin: 0, paddingLeft: 18 }}>
  <li>Placed: {expandedOrder.createdAt ? new Date(expandedOrder.createdAt).toLocaleString() : "—"}</li>
  <li>Pharmacy Quoted: {expandedOrder.quote?.quotedAt ? new Date(expandedOrder.quote.quotedAt).toLocaleString() : "—"}</li>
  <li>
    Pharmacy Accepted: {
      // Try pharmacyAcceptedAt field first
      expandedOrder.pharmacyAcceptedAt
        ? new Date(
            expandedOrder.pharmacyAcceptedAt.$date
              ? expandedOrder.pharmacyAcceptedAt.$date
              : expandedOrder.pharmacyAcceptedAt
          ).toLocaleString()
        // Fallback: look for pharmacy accept event in assignmentHistory
        : (
            expandedOrder.assignmentHistory?.find(h =>
              h.status === "processing" || h.status === "pharmacy_accepted"
            )?.at
            ? new Date(
                expandedOrder.assignmentHistory.find(h =>
                  h.status === "processing" || h.status === "pharmacy_accepted"
                ).at
              ).toLocaleString()
            : "—"
          )
    }
</li>
  <li>User Paid/Confirmed: {expandedOrder.confirmedAt ? new Date(expandedOrder.confirmedAt).toLocaleString() : "—"}</li>

</ul>

{/* DELIVERY ASSIGNMENT HISTORY */}
{expandedOrder.assignmentHistory && expandedOrder.assignmentHistory.length > 0 && (
  <>
    <Typography sx={{ mt: 1 }}><b>Delivery Timeline:</b></Typography>
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {expandedOrder.assignmentHistory.map((h, i) => (
        <li key={i}>
          {h.status.charAt(0).toUpperCase() + h.status.slice(1)}:
          &nbsp;{h.at ? new Date(h.at).toLocaleString() : "—"}
        </li>
      ))}
    </ul>
  </>
)}

              {/* PRESCRIPTION LINK */}
              {expandedOrder.prescriptionUrl && (
                <a
                  href={expandedOrder.prescriptionUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#FFD43B", marginTop: 8 }}
                >View Prescription</a>
              )}
            </Stack>
          ) : (
            <Typography>Loading...</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExpandedOrder(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )}
          {activeTab === 1 && (
            <Box>
              <Typography variant="h6" mb={1}>All Users</Typography>
              {userList.length === 0 ? (
                <Typography sx={{ color: "#aaa" }}>No users found.</Typography>
              ) : (
                <Stack spacing={2}>
                  {userList.map(user => (
                    <Card key={user._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2 }}>
                      <Typography fontWeight={700}>{user.name}</Typography>
                      <Typography variant="body2" sx={{ color: "#FFD43B" }}>{user.email || user.mobile}</Typography>
                    </Card>
                  ))}
                </Stack>
              )}
            </Box>
          )}
          {activeTab === 2 && (
            <Box>
              <Typography variant="h6" mb={1}>All Pharmacies</Typography>
              {filteredPharmacies.length === 0 ? (
                <Typography sx={{ color: "#aaa" }}>No pharmacies found for this filter.</Typography>
              ) : (
                <Stack spacing={2}>
                  {filteredPharmacies.map(pharm => (
                    <Card key={pharm._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
                        <Box>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography fontWeight={700}>{pharm.name}</Typography>
                            <Chip label={pharm.active ? "Active" : "Inactive"} color={pharm.active ? "success" : "default"} size="small" sx={{ ml: 1 }} />
                          </Stack>
                          <Typography variant="body2" sx={{ color: "#aaf", mt: 0.5 }}>{pharm.city}, {pharm.area}</Typography>
                          <Typography variant="body2" sx={{ color: "#bbb" }}>{pharm.contact}</Typography>
                        </Box>
                        <Stack direction="row" spacing={2} sx={{ mt: { xs: 2, sm: 0 } }}>
                          <IconButton color="primary" onClick={() => alert("Pharmacy Details:\n" + JSON.stringify(pharm, null, 2))}><Visibility /></IconButton>
                          <IconButton color="success" onClick={() => handleViewMedicines(pharm._id, pharm)}><LocalPharmacy /></IconButton>
                          <IconButton color="error" onClick={() => deletePharmacy(pharm._id)}><Delete /></IconButton>
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              )}
            </Box>
          )}
          {activeTab === 3 && (
            <Box>
              <Typography variant="h6" mb={1}>Active Pharmacies</Typography>
              {filteredActivePharmacies.length === 0 ? (
                <Typography sx={{ color: "#aaa" }}>No active pharmacies found for this filter.</Typography>
              ) : (
                <Stack spacing={2}>
                  {filteredActivePharmacies.map(pharm => (
                    <Card key={pharm._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
                        <Box>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography fontWeight={700}>{pharm.name}</Typography>
                            <Chip label="Active" color="success" size="small" sx={{ ml: 1 }} />
                          </Stack>
                          <Typography variant="body2" sx={{ color: "#aaf", mt: 0.5 }}>{pharm.city}, {pharm.area}</Typography>
                          <Typography variant="body2" sx={{ color: "#bbb" }}>{pharm.contact}</Typography>
                        </Box>
                        <Stack direction="row" spacing={2} sx={{ mt: { xs: 2, sm: 0 } }}>
                          <IconButton color="primary" onClick={() => alert("Pharmacy Details:\n" + JSON.stringify(pharm, null, 2))}><Visibility /></IconButton>
                          <IconButton color="success" onClick={() => handleViewMedicines(pharm._id, pharm)}><LocalPharmacy /></IconButton>
                          <IconButton color="error" onClick={() => deletePharmacy(pharm._id)}><Delete /></IconButton>
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              )}
            </Box>
          )}
          {activeTab === 4 && (
            <Box>
              <Typography variant="h6" mb={1}>All Delivery Partners</Typography>
              {deliveryPartners.length === 0 ? (
                <Typography sx={{ color: "#aaa" }}>No delivery partners found.</Typography>
              ) : (
                <Stack spacing={2}>
                  {deliveryPartners.map(partner => (
                    <Card key={partner._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
                        <Box>
                          <Typography fontWeight={700}>
                            <DirectionsRun sx={{ mb: "-5px", mr: 1, color: "#FFD43B" }} />
                            {partner.name}
                          </Typography>
                          <Typography variant="body2" sx={{ color: "#aaf", mt: 0.5 }}>{partner.city}, {partner.area}</Typography>
                          <Typography variant="body2" sx={{ color: "#bbb" }}>{partner.mobile} | {partner.email}</Typography>
                        </Box>
                        <Stack direction="row" spacing={2} sx={{ mt: { xs: 2, sm: 0 } }}>
                          <IconButton color="primary" onClick={() => openDeliveryDetail(partner)}><Visibility /></IconButton>
                          <IconButton color="error" onClick={() => setDeleteDialog({ open: true, partner })}><Delete /></IconButton>
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              )}
            </Box>
          )}
          {activeTab === 5 && (
            <Box>
              <Typography variant="h6" mb={1}>Active Delivery Partners</Typography>
              {activeDeliveryPartners.length === 0 ? (
                <Typography sx={{ color: "#aaa" }}>No active delivery partners found.</Typography>
              ) : (
                <Stack spacing={2}>
                  {activeDeliveryPartners.map(partner => (
                    <Card key={partner._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
                        <Box>
                          <Typography fontWeight={700}>
                            <DirectionsRun sx={{ mb: "-5px", mr: 1, color: "#FFD43B" }} />
                            {partner.name}
                          </Typography>
                          <Typography variant="body2" sx={{ color: "#aaf", mt: 0.5 }}>{partner.city}, {partner.area}</Typography>
                          <Typography variant="body2" sx={{ color: "#bbb" }}>{partner.mobile} | {partner.email}</Typography>
                        </Box>
                        <Stack direction="row" spacing={2} sx={{ mt: { xs: 2, sm: 0 } }}>
                          <IconButton color="primary" onClick={() => openDeliveryDetail(partner)}><Visibility /></IconButton>
                          <IconButton color="error" onClick={() => setDeleteDialog({ open: true, partner })}><Delete /></IconButton>
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              )}
            </Box>
          )}
          {/* ------------- NEW: PAYMENTS & PAYOUTS TAB ------------- */}
  {activeTab === 6 && (
    <PaymentsPayoutsPanel token={token} />
  )}
        </Box>

        {/* ALL THE REST OF YOUR PANELS AND MODALS */}
        {/* ORDER MANAGEMENT (Assign Partner), Pending Approvals, Offers, Medicine Modal, Dialogs */}
        {/* --- Order Management --- */}
        <Box sx={{ bgcolor: "#181a1b", borderRadius: 3, p: 2, mb: 3 }}>
          <Typography variant="h6" mb={1}>Order Management (Assign Delivery Partner)</Typography>
          {orderList.filter(o => o.status === "processing").length === 0 && (
            <Typography sx={{ color: "#aaa" }}>No processing orders to assign.</Typography>
          )}
          <Stack spacing={2}>
            {orderList.filter(o => o.status === "processing").map(order => (
              <Card key={order._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={3}>
                  <Box>
                    <Typography fontWeight={700}>Order #{order._id?.slice(-5)}</Typography>
                    <Typography variant="body2" sx={{ color: "#aaf", mt: 0.5 }}>
                      User: {order.address?.name} | Pharmacy: {order.pharmacy?.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#FFD43B" }}>
                      {order.items?.map(i => `${i.name} x${i.qty || i.quantity || 1}`).join(", ")}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#aaa" }}>
                      Total: ₹{order.total}
                    </Typography>
                  </Box>
                  <Box sx={{ minWidth: 220, ml: "auto" }}>
                    {!order.deliveryPartner ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 150 }}>
                          <InputLabel>Assign Partner</InputLabel>
                          <Select
                            label="Assign Partner"
                            value={order.assigningPartnerId || ""}
                            onChange={e => {
                              const val = e.target.value;
                              setOrderList(l =>
                                l.map(oo =>
                                  oo._id === order._id ? { ...oo, assigningPartnerId: val } : oo
                                )
                              );
                            }}
                          >
                            {deliveryPartners.filter(dp => dp.active).map(dp => (
                              <MenuItem key={dp._id} value={dp._id}>{dp.name} ({dp.mobile})</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <Button
                          variant="contained"
                          color="primary"
                          size="small"
                          onClick={async () => {
                            const partnerId = order.assigningPartnerId;
                            if (!partnerId) return alert("Select delivery partner");
                            try {
                              await axios.patch(
                                `/api/orders/${order._id}/assign-delivery-partner`,
                                { deliveryPartnerId: partnerId },
                                { headers: { Authorization: `Bearer ${token}` } }
                              );
                              setMsg("Delivery partner assigned!");
                              setOrderList(l =>
                                l.map(oo =>
                                  oo._id === order._id
                                    ? { ...oo, deliveryPartner: deliveryPartners.find(dp => dp._id === partnerId) }
                                    : oo
                                )
                              );
                            } catch {
                              setMsg("Failed to assign partner!");
                            }
                          }}
                        >Assign</Button>
                      </Stack>
                    ) : (
                      <Chip color="success" label={`Assigned: ${order.deliveryPartner?.name || "Partner"}`} sx={{ fontWeight: 600 }} />
                    )}
                  </Box>
                </Stack>
              </Card>
            ))}
          </Stack>
        </Box>
        {/* PENDING PHARMACY APPROVAL */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ color: "#FFD43B" }}>Pending Pharmacies</Typography>
          {pendingPharmacies.length === 0 ? (
            <Typography sx={{ color: "#aaa", mb: 2 }}>No pending pharmacies.</Typography>
          ) : (
            pendingPharmacies.map((pharm) => (
              <Box key={pharm._id} sx={{ my: 1, p: 2, bgcolor: "#23272a", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span><b>{pharm.name}</b> ({pharm.area}, {pharm.city}) – {pharm.contact}</span>
                <Button size="small" variant="contained" color="success" onClick={() => approvePharmacy(pharm._id)}>Approve</Button>
              </Box>
            ))
          )}
        </Box>
        {/* PENDING DELIVERY PARTNER APPROVAL */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ color: "#FFD43B" }}>Pending Delivery Partners</Typography>
          {pendingDeliveryPartners.length === 0 ? (
            <Typography sx={{ color: "#aaa", mb: 2 }}>No pending delivery partners.</Typography>
          ) : (
            pendingDeliveryPartners.map((dp) => (
              <Box key={dp._id} sx={{ my: 1, p: 2, bgcolor: "#23272a", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span><b>{dp.name}</b> ({dp.area}, {dp.city}) – {dp.mobile}</span>
                <Button size="small" variant="contained" color="success" onClick={() => approveDeliveryPartner(dp._id)}>Approve</Button>
              </Box>
            ))
          )}
        </Box>
        {/* ALL DELIVERY PARTNERS */}
        <Box sx={{ bgcolor: "#181a1b", borderRadius: 3, p: 2, mb: 3 }}>
          <Typography variant="h6" mb={1}>All Delivery Partners</Typography>
          {deliveryPartners.length === 0 && <Typography sx={{ color: "#aaa" }}>No delivery partners found.</Typography>}
          <Stack spacing={2}>
            {deliveryPartners.map(partner => (
              <Card key={partner._id} sx={{ p: 2, bgcolor: "#23272a", borderRadius: 2 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
                  <Box>
                    <Typography fontWeight={700}>
                      <DirectionsRun sx={{ mb: "-5px", mr: 1, color: "#FFD43B" }} />
                      {partner.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#aaf", mt: 0.5 }}>{partner.city}, {partner.area}</Typography>
                    <Typography variant="body2" sx={{ color: "#bbb" }}>{partner.mobile} | {partner.email}</Typography>
                  </Box>
                  <Stack direction="row" spacing={2} sx={{ mt: { xs: 2, sm: 0 } }}>
                    <IconButton color="primary" onClick={() => openDeliveryDetail(partner)}><Visibility /></IconButton>
                    <IconButton color="error" onClick={() => setDeleteDialog({ open: true, partner })}><Delete /></IconButton>
                  </Stack>
                </Stack>
              </Card>
            ))}
          </Stack>
        </Box>

        {/* --- Delivery Partner Detail Modal --- */}
        <Dialog open={deliveryDetailOpen} onClose={() => setDeliveryDetailOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Delivery Partner Info</DialogTitle>
          <DialogContent dividers>
            {deliveryDetail ? (
              <Box>
                <Typography fontWeight={700} fontSize={18}>{deliveryDetail.partner.name}</Typography>
                <Typography sx={{ color: "#bbb" }}>{deliveryDetail.partner.mobile} | {deliveryDetail.partner.email}</Typography>
                <Typography>Vehicle: {deliveryDetail.partner.vehicle}</Typography>
                <Typography>City/Area: {deliveryDetail.partner.city}, {deliveryDetail.partner.area}</Typography>
                <Divider sx={{ my: 1 }} />
                <Typography fontWeight={700}>Bank:</Typography>
                <Typography>Account Holder: {deliveryDetail.partner.bankDetails.accountHolder}</Typography>
                <Typography>Acc: {deliveryDetail.partner.bankDetails.bankAccount}, IFSC: {deliveryDetail.partner.bankDetails.ifsc}</Typography>
                <Divider sx={{ my: 1 }} />
                <Typography fontWeight={700}>Aadhaar: {deliveryDetail.partner.aadhaarNumber}</Typography>
                <a href={`/${deliveryDetail.partner.aadhaarDocUrl}`} target="_blank" rel="noreferrer">Aadhaar Document</a>
                <Typography fontWeight={700}>PAN: {deliveryDetail.partner.panNumber}</Typography>
                <a href={`/${deliveryDetail.partner.panDocUrl}`} target="_blank" rel="noreferrer">PAN Document</a>
                <Divider sx={{ my: 1 }} />
                <Typography fontWeight={700}>Current Active Order</Typography>
                {deliveryDetail.activeOrder ? (
                  <Box sx={{ my: 1 }}>
                    <Typography>Order #{deliveryDetail.activeOrder._id?.slice(-5)} | {deliveryDetail.activeOrder.status}</Typography>
                    <Typography>Pharmacy: {deliveryDetail.activeOrder.pharmacy?.name}</Typography>
                    <Typography>Customer: {deliveryDetail.activeOrder.address?.name}</Typography>
                    <Typography>Address: {deliveryDetail.activeOrder.address?.addressLine}</Typography>
                    {deliveryDetail.activeOrder.driverLocation?.lat && deliveryDetail.activeOrder.driverLocation?.lng && (
                      <img
                        alt="map"
                        src={`https://maps.googleapis.com/maps/api/staticmap?center=${deliveryDetail.activeOrder.driverLocation.lat},${deliveryDetail.activeOrder.driverLocation.lng}&zoom=15&size=400x180&markers=color:red%7C${deliveryDetail.activeOrder.driverLocation.lat},${deliveryDetail.activeOrder.driverLocation.lng}&key=REMOVED_SECRET`}
                        style={{ width: "100%", borderRadius: 6, marginTop: 8 }}
                      />
                    )}
                  </Box>
                ) : (
                  <Typography color="error">No active orders</Typography>
                )}
                <Divider sx={{ my: 1 }} />
                <Typography fontWeight={700}>Past Orders</Typography>
                {deliveryDetail.pastOrders && deliveryDetail.pastOrders.length > 0 ? (
                  <Stack spacing={1} sx={{ maxHeight: 150, overflowY: "auto" }}>
                    {deliveryDetail.pastOrders.map(o => (
                      <Box key={o._id} sx={{ p: 1, borderBottom: "1px solid #333" }}>
                        #{o._id?.slice(-5)} — ₹{o.total} — {o.status} — {o.createdAt?.slice(0, 10)}
                      </Box>
                    ))}
                  </Stack>
                ) : <Typography color="error">No past orders</Typography>}
              </Box>
            ) : <Typography>Loading...</Typography>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeliveryDetailOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
        {/* --- Delivery Partner Delete Dialog --- */}
        <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, partner: null })}>
          <DialogTitle>Delete/Discontinue Delivery Partner</DialogTitle>
          <DialogContent>
            <Typography>Are you sure you want to remove this delivery partner? This cannot be undone.</Typography>
            <Typography fontWeight={700} color="error">{deleteDialog.partner?.name}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialog({ open: false, partner: null })}>Cancel</Button>
            <Button variant="contained" color="error" onClick={() => handleDeleteDeliveryPartner(deleteDialog.partner?._id)}>Delete</Button>
          </DialogActions>
        </Dialog>
        {/* --- Offers Management --- */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6">Add Offer (Coupon)</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 2 }}>
            <TextField label="Title" value={offer.title} onChange={(e) => setOffer({ ...offer, title: e.target.value })} />
            <TextField label="Description" value={offer.description} onChange={(e) => setOffer({ ...offer, description: e.target.value })} />
            <TextField label="Code" value={offer.code} onChange={(e) => setOffer({ ...offer, code: e.target.value })} />
            <TextField label="Image URL" value={offer.image} onChange={(e) => setOffer({ ...offer, image: e.target.value })} />
            <Button variant="contained" onClick={() => {
              axios.post("/api/admin/offer", offer, { headers: { Authorization: `Bearer ${token}` } })
                .then(() => { setMsg("Offer added!"); setOffer({ title: "", description: "", code: "", image: "" }); })
                .catch(() => setMsg("Failed to add offer"));
            }}>
              Add
            </Button>
          </Stack>
        </Box>
        <Typography variant="h6" mb={1}>All Offers</Typography>
        {offers.map((ofr) => (
          <Card key={ofr._id} sx={{ mb: 2, bgcolor: "#16181a" }}>
            <CardContent>
              <Typography variant="subtitle1">{ofr.title}</Typography>
              <Typography variant="body2">{ofr.description}</Typography>
              <Typography variant="body2" color="text.secondary">{ofr.code}</Typography>
              {ofr.image && <img src={ofr.image} alt="" style={{ maxWidth: 120, marginTop: 6, borderRadius: 8 }} />}
            </CardContent>
          </Card>
        ))}
        {/* --- Medicine Modal --- */}
        <Dialog open={medicineModal.open} onClose={() => setMedicineModal({ open: false, list: [], pharmacy: null })} maxWidth="sm" fullWidth>
          <DialogTitle>
            Medicines {medicineModal.pharmacy ? `for ${medicineModal.pharmacy.name}` : ""}
          </DialogTitle>
          <DialogContent dividers>
            {medicineModal.list.length === 0 && (<Typography>No medicines found.</Typography>)}
            <Stack spacing={2}>
              {medicineModal.list.map(med => (
                <Card key={med._id} sx={{ p: 2, bgcolor: "#212325" }}>
                  <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
                    <Box>
                      <Typography fontWeight={700}>{med.name}</Typography>
                      <Typography variant="body2" sx={{ color: "#FFD43B" }}>₹{med.price}</Typography>
                      <Typography variant="body2" sx={{ color: "#aaf" }}>Stock: {med.stock}</Typography>
                    </Box>
                    <IconButton color="error" onClick={() => handleDeleteMedicine(med._id)}><Delete /></IconButton>
                  </Stack>
                </Card>
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setMedicineModal({ open: false, list: [], pharmacy: null })}>Close</Button>
          </DialogActions>
        </Dialog>
        {/* --- Notification Modal --- */}
        <Dialog open={notificationOpen} onClose={() => setNotificationOpen(false)}>
          <DialogTitle>Send Notification</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <FormControl>
                <InputLabel>Recipient</InputLabel>
                <Select
                  label="Recipient"
                  value={notificationData.to}
                  onChange={e => setNotificationData({ ...notificationData, to: e.target.value })}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value="all">All Users</MenuItem>
                  <MenuItem value="users">Users Only</MenuItem>
                  <MenuItem value="pharmacists">Pharmacists Only</MenuItem>
                </Select>
              </FormControl>
              <TextField label="Title" value={notificationData.title} onChange={e => setNotificationData({ ...notificationData, title: e.target.value })} fullWidth />
              <TextField label="Message" value={notificationData.message} onChange={e => setNotificationData({ ...notificationData, message: e.target.value })} fullWidth multiline minRows={2} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setNotificationOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleSendNotification}>Send</Button>
          </DialogActions>
        </Dialog>
        {/* --- Stats Modal --- */}
        <Dialog open={showStats.open} onClose={() => setShowStats({ open: false, type: "" })} maxWidth="sm" fullWidth>
          <DialogTitle>
            {showStats.type === "orders" && "All Orders"}
            {showStats.type === "users" && "All Users"}
            {showStats.type === "pharmacies" && "All Pharmacies"}
          </DialogTitle>
          <DialogContent dividers sx={{ maxHeight: 400 }}>
            {showStats.type === "orders" && (
              <Stack spacing={1}>
                {orderList.map(order => (
                  <Box key={order._id} sx={{ p: 1, borderBottom: "1px solid #333" }}>
                    #{order._id?.slice(-5)} — ₹{order.total} — {order.status} — {order.createdAt?.slice(0, 10)}
                  </Box>
                ))}
              </Stack>
            )}
            {showStats.type === "users" && (
              <Stack spacing={1}>
                {userList.map(user => (
                  <Box key={user._id} sx={{ p: 1, borderBottom: "1px solid #333" }}>
                    {user.name} — {user.email || user.mobile}
                  </Box>
                ))}
              </Stack>
            )}
            {showStats.type === "pharmacies" && (
              <Stack spacing={1}>
                {pharmacyList.map(pharm => (
                  <Box key={pharm._id} sx={{ p: 1, borderBottom: "1px solid #333" }}>
                    {pharm.name} ({pharm.city}, {pharm.area}) — {pharm.contact}
                  </Box>
                ))}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowStats({ open: false, type: "" })}>Close</Button>
          </DialogActions>
        </Dialog>
        {/* --- Support Chats Panel (BOTTOM) --- */}
        <SupportChatsAdminPanel />
        <DeliveryPartnerChatsAdminPanel />
        <Snackbar open={!!msg} autoHideDuration={2400} onClose={() => setMsg("")}>
          <Alert onClose={() => setMsg("")} severity={msg.includes("fail") ? "error" : "success"}>{msg}</Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}
