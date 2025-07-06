// src/components/DeliveryDashboard.js
import React, { useEffect, useState, useRef } from "react";
import {
  Box, Typography, Card, CardContent, Stack, Button, Chip, CircularProgress, Snackbar, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Tabs, Tab, Avatar, Badge, Switch,
  Table, TableHead, TableRow, TableCell, TableBody
} from "@mui/material";
import TwoWheelerIcon from "@mui/icons-material/TwoWheeler";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import LogoutIcon from "@mui/icons-material/Logout";
import ChatModal from "./ChatModal";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import axios from "axios";
import { GoogleMap, Marker, Polyline, useJsApiLoader } from "@react-google-maps/api";
import dayjs from "dayjs"; // You must have dayjs installed (run: npm install dayjs)

function DeliveryPayoutsSection({ partner }) {
  const [payouts, setPayouts] = useState([]);
  const [tab, setTab] = useState(0); // 0: today, 1: yesterday

  useEffect(() => {
    if (!partner?._id) return;
    axios
      .get(`/api/payments?deliveryPartnerId=${partner._id}&status=paid`)
      .then(res => setPayouts(res.data));
  }, [partner]);

  const today = dayjs().format("YYYY-MM-DD");
  const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");

  const filtered = payouts.filter(pay => {
    const payDay = dayjs(pay.createdAt).format("YYYY-MM-DD");
    return tab === 0 ? payDay === today : payDay === yesterday;
  });

  const total = filtered.reduce((sum, p) => sum + (p.deliveryAmount || 0), 0);

  if (!partner?._id) return null;
  return (
    <Box sx={{ mb: 3 }}>
      <Card sx={{ bgcolor: "#f3f6fa", mb: 1 }}>
        <CardContent>
          <Typography variant="h6" color="secondary" fontWeight={700}>
            Your Delivery Earnings {tab === 0 ? "Today" : "Yesterday"}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button
              size="small"
              variant={tab === 0 ? "contained" : "text"}
              onClick={() => setTab(0)}
            >
              Today
            </Button>
            <Button
              size="small"
              variant={tab === 1 ? "contained" : "text"}
              onClick={() => setTab(1)}
            >
              Yesterday
            </Button>
          </Stack>
          <Typography variant="h4" fontWeight={900} sx={{ mb: 2 }}>
            ₹{total.toLocaleString("en-IN")}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Fee</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map(pay => (
                <TableRow key={pay._id}>
                  <TableCell>{pay.orderId?._id?.slice(-5) || "NA"}</TableCell>
                  <TableCell>{dayjs(pay.createdAt).format("DD/MM/YYYY")}</TableCell>
                  <TableCell>₹{pay.deliveryAmount}</TableCell>
                  <TableCell>{pay.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <Typography color="warning.main" fontSize={15}>No payouts yet.</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

const GOOGLE_MAPS_API_KEY = "REMOVED_SECRET";

// Helper: Get directions route (async, returns array of latlngs for polyline)
const getRoute = async (origin, destination) => {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.routes && data.routes[0] && data.routes[0].overview_polyline) {
    return decodePolyline(data.routes[0].overview_polyline.points);
  }
  return [];
};

// Helper: Polyline decoding
function decodePolyline(encoded) {
  let points = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;
  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export default function DeliveryDashboard() {
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("deliveryToken"));
  const [partner, setPartner] = useState(null);
  const [active, setActive] = useState(false);
  const [tab, setTab] = useState(0);
  const [orders, setOrders] = useState([]);
  const [pastOrders, setPastOrders] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatOrder, setChatOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const firstLoad = useRef(true); // <-- add this line
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [loginDialog, setLoginDialog] = useState(!loggedIn);
  const [loginForm, setLoginForm] = useState({ mobile: "", password: "" });
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetPhase, setResetPhase] = useState(0);
  const [forgotForm, setForgotForm] = useState({ mobile: "", otp: "", newPassword: "" });
  const [polylines, setPolylines] = useState({});
  const [orderUnreadCounts, setOrderUnreadCounts] = useState({});

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY
  });

  // Auto-refresh every 3 seconds
  useEffect(() => {
    if (!loggedIn) return;
    const interval = setInterval(() => {
      fetchProfileAndOrders();
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, [loggedIn]);

  useEffect(() => {
    let watchId;
    if (loggedIn && orders.length > 0 && partner?._id) {
      if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
          async (pos) => {
            const { latitude, longitude } = pos.coords;
            for (const o of orders) {
              if (o.status !== "delivered") {
                await axios.post("/api/delivery/update-location", {
                  partnerId: partner._id,
                  orderId: o._id,
                  lat: latitude,
                  lng: longitude,
                });
              }
            }
          },
          (err) => {},
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        );
      }
    }
    return () => {
      if (navigator.geolocation && watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [loggedIn, orders, partner]);

  useEffect(() => {
    if (loggedIn) {
      fetchProfileAndOrders();
    }
    // eslint-disable-next-line
  }, [loggedIn]);

  // Unread badge fetcher
  useEffect(() => {
    if (!loggedIn || !orders.length) return;
    const token = localStorage.getItem("deliveryToken");
    const fetchUnread = async () => {
      let counts = {};
      await Promise.all(orders.map(async (order) => {
        try {
          const res = await axios.get(`/api/chat/${order._id}/user-unread-count`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          counts[order._id] = res.data.unreadCount || 0;
        } catch {
          counts[order._id] = 0;
        }
      }));
      setOrderUnreadCounts(counts);
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 3000);
    return () => clearInterval(interval);
  }, [orders, loggedIn, chatOpen]);

  // Fetch partner profile and orders (and set active state)
  const fetchProfileAndOrders = async () => {
  if (firstLoad.current) {
    setLoading(true);
  }
  try {
    const token = localStorage.getItem("deliveryToken");
    const partnerId = localStorage.getItem("deliveryPartnerId");
    const resProfile = await axios.get(`/api/delivery/partner/${partnerId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setPartner(resProfile.data.partner || {});
    setActive(resProfile.data.partner?.active || false);
    const resOrders = await axios.get("/api/delivery/orders", {
      headers: {
        Authorization: `Bearer ${token}`,
        deliverypartnerid: partnerId
      }
    });
    const activeOrders = resOrders.data || [];
    setOrders(activeOrders);
    setPastOrders(resProfile.data.pastOrders || []);
    let newPolys = {};
    for (const o of activeOrders) {
      if (
        o.pharmacy?.location?.lat &&
        o.pharmacy?.location?.lng &&
        o.address?.lat &&
        o.address?.lng
      ) {
        if (!polylines[o._id]) {
          const poly = await getRoute(o.pharmacy.location, o.address);
          newPolys[o._id] = poly;
        } else {
          newPolys[o._id] = polylines[o._id];
        }
      }
    }
    setPolylines(newPolys);
  } catch (err) {
    setSnackbar({ open: true, message: "Failed to load profile/orders", severity: "error" });
    setLoggedIn(false);
    setLoginDialog(true);
  }
  if (firstLoad.current) {
    setLoading(false);
    firstLoad.current = false; // set to false after first load!
  }
};

  const handleUpdateStatus = async (orderId, newStatus) => {
    try {
      const token = localStorage.getItem("deliveryToken");
      await axios.patch(`/api/delivery/orders/${orderId}/status`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSnackbar({ open: true, message: `Order marked as ${newStatus}`, severity: "success" });
      fetchProfileAndOrders();
    } catch {
      setSnackbar({ open: true, message: "Failed to update order status", severity: "error" });
    }
  };

  // Auth Logic
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post("/api/delivery/login", loginForm);
      localStorage.setItem("deliveryToken", res.data.token);
      localStorage.setItem("deliveryPartnerId", res.data.partner._id);
      setPartner(res.data.partner);
      setActive(res.data.partner.active || false);
      setLoggedIn(true);
      setLoginDialog(false);
      setSnackbar({ open: true, message: "Logged in!", severity: "success" });
    } catch {
      setSnackbar({ open: true, message: "Login failed. Check mobile/password.", severity: "error" });
    }
  };
  const handleLogout = () => {
    localStorage.removeItem("deliveryToken");
    localStorage.removeItem("deliveryPartnerId");
    setLoggedIn(false);
    setPartner(null);
    setOrders([]);
    setPastOrders([]);
    setLoginDialog(true);
  };

  // Forgot/Reset Password Logic
  const handleForgotStart = async () => {
    try {
      await axios.post("/api/delivery/forgot-password", { mobile: forgotForm.mobile });
      setSnackbar({ open: true, message: "OTP sent to mobile!", severity: "success" });
      setResetPhase(1);
    } catch {
      setSnackbar({ open: true, message: "Mobile not found!", severity: "error" });
    }
  };
  const handleResetPassword = async () => {
    try {
      await axios.post("/api/delivery/reset-password", {
        mobile: forgotForm.mobile,
        otp: forgotForm.otp,
        newPassword: forgotForm.newPassword
      });
      setSnackbar({ open: true, message: "Password reset! Please log in.", severity: "success" });
      setForgotOpen(false);
      setResetPhase(0);
      setForgotForm({ mobile: "", otp: "", newPassword: "" });
    } catch {
      setSnackbar({ open: true, message: "Invalid OTP or error", severity: "error" });
    }
  };

  // === UI ===
  if (!loggedIn) {
    return (
      <Dialog open={loginDialog} onClose={() => {}}>
        <DialogTitle>Delivery Partner Login</DialogTitle>
        <DialogContent>
          <form onSubmit={handleLogin}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Mobile Number"
                required
                value={loginForm.mobile}
                onChange={e => setLoginForm(f => ({ ...f, mobile: e.target.value }))}
              />
              <TextField
                label="Password"
                type="password"
                required
                value={loginForm.password}
                onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
              />
              <Button
                type="submit"
                variant="contained"
                color="primary"
                fullWidth
                sx={{ mt: 1 }}
              >
                Login
              </Button>
              <Button
                color="secondary"
                onClick={() => setForgotOpen(true)}
                sx={{ fontSize: 13 }}
              >
                Forgot Password?
              </Button>
            </Stack>
          </form>
        </DialogContent>
        {/* Forgot/Reset Password Modal */}
        <Dialog open={forgotOpen} onClose={() => { setForgotOpen(false); setResetPhase(0); }}>
          <DialogTitle>Forgot Password</DialogTitle>
          <DialogContent>
            {resetPhase === 0 ? (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Registered Mobile"
                  value={forgotForm.mobile}
                  onChange={e => setForgotForm(f => ({ ...f, mobile: e.target.value }))}
                />
                <Button variant="contained" onClick={handleForgotStart}>
                  Send OTP
                </Button>
              </Stack>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="OTP"
                  value={forgotForm.otp}
                  onChange={e => setForgotForm(f => ({ ...f, otp: e.target.value }))}
                />
                <TextField
                  label="New Password"
                  type="password"
                  value={forgotForm.newPassword}
                  onChange={e => setForgotForm(f => ({ ...f, newPassword: e.target.value }))}
                />
                <Button variant="contained" onClick={handleResetPassword}>
                  Reset Password
                </Button>
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setForgotOpen(false); setResetPhase(0); }}>Close</Button>
          </DialogActions>
        </Dialog>
        <Snackbar
          open={snackbar.open}
          autoHideDuration={2500}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
        </Snackbar>
      </Dialog>
    );
  }

  // DASHBOARD
  return (
    <Box sx={{ maxWidth: 900, mx: "auto", mt: 4, p: 2 }}>
      {/* Profile, Toggle, and Logout */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Avatar sx={{ width: 54, height: 54, fontWeight: 700, bgcolor: "#FFD43B", color: "#232323" }}>
          {partner?.name?.charAt(0)}
        </Avatar>
        <Box sx={{ ml: 2 }}>
          <Typography variant="h6" fontWeight={700}>
            {partner?.name}
          </Typography>
          <Typography sx={{ color: "#555", fontSize: 15 }}>
            {partner?.mobile} &nbsp; | &nbsp; {partner?.city}, {partner?.area}
          </Typography>
          {/* Active Toggle */}
          <Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
            <Switch
              checked={active}
              onChange={async (e) => {
                setActive(e.target.checked);
                const token = localStorage.getItem("deliveryToken");
                await axios.patch(
                  `/api/delivery/partner/${partner._id}/active`,
                  { active: e.target.checked },
                  { headers: { Authorization: `Bearer ${token}` } }
                );
              }}
              inputProps={{ "aria-label": "Active Status" }}
              color="success"
            />
            <Typography sx={{ color: active ? "#13C0A2" : "#f44336", fontWeight: 600, ml: 1 }}>
              {active ? "Active" : "Inactive"}
            </Typography>
          </Box>
        </Box>
        {/* LOGOUT at right! */}
        <Button
          variant="outlined"
          color="error"
          sx={{
            ml: "auto",
            fontWeight: 700,
            borderRadius: 4,
            minWidth: 90,
            whiteSpace: "nowrap",
          }}
          startIcon={<LogoutIcon />}
          onClick={handleLogout}
        >
          Logout
        </Button>
      </Box>

      {/* Tabs for Active / Past Orders / Earnings */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Active Orders" />
        <Tab label="Past Orders" />
        <Tab label="Earnings" />
      </Tabs>
      {/* MAIN CONTENT BASED ON TAB */}
      {loading ? (
        <Box sx={{ textAlign: "center", mt: 6 }}>
          <CircularProgress />
        </Box>
      ) : tab === 0 ? (
        // ACTIVE ORDERS TAB
        <Stack spacing={3}>
          {orders.length === 0 && (
            <Typography sx={{ textAlign: "center", color: "#888" }}>
              No active orders assigned to you.
            </Typography>
          )}
          {orders.map((order) => {
            const pharmacyLoc = order.pharmacy?.location;
            const userLoc = order.address;
            const poly = polylines[order._id] || [];
            const mapCenter = pharmacyLoc?.lat && pharmacyLoc?.lng
              ? { lat: pharmacyLoc.lat, lng: pharmacyLoc.lng }
              : { lat: 19.076, lng: 72.877 };
            return (
              <Card key={order._id} sx={{ borderRadius: 5, bgcolor: "#f7fafc" }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={2}>
                    <LocalPharmacyIcon sx={{ color: "#13C0A2" }} />
                    <Typography sx={{ fontWeight: 700, fontSize: 17 }}>
                      Pharmacy: <span style={{ color: "#13C0A2" }}>
                        {order.pharmacy?.name || order.pharmacy}
                      </span>
                    </Typography>
                    <Chip label={order.status} color="primary" sx={{ ml: "auto" }} />
                  </Stack>
                  <Typography sx={{ mt: 1, color: "#555" }}>
                    Pharmacy Address: <b>{order.pharmacy?.address}</b>
                  </Typography>
                  <Typography sx={{ color: "#555" }}>
                    Deliver to: <b>{order.address?.addressLine}</b>
                  </Typography>
                  <Typography sx={{ color: "#555" }}>
                    Amount: ₹{order.total || order.amount || 0}
                  </Typography>
                  <Typography sx={{ color: "#555" }}>
                    Items: {order.items.map((item, i) => (
                      <span key={i}>{item.name} x{item.qty || item.quantity}; </span>
                    ))}
                  </Typography>
                  {/* ===== LIVE MAP BELOW ===== */}
                  {isLoaded && pharmacyLoc?.lat && userLoc?.lat ? (
                    <Box sx={{ mt: 2, mb: 1 }}>
                      <GoogleMap
                        mapContainerStyle={{ width: "100%", height: "230px", borderRadius: "18px" }}
                        center={mapCenter}
                        zoom={13}
                        options={{ streetViewControl: false, mapTypeControl: false }}
                      >
                        {/* Pharmacy marker */}
                        <Marker
                          position={{ lat: pharmacyLoc.lat, lng: pharmacyLoc.lng }}
                          label="P"
                          title="Pharmacy"
                          icon={{
                            url: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
                            scaledSize: { width: 40, height: 40 }
                          }}
                        />
                        {/* User marker */}
                        <Marker
                          position={{ lat: userLoc.lat, lng: userLoc.lng }}
                          label="U"
                          title="Delivery Address"
                          icon={{
                            url: "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
                            scaledSize: { width: 40, height: 40 }
                          }}
                        />
                        {/* Polyline */}
                        {poly.length > 0 && (
                          <Polyline
                            path={poly}
                            options={{
                              strokeColor: "#1976d2",
                              strokeOpacity: 0.8,
                              strokeWeight: 4,
                            }}
                          />
                        )}
                      </GoogleMap>
                      <Button
                        variant="outlined"
                        sx={{ mt: 1 }}
                        target="_blank"
                        href={`https://www.google.com/maps/dir/?api=1&origin=${pharmacyLoc.lat},${pharmacyLoc.lng}&destination=${userLoc.lat},${userLoc.lng}`}
                      >
                        Get Directions in Google Maps
                      </Button>
                    </Box>
                  ) : (
                    <Typography sx={{ color: "#bbb", fontSize: 14, mt: 2 }}>
                      Live map not available (location missing)
                    </Typography>
                  )}
                  {/* Update Status Button */}
                  <Stack direction="row" spacing={2} mt={2}>
                    {order.status === "assigned" && (
                      <>
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => handleUpdateStatus(order._id, "accepted")}
                        >
                          Accept Order
                        </Button>
                        <Button
                          variant="contained"
                          color="error"
                          onClick={() => handleUpdateStatus(order._id, "rejected")}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {order.status === "accepted" && (
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={() => handleUpdateStatus(order._id, "out_for_delivery")}
                        startIcon={<TwoWheelerIcon />}
                      >
                        Mark as Out for Delivery
                      </Button>
                    )}
                    {order.status === "out_for_delivery" && (
                      <Button
                        variant="contained"
                        color="success"
                        onClick={() => handleUpdateStatus(order._id, "delivered")}
                        startIcon={<DoneAllIcon />}
                      >
                        Mark as Delivered
                      </Button>
                    )}
                    {order.status === "delivered" && (
                      <Chip label="Delivered" color="success" icon={<DoneAllIcon />} />
                    )}
                    {/* ===== Delivery Chat Button (ONLY if not delivered) ===== */}
                    {order.status !== "delivered" && (
                      <Badge
                        color="error"
                        badgeContent={orderUnreadCounts[order._id] || 0}
                        invisible={!orderUnreadCounts[order._id]}
                      >
                        <Button
                          variant="contained"
                          color="secondary"
                          startIcon={<ChatBubbleOutlineIcon />}
                          sx={{ ml: 2, fontWeight: 600, borderRadius: 4, bgcolor: "#FFD43B", color: "#222" }}
                          onClick={async () => {
                            setChatOrder(order);
                            setChatOpen(true);
                            // Mark as seen when opening
                            const token = localStorage.getItem("deliveryToken");
                            await axios.patch(`/api/chat/${order._id}/user-chat-seen`, {}, {
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            setOrderUnreadCounts((c) => ({ ...c, [order._id]: 0 }));
                          }}
                        >
                          Chat
                        </Button>
                      </Badge>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      ) : tab === 1 ? (
        // PAST ORDERS TAB
        <Stack spacing={3}>
          {pastOrders.length === 0 && (
            <Typography sx={{ textAlign: "center", color: "#888" }}>
              No past orders delivered yet.
            </Typography>
          )}
          {pastOrders.map((order) => (
            <Card key={order._id} sx={{ borderRadius: 5, bgcolor: "#f3f6fa" }}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <DoneAllIcon sx={{ color: "#13C0A2" }} />
                  <Typography sx={{ fontWeight: 700, fontSize: 17 }}>
                    Delivered #{order._id?.slice(-5)}
                  </Typography>
                  <Chip label={order.status} color="success" sx={{ ml: "auto" }} />
                </Stack>
                <Typography sx={{ color: "#555" }}>
                  Pharmacy: {order.pharmacy?.name || order.pharmacy}
                </Typography>
                <Typography sx={{ color: "#555" }}>
                  Delivered to: {order.address?.addressLine}
                </Typography>
                <Typography sx={{ color: "#555" }}>
                  Amount: ₹{order.total || order.amount || 0}
                </Typography>
                <Typography sx={{ color: "#888" }}>
                  {order.createdAt && (new Date(order.createdAt)).toLocaleString()}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : (
        // EARNINGS TAB
        <DeliveryPayoutsSection partner={partner} />
      )}
      {/* DELIVERY CHAT MODAL */}
      <ChatModal
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        orderId={chatOrder?._id}
        thread="delivery"
        orderStatus={chatOrder?.status}
        partnerName={chatOrder?.address?.name}
        partnerType="user"
        currentRole="delivery"
      />
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2500}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
