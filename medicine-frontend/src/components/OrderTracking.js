// src/components/OrderTracking.js
import React, { useEffect, useState } from "react";
import {
  Box, Typography, Stepper, Step, StepLabel, StepConnector,
  Card, CardContent, Button, Chip, Divider, Stack, Dialog,
  DialogTitle, DialogContent, DialogActions, Avatar, Rating, CircularProgress, Badge
} from "@mui/material";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import ChatModal from "./ChatModal";
import ShoppingCartCheckoutIcon from "@mui/icons-material/ShoppingCartCheckout";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import NoteAltIcon from "@mui/icons-material/NoteAlt";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import SentimentVerySatisfiedIcon from "@mui/icons-material/SentimentVerySatisfied";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import CallIcon from "@mui/icons-material/Call";
import ChatSupportModal from "./ChatSupportModal";
import TwoWheelerIcon from "@mui/icons-material/TwoWheeler";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import Snackbar from "@mui/material/Snackbar";
import MuiAlert from "@mui/material/Alert";

const steps = [
  { label: "Order Placed", icon: <ShoppingCartCheckoutIcon /> },
  { label: "Processing", icon: <LocalPharmacyIcon /> },
  { label: "Out for Delivery", icon: <TwoWheelerIcon /> },
  { label: "Delivered", icon: <DoneAllIcon /> }
];

const API_BASE =
  process.env.REACT_APP_API_BASE_URL ||
  (typeof window !== "undefined" && window.REACT_APP_API_BASE_URL) ||
  "";

const ColorConnector = (props) => (
  <StepConnector
    {...props}
    sx={{
      [`& .MuiStepConnector-line`]: {
        transition: "background-color 0.4s",
        height: 4,
        border: 0,
        backgroundColor: "#d5eaf2",
        borderRadius: 2,
      }
    }}
  />
);

function formatAddress(address) {
  if (!address) return "";
  if (typeof address === "object")
    return `${address.name || ""}, ${address.addressLine || ""}${address.floor ? ", Floor: " + address.floor : ""}${address.landmark ? ", " + address.landmark : ""}, ${address.phone || ""}`;
  return address;
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function OrderTracking() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quoteDialog, setQuoteDialog] = useState(false);
  const [quoteActionLoading, setQuoteActionLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false); // Delivery chat modal
  const [chatThread, setChatThread] = useState(null);
  const [chatPartner, setChatPartner] = useState({ name: "", type: "" });
  const [supportChatOpen, setSupportChatOpen] = useState(false); // Support chat modal
  const [eta, setEta] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [pharmacyRating, setPharmacyRating] = useState(null);
  const [deliveryRating, setDeliveryRating] = useState(null);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [deliveryBehavior, setDeliveryBehavior] = useState([]);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [deliveryUnreadCount, setDeliveryUnreadCount] = useState(0);
  const getToken = () => localStorage.getItem('token') || '';

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: "REMOVED_SECRET",
  });

  useEffect(() => {
    let interval = setInterval(() => setRefreshTick(tick => tick + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API_BASE}/api/orders/${orderId}`)
      .then(res => {
        setOrder({ ...res.data, __type: "order" });
        setLoading(false);
        if (res.data.deliveryRating && res.data.pharmacyRating && res.data.deliveryBehavior) {
          setFeedbackSubmitted(true);
        }
        if (res.data.deliveryRating) setDeliveryRating(res.data.deliveryRating);
        if (res.data.pharmacyRating) setPharmacyRating(res.data.pharmacyRating);
      })
      .catch(() => {
        axios.get(`${API_BASE}/api/prescriptions/order/${orderId}`, { headers: { Authorization: `Bearer ${getToken()}` } })
          .then(res => {
            setOrder({ ...res.data, __type: "prescription" });
            setLoading(false);
          })
          .catch(() => {
            setOrder(null);
            setLoading(false);
          });
      });
  }, [orderId, quoteActionLoading, refreshTick]);

  useEffect(() => {
    if (!order) return;
    axios.get(`/api/chat/${order._id}/delivery-unread-count`, { withCredentials: true })
      .then(res => setDeliveryUnreadCount(res.data.unreadCount || 0))
      .catch(() => setDeliveryUnreadCount(0));
  }, [order, refreshTick, chatOpen]);

  useEffect(() => {
    let interval;
    const fetchETA = async () => {
      if (order && order.driverLocation && order.address && order.status === "out_for_delivery") {
        try {
          const res = await axios.get(`${API_BASE}/api/orders/${order._id}/eta`);
          setEta(res.data.eta || "N/A");
        } catch {
          setEta("N/A");
        }
      } else {
        setEta("");
      }
    };
    fetchETA();
    interval = setInterval(fetchETA, 3000);
    return () => clearInterval(interval);
  }, [order]);

  useEffect(() => {
    if (order && order.status === "quoted") setQuoteDialog(true);
    else setQuoteDialog(false);
  }, [order]);

  useEffect(() => {
    if (order && (order.status === "delivered" || order.status === "cancelled")) {
      localStorage.removeItem("activeOrderId");
    }
  }, [order]);

  const handleAcceptQuote = async () => {
    setQuoteActionLoading(true);
    await axios.post(`${API_BASE}/api/orders/${order._id}/accept`);
    setQuoteActionLoading(false);
    setQuoteDialog(false);
    window.location.reload();
  };

  const handleRejectQuote = async () => {
    setQuoteActionLoading(true);
    await axios.put(`${API_BASE}/api/orders/${order._id}/status`, { status: "rejected", statusText: "Rejected by User" });
    setQuoteActionLoading(false);
    setQuoteDialog(false);
    window.location.reload();
  };

  const handleRatingSubmit = async () => {
    setRatingSubmitting(true);
    try {
      await axios.post(`${API_BASE}/api/orders/${order._id}/ratings`, {
        pharmacyRating,
        deliveryRating,
        deliveryBehavior
      });
      setSnackbarMsg("Feedback submitted successfully!");
      setSnackbarOpen(true);
      setFeedbackSubmitted(true);
      if (order && order.status === "delivered") {
        localStorage.removeItem("activeOrderId");
      }
    } catch (e) {
      setSnackbarMsg("Failed to submit feedback!");
      setSnackbarOpen(true);
    }
    setRatingSubmitting(false);
  };

  const handleOpenDeliveryChat = () => {
    setChatPartner({
      name: (order.deliveryPartner && order.deliveryPartner.name) || "Delivery Partner",
      type: "delivery"
    });
    setChatThread("delivery");
    setChatOpen(true);
    axios.patch(`/api/chat/${order._id}/delivery-chat-seen`, {}, { withCredentials: true });
    setDeliveryUnreadCount(0);
  };

  if (loading)
    return <Box sx={{ textAlign: "center", mt: 8, color: "#13C0A2", fontWeight: 700, fontSize: 22 }}>Loading…</Box>;

  if (!order)
    return (
      <Box sx={{ mt: 10, textAlign: "center" }}>
        <Typography variant="h6" color="error">Order not found</Typography>
        <Button sx={{ mt: 2, fontWeight: 700, bgcolor: "#13C0A2", color: "#fff" }} onClick={() => navigate("/orders")}>Go to My Orders</Button>
      </Box>
    );

  const currentStep = typeof order.status === "number" ? order.status : (
    order.status === "placed" ? 0 :
      order.status === "processing" ? 1 :
        order.status === "out_for_delivery" ? 2 :
          order.status === "delivered" ? 3 : 0
  );
  const isDelivered = currentStep === 3;

  const stepTimes = [
    order.placedAt || order.createdAt,
    order.processingAt,
    order.outForDeliveryAt,
    order.deliveredAt,
  ];

  const deliveryPartner = order.deliveryPartner && typeof order.deliveryPartner === "object"
    ? order.deliveryPartner
    : {
      name: "Delivery Partner",
      avatar: "/images/delivery-partner.png",
      rating: 4.7,
      phone: "******0000",
      vehicle: "Bike"
    };

  // ------ ROBUST PRESCRIPTION QUOTE LOGIC ------
  let prescriptionQuote = null;
  if (order.__type === "prescription") {
    if (order.quote && order.quote.items && order.quote.items.length > 0) {
      prescriptionQuote = order.quote;
    } else if (order.tempQuote && order.tempQuote.items && order.tempQuote.items.length > 0) {
      prescriptionQuote = {
        ...order.tempQuote,
        price: order.tempQuote.approxPrice,
        items: order.tempQuote.items
      };
    } else if (Array.isArray(order.quotes) && order.quotes.length > 0) {
      prescriptionQuote = order.quotes[order.quotes.length - 1];
    }
  }

  return (
    <Box sx={{ bgcolor: "#f9fafb", minHeight: "100vh", pb: { xs: 10, sm: 3 }, pt: 3 }}>
      <Box sx={{ maxWidth: 480, mx: "auto", p: { xs: 0.5, sm: 1.5 } }}>
        <Card sx={{
          p: { xs: 2, sm: 3 },
          borderRadius: 5,
          boxShadow: 4,
          background: "#fff",
        }}>
          <Typography
            variant="h5"
            sx={{ color: "#13C0A2", fontWeight: 900, mb: 1, letterSpacing: 1, textAlign: "center" }}
          >
            Track Your Order
          </Typography>
          {/* ETA Bar */}
          {eta && order.status === "out_for_delivery" && (
            <Box sx={{
              bgcolor: "#FFD43B",
              color: "#1d4335",
              fontWeight: 900,
              borderRadius: "18px",
              px: 3, py: 1.2,
              mx: "auto",
              my: 1,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: 19,
              width: "fit-content",
              boxShadow: "0 1px 8px #f1f1b2"
            }}>
              Arriving in {eta}
            </Box>
          )}
          <Stack direction="row" alignItems="center" justifyContent="center" spacing={1} mb={1}>
            <Chip label={`Order #${order.id || order._id?.slice(-5)}`} size="small" sx={{ bgcolor: "#e6f9f5", color: "#13C0A2", fontWeight: 700, fontSize: 15 }} />
            <Chip label={order.statusText || steps[currentStep]?.label} size="small" color={isDelivered ? "success" : "primary"} sx={{ fontWeight: 700, fontSize: 15 }} />
          </Stack>
          {/* Stepper */}
          <Stepper
            activeStep={currentStep}
            alternativeLabel
            connector={<ColorConnector />}
            sx={{ mb: 3, bgcolor: "#e3f2fd", borderRadius: 2, py: 2, transition: "all 0.3s" }}
          >
            {steps.map((step, i) => (
              <Step key={step.label} completed={i < currentStep}>
                <StepLabel icon={step.icon}>
                  <span style={{
                    fontWeight: i === currentStep ? 900 : 600,
                    color: i <= currentStep ? "#13C0A2" : "#aaa",
                    fontSize: 16
                  }}>
                    {step.label}
                  </span>
                  {stepTimes[i] && (
                    <div style={{
                      fontSize: 13,
                      fontWeight: 600,
                      marginTop: 2,
                      color: "#17879c"
                    }}>
                      {formatTimestamp(stepTimes[i])}
                    </div>
                  )}
                </StepLabel>
              </Step>
            ))}
          </Stepper>
          {/* Delivery Partner Card */}
          {order.status === "out_for_delivery" && (
            <Card sx={{
              mb: 2, boxShadow: 1, bgcolor: "#f9f9f6", borderRadius: 3, px: 2, py: 1.5,
              border: "1.5px solid #eee",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}>
              <Stack direction="row" spacing={2} alignItems="center" flex={1}>
                <Avatar
                  src={deliveryPartner.avatar || "/images/delivery-partner.png"}
                  sx={{ width: 54, height: 54, bgcolor: "#fbefff", fontWeight: 900 }}
                  alt={deliveryPartner.name || "Delivery Partner"}
                >
                  {(deliveryPartner.name || "D").charAt(0)}
                </Avatar>
                <Box>
                  <Typography fontWeight={800} fontSize={17}>
                    {deliveryPartner.name || "Delivery Partner"}
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={1} mt={0.3}>
                    <Rating value={deliveryPartner.rating || 4.7} precision={0.1} readOnly size="small" />
                    <Typography fontSize={13} fontWeight={700} color="#282828">★ {deliveryPartner.rating || 4.7}</Typography>
                    <Typography fontSize={13} color="#777" sx={{ ml: 1 }}>{deliveryPartner.vehicle || "Bike"}</Typography>
                  </Stack>
                  <Typography fontSize={13} color="#888">
                    Phone: {deliveryPartner.phone ? deliveryPartner.phone.replace(/.(?=.{4})/g, "*") : "******"}
                  </Typography>
                  <Typography sx={{ mt: 0.5, color: "#17879c", fontWeight: 700 }}>
                    Arriving in {eta || "Calculating..."} <TwoWheelerIcon sx={{ fontSize: 17, mb: "-2px" }} />
                  </Typography>
                </Box>
              </Stack>
              <Stack spacing={1.7} direction="column" alignItems="center" ml={2}>
                <Button
                  variant="contained"
                  color="primary"
                  sx={{
                    minWidth: 0, width: 52, height: 52, borderRadius: "50%",
                    bgcolor: "#13C0A2",
                    boxShadow: "0 2px 8px #b9e2db50",
                    "&:hover": { bgcolor: "#17879c" }
                  }}
                  onClick={() => window.open(`tel:${deliveryPartner.mobile || deliveryPartner.phone || ""}`)}
                >
                  <CallIcon fontSize="medium" sx={{ color: "#fff" }} />
                </Button>
                <Badge color="error" badgeContent={deliveryUnreadCount} invisible={deliveryUnreadCount === 0}>
                  <Button
                    variant="contained"
                    color="secondary"
                    sx={{
                      minWidth: 0, width: 52, height: 52, borderRadius: "50%",
                      bgcolor: "#FFD43B",
                      boxShadow: "0 2px 8px #ffd43b55",
                      "&:hover": { bgcolor: "#ffe066" }
                    }}
                    onClick={handleOpenDeliveryChat}
                  >
                    <ChatBubbleOutlineIcon fontSize="medium" sx={{ color: "#333" }} />
                  </Button>
                </Badge>
              </Stack>
            </Card>
          )}
          {/* ORDER SUMMARY */}
          <CardContent sx={{
            bgcolor: "#f7faff",
            borderRadius: 2,
            boxShadow: 0,
            mb: 2,
            p: { xs: 1, sm: 2 },
          }}>
            <Stack spacing={1.2}>
              {/* PRESCRIPTION ORDER RENDER */}
              {order.__type === "prescription" ? (
                <>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Pharmacy:
                    <span style={{ color: "#13C0A2", marginLeft: 6 }}>
                      {prescriptionQuote && (prescriptionQuote.pharmacyName || prescriptionQuote.pharmacy?.name)
                        ? (prescriptionQuote.pharmacyName || prescriptionQuote.pharmacy?.name)
                        : "Pharmacy not assigned yet"}
                    </span>
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#444" }}>
                    Deliver to:
                    <span style={{ color: "#13C0A2", marginLeft: 6 }}>
                      {formatAddress(order.address)}
                    </span>
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#444" }}>
                    Amount: <b>₹{prescriptionQuote ? (prescriptionQuote.price || prescriptionQuote.approxPrice || 0) : 0}</b>
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#888" }}>
                    Items:
                    {prescriptionQuote && prescriptionQuote.items && prescriptionQuote.items.length > 0 ? (
                      prescriptionQuote.items.map((item, i) =>
                        <span key={i} style={{ color: "#13C0A2", fontWeight: 600 }}>
                          {" "}{item.medicineName} x{item.quantity || 1} [{item.available !== false ? "Available" : "Unavailable"}];
                        </span>
                      )
                    ) : (
                      <span style={{ color: "#aaa" }}> Quote not received yet</span>
                    )}
                  </Typography>
                  {/* Prescription image, if available */}
                  {order.prescriptionUrl && (
                    <Box sx={{ mt: 2, mb: 2 }}>
                      <Typography variant="body2" sx={{ color: "#13C0A2", fontWeight: 600, mb: 0.5 }}>
                        Prescription Uploaded:
                      </Typography>
                      <img
                        src={
                          order.prescriptionUrl.startsWith("http")
                            ? order.prescriptionUrl
                            : `${API_BASE}${order.prescriptionUrl}`
                        }
                        alt="Prescription"
                        style={{
                          width: "90%",
                          maxHeight: 190,
                          borderRadius: 7,
                          boxShadow: "0 2px 8px #bbb"
                        }}
                      />
                    </Box>
                  )}
                  <Stack direction="row" spacing={2} sx={{ my: 2 }}>
                    <Button
                      variant="outlined"
                      color="success"
                      startIcon={<SupportAgentIcon />}
                      sx={{ fontWeight: 600, textTransform: "none" }}
                      onClick={() => setSupportChatOpen(true)}
                    >
                      Contact Support
                    </Button>
                  </Stack>
                </>
              ) : (
                // NORMAL ORDER LOGIC (Unchanged)
                <>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Pharmacy:
                    <span style={{ color: "#13C0A2", marginLeft: 6 }}>{order.pharmacyName || (typeof order.pharmacy === "object" ? order.pharmacy?.name : order.pharmacy)}</span>
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#444" }}>
                    Deliver to:
                    <span style={{ color: "#13C0A2", marginLeft: 6 }}>{formatAddress(order.address)}</span>
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#444" }}>
                    Amount: <b>₹{order.amount || order.total || 0}</b>
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#888" }}>
                    Items:
                    {(order.items || []).map((item, i) =>
                      <span key={i} style={{ color: "#13C0A2", fontWeight: 600 }}> {item.name} x{item.qty || item.quantity};</span>
                    )}
                  </Typography>
                  <Stack direction="row" spacing={2} sx={{ my: 2 }}>
                    <Button
                      variant="outlined"
                      color="success"
                      startIcon={<SupportAgentIcon />}
                      sx={{ fontWeight: 600, textTransform: "none" }}
                      onClick={() => setSupportChatOpen(true)}
                    >
                      Contact Support
                    </Button>
                  </Stack>
                  {order.dosage && (
                    <Stack direction="row" alignItems="center">
                      <NoteAltIcon sx={{ color: "#1976d2", mr: 1 }} />
                      <Typography variant="body2" sx={{ color: "#1976d2" }}>
                        Dosage: {order.dosage}
                      </Typography>
                    </Stack>
                  )}
                  {order.note && (
                    <Typography variant="body2" sx={{ color: "#888" }}>
                      <b>Note:</b> {order.note}
                    </Typography>
                  )}
                  {order.prescription && (
                    <Box sx={{ mt: 2, mb: 2 }}>
                      <Typography variant="body2" sx={{ color: "#13C0A2", fontWeight: 600, mb: 0.5 }}>
                        Prescription Uploaded:
                      </Typography>
                      <img
                        src={
                          order.prescription.startsWith("http")
                            ? order.prescription
                            : `${API_BASE}${order.prescription}`
                        }
                        alt="Prescription"
                        style={{
                          width: "90%",
                          maxHeight: 190,
                          borderRadius: 7,
                          boxShadow: "0 2px 8px #bbb"
                        }}
                      />
                    </Box>
                  )}
                </>
              )}
            </Stack>
            <Divider sx={{ my: 2 }} />
            {/* MAP (Delivery tracking) */}
            {isLoaded && order.driverLocation && currentStep >= 2 && currentStep < 3 && (
              <Box>
                <Typography variant="body2" sx={{ mb: 1, color: "#1976d2" }}>
                  Live Delivery Location:
                </Typography>
                <GoogleMap
                  mapContainerStyle={{
                    width: "100%",
                    height: "230px",
                    borderRadius: "18px",
                    marginTop: "12px"
                  }}
                  center={{
                    lat: order.driverLocation.lat || 28.4595,
                    lng: order.driverLocation.lng || 77.0266
                  }}
                  zoom={14}
                >
                  <Marker
                    position={{
                      lat: order.driverLocation.lat,
                      lng: order.driverLocation.lng
                    }}
                  />
                </GoogleMap>
                <Typography variant="body1" sx={{ color: "#1976d2", fontWeight: 700, mt: 1 }}>
                  Estimated time to delivery: {eta || "Calculating..."}
                </Typography>
              </Box>
            )}
            {/* Cheerful Delivered Message */}
            {isDelivered && (
              <Stack direction="row" alignItems="center" justifyContent="center" sx={{ mt: 2 }}>
                <SentimentVerySatisfiedIcon sx={{ color: "#FFD43B", fontSize: 36, mr: 1 }} />
                <Typography variant="h6" sx={{
                  color: "#13C0A2",
                  fontWeight: 800,
                  letterSpacing: 0.2
                }}>
                  Fastest medicine, happiest you! Get well soon! 💊❤️
                </Typography>
              </Stack>
            )}
            {/* Ratings Section (after delivered) */}
            {isDelivered && (
              feedbackSubmitted ? (
                <Box sx={{ mt: 5, textAlign: "center" }}>
                  <SentimentVerySatisfiedIcon sx={{ color: "#18c5ad", fontSize: 64, mb: 2 }} />
                  <Typography variant="h5" sx={{ color: "#18c5ad", fontWeight: 900, mb: 1 }}>
                    Thank you for your feedback!
                  </Typography>
                  <Typography variant="body1" sx={{ color: "#7f9183", fontWeight: 500 }}>
                    We're glad you chose GoDavai.<br />Wishing you a speedy recovery!
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={3} sx={{ mt: 3 }}>
                  {/* PHARMACY CARD */}
                  <Card
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 2,
                      background: '#fff', boxShadow: '0 3px 18px #eaf4fb',
                      borderRadius: 4, p: 2.5, minHeight: 90,
                      border: '1.5px solid #e9f6f5'
                    }}>
                    <Avatar
                      src="/images/pharmacy.png"
                      sx={{ width: 56, height: 56, bgcolor: "#e8faf4", border: '2px solid #13C0A2' }}
                    />
                    <Box flex={1}>
                      <Typography sx={{ fontWeight: 800, color: "#1b8077", fontSize: 17, mb: 0.5 }}>
                        {order.pharmacyName || (typeof order.pharmacy === "object" ? order.pharmacy?.name : order.pharmacy)}
                      </Typography>
                      <Stack direction="row" alignItems="center" spacing={1.2}>
                        <Rating
                          name="pharmacy-rating"
                          value={pharmacyRating || 0}
                          onChange={(_, val) => setPharmacyRating(val)}
                          disabled={ratingSubmitting}
                          size="medium"
                        />
                        <Typography sx={{ fontWeight: 700, color: "#515d53", fontSize: 15 }}>
                          Rate Pharmacy
                        </Typography>
                      </Stack>
                    </Box>
                  </Card>
                  {/* DELIVERY PARTNER CARD */}
                  <Card
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 2,
                      background: '#fff', boxShadow: '0 3px 18px #eaf4fb',
                      borderRadius: 4, p: 2.5, minHeight: 90,
                      border: '1.5px solid #e9f6f5'
                    }}>
                    <Avatar
                      src={deliveryPartner.avatar || "/images/delivery-partner.png"}
                      sx={{ width: 56, height: 56, bgcolor: "#fff2fb", border: '2px solid #FFD43B' }}
                    />
                    <Box flex={1}>
                      <Typography sx={{ fontWeight: 800, color: "#1b8077", fontSize: 17, mb: 0.5 }}>
                        {deliveryPartner.name || "Delivery Partner"}
                      </Typography>
                      <Stack direction="row" alignItems="center" spacing={1.2}>
                        <Rating
                          name="delivery-rating"
                          value={deliveryRating || 0}
                          onChange={(_, val) => setDeliveryRating(val)}
                          disabled={ratingSubmitting}
                          size="medium"
                        />
                        <Typography sx={{ fontWeight: 700, color: "#515d53", fontSize: 15 }}>
                          Rate Partner
                        </Typography>
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                          mt: 1,
                          flexWrap: "wrap",
                          maxWidth: 230,
                          rowGap: 1,
                        }}
                      >
                        {["Polite", "Helpful", "Rude"].map((label) => (
                          <Chip
                            key={label}
                            label={label}
                            clickable
                            color={
                              deliveryBehavior.includes(label.toLowerCase())
                                ? (label === "Rude" ? "error" : "success")
                                : "default"
                            }
                            onClick={() => {
                              setDeliveryBehavior((prev) =>
                                prev.includes(label.toLowerCase())
                                  ? prev.filter(b => b !== label.toLowerCase())
                                  : [...prev, label.toLowerCase()]
                              );
                            }}
                            sx={{
                              fontWeight: 700,
                              fontSize: 14,
                              px: 2.5,
                              bgcolor:
                                deliveryBehavior.includes(label.toLowerCase())
                                  ? (label === "Rude" ? "#ffe7e7" : "#e3ffe5")
                                  : "#f7f8fa",
                              color: deliveryBehavior.includes(label.toLowerCase())
                                ? (label === "Rude" ? "#d32f2f" : "#13855c")
                                : "#4d5863",
                              mb: 1
                            }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  </Card>
                  <Box sx={{ textAlign: "center", mt: 0 }}>
                    <Button
                      variant="outlined"
                      color="success"
                      startIcon={<SupportAgentIcon />}
                      sx={{ fontWeight: 600, textTransform: "none", fontSize: 15, mb: 1 }}
                      onClick={() => setSupportChatOpen(true)}
                    >
                      Contact Support
                    </Button>
                  </Box>
                  <Button
                    onClick={handleRatingSubmit}
                    disabled={!(pharmacyRating && deliveryRating && deliveryBehavior.length > 0) || ratingSubmitting}
                    sx={{
                      bgcolor: "#FFD43B", color: "#222", px: 5, py: 1.3,
                      fontWeight: 900, borderRadius: 3, fontSize: 18,
                      letterSpacing: 1,
                      boxShadow: "0 2px 12px #ffe999",
                      mt: 1, transition: "0.2s"
                    }}
                  >
                    {ratingSubmitting ? <CircularProgress size={20} /> : "Submit Feedback"}
                  </Button>
                </Stack>
              )
            )}
          </CardContent>
          <Button
            onClick={() => navigate("/orders")}
            variant="contained"
            color="primary"
            sx={{
              mt: 3, fontWeight: 700,
              bgcolor: "#13C0A2", fontSize: 17,
              "&:hover": { bgcolor: "#17879c" }
            }}
            fullWidth
          >
            Back to My Orders
          </Button>
        </Card>
      </Box>
      {/* QUOTE MODAL */}
      <Dialog open={quoteDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Quote Available</DialogTitle>
        <DialogContent>
          {prescriptionQuote && (
            <>
              <Typography sx={{ mb: 2 }}>Pharmacy has sent you a quote for your prescription:</Typography>
              <ul>
                {prescriptionQuote.items && prescriptionQuote.items.map((item, idx) => (
                  <li key={idx}>
                    {item.medicineName} – {item.brand} – ₹{item.price} × {item.quantity} [{item.available !== false ? 'Available' : 'Unavailable'}]
                  </li>
                ))}
              </ul>
              <Typography sx={{ mt: 2, fontWeight: 700 }}>Total: ₹{prescriptionQuote.price || prescriptionQuote.approxPrice}</Typography>
              {prescriptionQuote.message && (
                <Typography sx={{ mt: 1, color: "#888" }}>
                  Note: {prescriptionQuote.message}
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="error" onClick={handleRejectQuote} disabled={quoteActionLoading}>
            Reject
          </Button>
          <Button variant="contained" color="success" onClick={handleAcceptQuote} disabled={quoteActionLoading}>
            Accept & Pay
          </Button>
        </DialogActions>
      </Dialog>
      {/* Chat Modal for Delivery Partner */}
      <ChatModal
        open={chatOpen && chatThread === "delivery"}
        onClose={() => setChatOpen(false)}
        orderId={order._id}
        thread="delivery"
        orderStatus={order.status}
        partnerName={chatPartner.name}
        partnerType={chatPartner.type}
        currentRole="user"
      />
      <ChatSupportModal
        open={supportChatOpen}
        onClose={() => setSupportChatOpen(false)}
        orderId={order._id}
      />
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3500}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <MuiAlert
          elevation={6}
          variant="filled"
          onClose={() => setSnackbarOpen(false)}
          severity={snackbarMsg.toLowerCase().includes("fail") ? "error" : "success"}
          sx={{ width: "100%", fontWeight: 700, fontSize: 16 }}
        >
          {snackbarMsg}
        </MuiAlert>
      </Snackbar>
    </Box>
  );
}
