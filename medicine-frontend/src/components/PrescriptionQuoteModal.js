// src/components/PrescriptionQuoteModal.js
import React, { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Typography, Stack, Chip, Divider, Snackbar, Alert
} from "@mui/material";
import PaymentIcon from "@mui/icons-material/Payment";
import axios from "axios";

// Use API base from environment variable
const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

export default function PrescriptionQuoteModal({ open, onClose, quote, token, refreshOrders }) {
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  // Razorpay payment handler
  const payNow = async () => {
    setLoading(true);
    try {
      // 1. Create Razorpay backend order
      const razorpayOrder = await axios.post(
        `${API_BASE}/api/payment/razorpay/order`,
        { amount: Math.round(quote.quotePrice * 100), currency: "INR", receipt: "quote_" + quote._id }
      );
      const options = {
        key: "REMOVED_SECRET", // Your Razorpay Key
        amount: razorpayOrder.data.amount,
        currency: "INR",
        name: "GoDavai - Medicine Delivery",
        description: "Prescription Quote Payment",
        order_id: razorpayOrder.data.id,
        handler: async function (response) {
          try {
            // 2. On payment success, mark paid
            await axios.post(
              `${API_BASE}/api/orders/${quote._id}/payment-success`,
              { paymentDetails: response },
              { headers: { Authorization: `Bearer ${token}` } }
            );
            // 3. Convert prescription to normal order
            const convertRes = await axios.post(
              `${API_BASE}/api/prescriptions/${quote._id}/convert-to-order`,
              {},
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (convertRes.data && convertRes.data.orderId) {
              // 4. Redirect to the new normal order tracking page
              window.location.href = `/orders/${convertRes.data.orderId}`;
              return;
            } else {
              setSnackbar({ open: true, message: "Payment done, but failed to update order!", severity: "error" });
            }
          } catch (error) {
            setSnackbar({ open: true, message: "Payment succeeded but order update failed!", severity: "error" });
          }
          setLoading(false);
          onClose();
          refreshOrders && refreshOrders();
        },
        prefill: {
          name: quote.user?.name || "",
          email: quote.user?.email || "",
        },
        theme: { color: "#13c7ae" },
        modal: { ondismiss: () => setLoading(false) },
      };
      setLoading(false);

      // PRODUCTION SAFETY: check Razorpay loaded (optional, but best practice)
      if (window.Razorpay) {
        const rzp = new window.Razorpay(options);
        rzp.open();
      } else {
        setSnackbar({ open: true, message: "Payment gateway not loaded.", severity: "error" });
      }
    } catch (err) {
      setSnackbar({ open: true, message: "Failed to initiate payment.", severity: "error" });
      setLoading(false);
    }
  };

  if (!quote) return null;

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>
          Prescription Quote Ready <PaymentIcon sx={{ color: "#FFD43B", ml: 1 }} />
        </DialogTitle>
        <DialogContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>
            The pharmacy has sent a quote for your prescription.
          </Typography>
          <Stack spacing={1} sx={{ mb: 2 }}>
            {quote.items.map((item, i) => (
              <Chip
                key={i}
                label={`${item.name} × ${item.quantity} (${item.status === "available" ? "Available" : "Unavailable"})`}
                color={item.status === "available" ? "success" : "error"}
                sx={{ mb: 1, fontWeight: 600 }}
              />
            ))}
          </Stack>
          <Divider sx={{ my: 1 }} />
          <Typography variant="h6" sx={{ color: "#17879c", fontWeight: 700, mb: 2 }}>
            Total Quoted Price: ₹{quote.quotePrice}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            onClick={async () => {
              setLoading(true);
              try {
                await axios.put(
                  `${API_BASE}/api/orders/${quote._id}/reject`,
                  {},
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                setSnackbar({ open: true, message: "Quote Rejected.", severity: "info" });
                setTimeout(() => {
                  setLoading(false);
                  onClose();
                  refreshOrders && refreshOrders();
                }, 1200);
              } catch (err) {
                setSnackbar({ open: true, message: "Rejection failed!", severity: "error" });
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            Reject
          </Button>
          <Button
            variant="contained"
            onClick={payNow}
            disabled={loading}
            sx={{ bgcolor: "#13c7ae", fontWeight: 700 }}
          >
            {loading ? "Processing..." : `Accept & Pay ₹${quote.quotePrice}`}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={1800}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
