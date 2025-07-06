// src/components/MyOrdersPage.js
import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import {
  Box,
  Typography,
  Card,
  Button,
  Stack,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  IconButton,
} from "@mui/material";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { useNavigate } from "react-router-dom";
import QuoteReviewModal from "./QuoteReviewModal";
import { useCart } from "../context/CartContext";
import Tooltip from "@mui/material/Tooltip";
import PrescriptionUploadModal from "./PrescriptionUploadModal";
import CloseIcon from "@mui/icons-material/Close";

// --- Robust util: always store IDs as string! ---
function getHiddenRejectionIds() {
  try {
    return JSON.parse(localStorage.getItem("hiddenRejectionPopupOrderIds") || "[]").map(String);
  } catch {
    return [];
  }
}
function addHiddenRejectionId(orderId) {
  const ids = getHiddenRejectionIds();
  const idStr = String(orderId);
  if (!ids.includes(idStr)) {
    ids.push(idStr);
    localStorage.setItem("hiddenRejectionPopupOrderIds", JSON.stringify(ids));
  }
}

function formatOrderDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const opts = { day: "numeric", month: "long" };
  const date = d.toLocaleDateString("en-IN", opts);
  let hour = d.getHours();
  const min = d.getMinutes().toString().padStart(2, "0");
  const ampm = hour >= 12 ? "pm" : "am";
  hour = hour % 12 || 12;
  return `${date}, ${hour}:${min}${ampm}`;
}

function getTotalPrice(order) {
  if (order.tempQuote && Array.isArray(order.tempQuote.items) && order.tempQuote.items.length)
    return order.tempQuote.items
      .filter(i => i.available !== false)
      .reduce((a, b) => a + ((b.price || 0) * (b.quantity || 1)), 0);

  if (order.tempQuote && typeof order.tempQuote.approxPrice === "number")
    return order.tempQuote.approxPrice;

  if (order.quote && Array.isArray(order.quote.items) && order.quote.items.length)
    return order.quote.items
      .filter(i => i.available !== false)
      .reduce((a, b) => a + ((b.price || 0) * (b.quantity || 1)), 0);

  if (order.quote && typeof order.quote.price === "number")
    return order.quote.price;

  if (Array.isArray(order.quote) && order.quote.length)
    return order.quote
      .filter(i => i.available !== false)
      .reduce((a, b) => a + ((b.price || 0) * (b.quantity || 1)), 0);

  if (Array.isArray(order.quotes) && order.quotes.length && typeof order.quotes[order.quotes.length - 1]?.price === "number")
    return order.quotes[order.quotes.length - 1].price;

  if (order.tempQuote && Array.isArray(order.tempQuote.items))
    return order.tempQuote.items
      .filter(i => i.available !== false)
      .reduce((a, b) => a + ((b.price || 0) * (b.quantity || 1)), 0);

  return 0;
}

function getQuoteType(order) {
  let items = [];
  if (order.tempQuote && order.tempQuote.items && order.tempQuote.items.length) {
    items = order.tempQuote.items;
  } else if (order.quote && order.quote.items && order.quote.items.length) {
    items = order.quote.items;
  } else if (Array.isArray(order.quote) && order.quote.length) {
    items = order.quote;
  } else if (Array.isArray(order.quotes) && order.quotes.length && order.quotes[order.quotes.length - 1]?.items?.length) {
    items = order.quotes[order.quotes.length - 1].items;
  }
  if (!items.length) return "none";
  if (items.every(i => i.available !== false)) return "full";
  if (items.some(i => i.available === false)) return "partial";
  return "none";
}

function groupSplitOrders(orders) {
  const orderMap = {};
  const result = [];
  orders.forEach(order => {
    orderMap[order._id] = { ...order, splits: [] };
  });
  orders.forEach(order => {
    if (order.parentOrder && orderMap[order.parentOrder]) {
      orderMap[order.parentOrder].splits.push(order);
    }
  });
  const used = new Set();
  orders.forEach(order => {
    if (order.parentOrder) {
      used.add(order._id);
    } else {
      result.push(orderMap[order._id]);
      orderMap[order._id].splits.forEach(split => used.add(split._id));
    }
  });
  orders.forEach(order => {
    if (!used.has(order._id)) result.push(order);
  });
  return result;
}

export default function MyOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);

  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [pendingRejectOrderId, setPendingRejectOrderId] = useState(null);

  const prevOrdersRef = useRef([]);
  const { setCart, setSelectedPharmacy } = useCart();
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const userId = user._id || user.userId;

  // --- PHARMACY REJECTION POPUP LOGIC ---
  const [showPharmacyRejectionPopup, setShowPharmacyRejectionPopup] = useState(false);
  const [rejectedPrescriptionOrder, setRejectedPrescriptionOrder] = useState(null);
  const [reuploadModalOpen, setReuploadModalOpen] = useState(false);
  const [reuploadMode, setReuploadMode] = useState("manual");
  const [reuploadOrderData, setReuploadOrderData] = useState(null);

  // 1. Initial load spinner
  useEffect(() => {
    const fetchInitial = async () => {
      setLoading(true);
      await fetchOrders();
      setLoading(false);
    };
    fetchInitial();
    // eslint-disable-next-line
  }, [userId]);

  // 2. Poll (no spinner)
  useEffect(() => {
    const poll = setInterval(() => {
      fetchOrders();
    }, 15000);
    return () => clearInterval(poll);
    // eslint-disable-next-line
  }, [userId]);

  const fetchOrders = async () => {
    try {
      if (!userId) return;
      const res = await axios.get(`/api/allorders/myorders-userid/${userId}`);
      let presRes = [];
      try {
        presRes = await axios.get("/api/prescriptions/user-orders", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        });
      } catch {}
      let presOrders = (presRes.data || []).map(p => ({ ...p, orderType: "prescription" }));
      const ids = new Set(res.data.map(o => String(o._id)));
      presOrders = presOrders.filter(po => !ids.has(String(po._id)));
      const allOrders = [...res.data, ...presOrders];
      allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      prevOrdersRef.current = allOrders;
      setOrders(allOrders);
    } catch (err) {
      setOrders([]);
      // console.error("MYORDERS FETCH ERROR:", err?.response?.data || err.message); // <-- REMOVE this line
    }
  };

 // --- Show "Pharmacy Rejected" popup ONLY ONCE per order (BULLETPROOF) ---
useEffect(() => {
  const hiddenIds = getHiddenRejectionIds();
  let rejected = null;
  // Find a rejected prescription order that isn't hidden, manual only
  for (const o of orders) {
    // Defensive: allow o to be object or array (if bug!)
    const oid = String(o._id || (Array.isArray(o) && o[0]) || "");
    const status = o.status || (Array.isArray(o) && o[1]);
    const uploadType = o.uploadType || (Array.isArray(o) && o[2]);
    if (
      o.orderType === "prescription" &&
      (status === "cancelled" || status === "rejected") &&
      uploadType === "manual"
    ) {
      if (!hiddenIds.includes(oid)) {
        rejected = { ...o, _id: oid };
        break;
      }
    }
  }
  // If can't get _id, auto-hide ALL future popups
  if (!rejected || !rejected._id) {
    setShowPharmacyRejectionPopup(false);
    setRejectedPrescriptionOrder(null);
    return;
  }
  if (!showPharmacyRejectionPopup || (rejectedPrescriptionOrder && String(rejectedPrescriptionOrder._id) !== String(rejected._id))) {
    setShowPharmacyRejectionPopup(true);
    setRejectedPrescriptionOrder(rejected);
  }
}, [orders]);


  // When user closes, remember for this order (forever, survives reload)
  const handleClosePharmacyRejectionPopup = () => {
  if (rejectedPrescriptionOrder?._id) {
    addHiddenRejectionId(String(rejectedPrescriptionOrder._id)); // always string
  }
  setShowPharmacyRejectionPopup(false);
  setRejectedPrescriptionOrder(null);
};

  const handleOrderAgain = (order) => {
    const pharmacyId =
      (order.pharmacy && order.pharmacy._id) ||
      order.pharmacyId ||
      order.pharmacy;
    if (pharmacyId) {
      navigate(`/medicines/${pharmacyId}`);
    } else {
      setSnackbar({
        open: true,
        message: "Pharmacy information missing. Unable to reorder.",
        severity: "error",
      });
    }
  };

  const handleAcceptAndPay = (order) => {
    if (order.quote && order.quote.items) {
      setCart(
        order.quote.items.filter(i => i.available !== false).map(i => ({
          _id: i._id || i.medicineId || Math.random().toString(),
          name: i.medicineName,
          brand: i.brand,
          price: i.price,
          quantity: i.quantity,
          img: "",
        }))
      );
    }
    setSelectedPharmacy(order.pharmacy);
    navigate(`/checkout?orderId=${order._id}`);
    setQuoteModalOpen(false);
    setSelectedOrder(null);
  };

  const handleUserConfirmRespond = async (orderId, type, reason = "") => {
    try {
      if (type === "rejected" && !reason.trim()) {
        setSnackbar({ open: true, message: "Reason is required for rejection", severity: "error" });
        return;
      }
      const body =
        type === "rejected"
          ? { response: "rejected", reason }
          : { response: "accepted" };

      await axios.post(`/api/prescriptions/respond/${orderId}`, body);

      setSnackbar({
        open: true,
        message: type === "rejected" ? "Order rejected." : "Order confirmed.",
        severity: type === "rejected" ? "info" : "success",
      });
      setOrders((prev) =>
        prev.map((o) =>
          o._id === orderId
            ? {
                ...o,
                status: type === "rejected" ? "rejected" : "confirmed",
              }
            : o
        )
      );
    } catch (err) {
      setSnackbar({ open: true, message: "Failed to submit response", severity: "error" });
    }
    setRejectSubmitting(false);
    setRejectReason("");
    setRejectDialogOpen(false);
    setPendingRejectOrderId(null);
  };

  const groupedOrders = groupSplitOrders(orders);

  // Renders as before...
  const renderOrderCard = (o, splitBadge = null, uniqueKey = null) => (
    <Card
      key={uniqueKey || o._id}
      sx={{
        borderRadius: 4,
        boxShadow: 2,
        bgcolor: "#fff",
        p: 2.3,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        border: "1.5px solid #eafaf3",
        minWidth: 280,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
        <Typography fontWeight={700} fontSize={17} color="#13C0A2" sx={{ mr: 1 }}>
          {o.pharmacy?.name || o.pharmacy}
        </Typography>
        {o.orderType === "prescription" && (
          <span style={{ color: "#f18e1b", fontWeight: 700, marginLeft: 8 }}>
            (Prescription)
          </span>
        )}
        <Typography fontSize={13} color="#555" sx={{ ml: 1 }}>
          {(o.address?.area || o.address?.city || "")}
        </Typography>
        {splitBadge && (
          <Tooltip title={splitBadge}>
            <Chip
              label={
                <span
                  style={{
                    display: "inline-block",
                    maxWidth: 140,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    verticalAlign: "middle",
                  }}
                >
                  {splitBadge}
                </span>
              }
              size="small"
              sx={{
                ml: 1,
                bgcolor: splitBadge.includes("Parent") ? "#1976d2" : "#13C0A2",
                color: "#fff",
                fontWeight: 700,
                borderRadius: 1,
                fontSize: 13,
                maxWidth: 150,
              }}
            />
          </Tooltip>
        )}
      </Box>
      <Typography fontSize={14} color="#555" sx={{ mb: 0.2 }}>
        Placed on: <b>{formatOrderDate(o.createdAt)}</b>
      </Typography>
      {/* PRESCRIPTION ORDER */}
      {o.orderType === "prescription" ? (
        <>
          <Typography fontSize={14} sx={{ mt: 1 }}>
            <b>Prescription:</b>{" "}
            {o.prescriptionUrl ? (
              <a
                href={o.prescriptionUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#1976d2", textDecoration: "underline" }}
              >
                View
              </a>
            ) : (
              "Not Available"
            )}
          </Typography>
          {(o.status === "quoted" || o.status === "pending_user_confirm") && (
            <Box
              sx={{
                mt: 1.2,
                mb: 0.3,
                bgcolor: "#F8FCF9",
                borderRadius: 2,
                border: "1.5px solid #e2f7eb",
                p: 2,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.3 }}>
                <Typography sx={{ color: "#FFD43B", fontWeight: 700, fontSize: 15, mr: 1 }}>
                  Quote Ready!
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<ReceiptLongIcon />}
                  size="small"
                  sx={{
                    bgcolor: "#13C0A2",
                    color: "#fff",
                    borderRadius: 3,
                    fontWeight: 700,
                    textTransform: "none",
                    boxShadow: "0px 2px 8px #13C0A229",
                    fontSize: 14,
                    py: 0.3,
                    px: 1.7,
                    minWidth: 0,
                    "&:hover": { bgcolor: "#0e9c87" }
                  }}
                  onClick={() => {
                    setSelectedOrder(o);
                    setQuoteModalOpen(true);
                  }}
                >
                  View Quote
                </Button>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.1 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
                  Total Price: <span style={{ color: "#151515" }}>₹{getTotalPrice(o)}</span>
                </Typography>
                {getQuoteType(o) === "full" && (
                  <span style={{
                    marginLeft: 4,
                    color: "#28a745",
                    fontWeight: 600,
                    fontSize: 13,
                    background: "#eafaf3",
                    padding: "2.5px 12px",
                    borderRadius: 12
                  }}>
                    All Available
                  </span>
                )}
                {getQuoteType(o) === "partial" && (
                  <span style={{
                    marginLeft: 4,
                    color: "#e67e22",
                    fontWeight: 600,
                    fontSize: 13,
                    background: "#fff6e3",
                    padding: "2.5px 10px",
                    borderRadius: 12
                  }}>
                    Partial Fulfillment
                  </span>
                )}
              </Box>
              {getQuoteType(o) === "full" && (
                <Typography
                  sx={{
                    color: "#27ae60",
                    fontWeight: 600,
                    fontSize: 13.7,
                    bgcolor: "#e8f6ef",
                    borderRadius: 1.5,
                    px: 1.2,
                    py: 0.6,
                  }}
                >
                  ✅ All medicines are available at this pharmacy. Tap <b>"Accept & Pay"</b> to get your order delivered fast!
                </Typography>
              )}
              {getQuoteType(o) === "partial" && (
                <Typography
                  sx={{
                    color: "#e67e22",
                    fontWeight: 500,
                    fontSize: 13.3,
                    bgcolor: "#fff8eb",
                    borderRadius: 1.5,
                    px: 1.2,
                    py: 0.6,
                  }}
                >
                  Only some medicines are available. You can pay for available items, or wait/split the order.
                </Typography>
              )}
              {o.quote && o.quote.items && o.quote.items.some(i => i.available === false) && (
                <Typography fontSize={13} color="#d32f2f" sx={{ mt: 0.5 }}>
                  Unavailable: {o.quote.items.filter(i => i.available === false).map(i => i.medicineName).join(", ")}
                </Typography>
              )}
              {o.status === "pending_user_confirm" && (
                <Box sx={{ mt: 1.8, mb: 0.5 }}>
                  <Stack direction="column" spacing={1.2} alignItems="stretch">
                    <Button
                      variant="contained"
                      color="success"
                      fullWidth
                      disabled={rejectSubmitting}
                      onClick={() => handleAcceptAndPay(o)}
                      sx={{
                        fontWeight: 700,
                        fontSize: 16,
                        borderRadius: 2.5,
                        py: 1.1,
                        letterSpacing: 0.7,
                        boxShadow: "0px 2px 12px #1abb9979"
                      }}
                    >
                      ACCEPT & PAY
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      fullWidth
                      disabled={rejectSubmitting}
                      onClick={() => {
                        setRejectDialogOpen(true);
                        setPendingRejectOrderId(o._id);
                        setRejectReason("");
                      }}
                      sx={{
                        fontWeight: 700,
                        fontSize: 16,
                        borderRadius: 2.5,
                        py: 1,
                        border: "2px solid #f44336",
                        color: "#f44336",
                        background: "#fff",
                        '&:hover': {
                          background: "#fff4f4"
                        }
                      }}
                    >
                      Reject
                    </Button>
                  </Stack>
                </Box>
              )}
            </Box>
          )}
          <Typography fontWeight={700} fontSize={15} sx={{ color: "#1976d2", mr: 2, mt: 1 }}>
            Status:{" "}
            <span style={{ textTransform: "capitalize", marginLeft: 3 }}>
              {o.status}
            </span>
          </Typography>
        </>
      ) : (
        <>
          <Typography fontWeight={700} fontSize={15} sx={{ mb: 0.5 }}>
            Items:
            <span style={{ fontWeight: 400, marginLeft: 4 }}>
              {o.items
                ? o.items
                    .map(i => `${i.name || i.medicineName} (${i.quantity || i.qty || "-"})`)
                    .join(", ")
                : ""}
            </span>
          </Typography>
          <Typography fontSize={15} color="#232323">
            <b>Total Price:</b> ₹{o.total}
          </Typography>
        </>
      )}
      <Typography fontSize={14} color="#232323">
        <b>Address:</b>{" "}
        {o.address?.addressLine ||
          o.address?.fullAddress ||
          (o.address ? JSON.stringify(o.address) : "")}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
        {o.orderType !== "prescription" && (
          <Typography fontWeight={700} fontSize={15} sx={{ color: "#1976d2", mr: 2 }}>
            {o.status === "quoted" ? (
              <span style={{ color: "#FFD43B" }}>
                Quote Ready!
                <Button
                  variant="outlined"
                  size="small"
                  sx={{ ml: 1 }}
                  onClick={() => {
                    setSelectedOrder(o);
                    setQuoteModalOpen(true);
                  }}
                >
                  View & Accept/Reject
                </Button>
              </span>
            ) : (
              <>
                Status:{" "}
                <span style={{ textTransform: "capitalize", marginLeft: 3 }}>
                  {o.status || "Placed"}
                </span>
              </>
            )}
          </Typography>
        )}
        <Button
          variant="contained"
          size="small"
          sx={{
            bgcolor: "#13C0A2",
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            borderRadius: 2.5,
            textTransform: "none",
            boxShadow: 1,
            ml: "auto",
            "&:hover": { bgcolor: "#0e9c87" },
          }}
          onClick={() => handleOrderAgain(o)}
        >
          Order Again
        </Button>
      </Box>
    </Card>
  );

  // Debug safety: crash if orders is accidentally set to array of arrays!
  if (
  orders.length &&
  (!orders[0] || typeof orders[0] !== "object" || Array.isArray(orders[0]))
) {
  throw new Error("BUG: orders should be an array of objects. Got: " + JSON.stringify(orders[0]));
}

  return (
    <Box sx={{ bgcolor: "#f9fafb", minHeight: "100vh", pb: 12, pt: 3 }}>
      <Box sx={{ maxWidth: 480, mx: "auto", px: 2 }}>
        <Typography fontWeight={800} fontSize={24} sx={{ mb: 2, mt: 1 }}>
          My Orders
        </Typography>
        {loading ? (
          <Typography color="text.secondary">Loading...</Typography>
        ) : groupedOrders.length === 0 ? (
          <Typography color="text.secondary">No orders yet.</Typography>
        ) : (
          <Stack spacing={2}>
            {groupedOrders.map((order, idx) => {
              if (order.splits && order.splits.length > 0) {
                return (
                  <React.Fragment key={`parent-${order._id}`}>
                    {renderOrderCard(order, "Parent Order (Split)", `parent-${order._id}`)}
                    {order.splits
                      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
                      .map((split, splitIdx) =>
                        renderOrderCard(
                          split,
                          `Split Order (Part of: #${String(order._id).slice(-6).toUpperCase()})`,
                          `split-${split._id}-parent-${order._id}`
                        )
                      )}
                  </React.Fragment>
                );
              } else {
                return renderOrderCard(
                  order,
                  order.parentOrder
                    ? `Split Order (Part of: #${String(order.parentOrder).slice(-6).toUpperCase()})`
                    : null,
                  order.parentOrder
                    ? `split-${order._id}-parent-${order.parentOrder}`
                    : `single-${order._id}`
                );
              }
            })}
          </Stack>
        )}

        {/* --- REJECT DIALOG (ONLY FOR PENDING_USER_CONFIRM) --- */}
        <Dialog
          open={rejectDialogOpen}
          onClose={() => {
            setRejectDialogOpen(false);
            setRejectReason("");
          }}
        >
          <DialogTitle>Reject Order</DialogTitle>
          <DialogContent>
            <Typography sx={{ mb: 1 }}>
              Please provide a reason for rejecting this order:
            </Typography>
            <textarea
              style={{
                width: "100%",
                minHeight: 60,
                border: "1.5px solid #f44336",
                borderRadius: 6,
                padding: 10,
                fontSize: 16,
                color: "#222"
              }}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Enter reason (required)"
              disabled={rejectSubmitting}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRejectDialogOpen(false)} disabled={rejectSubmitting}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="error"
              disabled={!rejectReason.trim() || rejectSubmitting}
              onClick={async () => {
                setRejectSubmitting(true);
                await handleUserConfirmRespond(pendingRejectOrderId, "rejected", rejectReason.trim());
                setRejectSubmitting(false);
              }}
              sx={{ minWidth: 130, fontWeight: 700, fontSize: 16, borderRadius: 3 }}
            >
              Reject Order
            </Button>
          </DialogActions>
        </Dialog>

        {/* --- PHARMACY REJECTION POPUP --- */}
        <Dialog
          open={showPharmacyRejectionPopup}
          onClose={handleClosePharmacyRejectionPopup}
          maxWidth="xs"
          fullWidth
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 2,
              pb: 1,
            }}
          >
            <Typography variant="h6" fontWeight={700}>
              Pharmacy Rejected Your Prescription
            </Typography>
            <IconButton
              aria-label="close"
              onClick={handleClosePharmacyRejectionPopup}
              sx={{
                color: "#888",
                ml: 2,
              }}
              size="large"
            >
              <CloseIcon />
            </IconButton>
          </Box>
          <DialogContent>
            <Typography sx={{ mb: 2 }}>
              The pharmacy you selected couldn't fulfill your prescription.<br />
              What would you like to do next?
            </Typography>
            <Stack spacing={2}>
              <Button
                variant="contained"
                color="primary"
                sx={{ fontWeight: 700, borderRadius: 2 }}
                onClick={() => {
                  if (rejectedPrescriptionOrder?._id) addHiddenRejectionId(rejectedPrescriptionOrder._id);
                  setShowPharmacyRejectionPopup(false);
                  setReuploadMode("manual");
                  setReuploadOrderData(rejectedPrescriptionOrder);
                  setReuploadModalOpen(true);
                }}
              >
                Choose Another Pharmacy
              </Button>
              <Button
                variant="outlined"
                color="primary"
                sx={{ fontWeight: 700, borderRadius: 2 }}
                onClick={() => {
                  if (rejectedPrescriptionOrder?._id) addHiddenRejectionId(rejectedPrescriptionOrder._id);
                  setShowPharmacyRejectionPopup(false);
                  setReuploadMode("auto");
                  setReuploadOrderData(rejectedPrescriptionOrder);
                  setReuploadModalOpen(true);
                }}
              >
                Let GoDavai Handle It
              </Button>
            </Stack>
          </DialogContent>
        </Dialog>

        {/* --- REUPLOAD PRESCRIPTION MODAL --- */}
        <PrescriptionUploadModal
          open={reuploadModalOpen}
          onClose={() => setReuploadModalOpen(false)}
          userCity={reuploadOrderData?.address?.city || ""}
          userArea={reuploadOrderData?.address?.area || ""}
          afterOrder={() => setReuploadModalOpen(false)}
          initialMode={reuploadMode}
          initialNotes={reuploadOrderData?.notes || ""}
          initialFileUrl={reuploadOrderData?.prescriptionUrl || ""}
          initialAddress={reuploadOrderData?.address || {}}
        />

        {/* --- QUOTE REVIEW MODAL --- */}
        <QuoteReviewModal
          open={quoteModalOpen}
          order={selectedOrder}
          onClose={() => setQuoteModalOpen(false)}
          onAccept={() => handleAcceptAndPay(selectedOrder)}
        />

        {/* Snackbar for Order Again, etc */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={2200}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
        >
          <Alert severity={snackbar.severity} sx={{ width: "100%" }}>
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}
