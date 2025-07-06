// src/components/QuoteReviewModal.js
import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Divider,
} from "@mui/material";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";

export default function QuoteReviewModal({ open, order, onClose }) {
  if (!order) return null;

  let quoteObj = null;
  const isPrescriptionOrder = order.orderType === "prescription" || !!order.prescriptionUrl;

  if (isPrescriptionOrder) {
    if (order.tempQuote && order.tempQuote.items && order.tempQuote.items.length) {
      quoteObj = {
        items: order.tempQuote.items,
        total: order.tempQuote.items.filter(i => i.available !== false).reduce((sum, i) => sum + ((i.price || 0) * (i.quantity || 1)), 0),
        message: order.tempQuote.message,
      };
    } else if (order.quote && order.quote.items && order.quote.items.length) {
      quoteObj = {
        items: order.quote.items,
        total: order.quote.items.filter(i => i.available !== false).reduce((sum, i) => sum + ((i.price || 0) * (i.quantity || 1)), 0),
        message: order.quote.message,
      };
    } else if (Array.isArray(order.quote) && order.quote.length) {
      quoteObj = {
        items: order.quote,
        total: order.quote.filter(i => i.available !== false).reduce(
          (sum, i) => sum + ((i.price || 0) * (i.quantity || 1)), 0
        ),
      };
    } else if (Array.isArray(order.quotes) && order.quotes.length) {
      const latest = order.quotes[order.quotes.length - 1];
      quoteObj = {
        items: latest.items || [],
        total: (latest.items || []).filter(i => i.available !== false).reduce(
          (sum, i) => sum + ((i.price || 0) * (i.quantity || 1)), 0
        ),
        message: latest.message || "",
      };
    }
  } else if (order.quote && order.quote.items && order.quote.items.length) {
    quoteObj = {
      items: order.quote.items,
      total: order.quote.items.filter(i => i.available !== false).reduce(
        (sum, i) => sum + ((i.price || 0) * (i.quantity || 1)), 0
      ),
      message: order.quote.message,
    };
  }

  const items = quoteObj?.items || [];
  const total = quoteObj?.total || 0;
  const message = quoteObj?.message || "";

  const dialogTitle = (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <ReceiptLongIcon style={{ color: "#13C0A2", fontSize: 28 }} />
      Prescription Quote
    </span>
  );

  return (
    <Dialog open={open} maxWidth="sm" fullWidth onClose={onClose} PaperProps={{
      style: { borderRadius: 16, boxShadow: "0px 8px 32px #13C0A229" }
    }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 20 }}>{dialogTitle}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2, color: "#13C0A2", fontWeight: 700 }}>
          Pharmacy: {order.pharmacy?.name || order.pharmacyName || ""}
        </Typography>
        <Box
          sx={{
            mb: 2,
            borderRadius: 2,
            overflowX: "auto",
            boxShadow: 1,
            bgcolor: "#f6fff7",
            maxWidth: "100%",
            width: "100%",
          }}
        >
          <Table size="small" sx={{ minWidth: 530 }}>
            <TableHead>
              <TableRow style={{ background: "#13C0A2" }}>
                <TableCell sx={{ color: "#fff", fontWeight: 700, minWidth: 110 }}>Medicine</TableCell>
                <TableCell sx={{ color: "#fff", fontWeight: 700, minWidth: 90 }}>Brand</TableCell>
                <TableCell sx={{ color: "#fff", fontWeight: 700, minWidth: 65 }}>Price</TableCell>
                <TableCell sx={{ color: "#fff", fontWeight: 700, minWidth: 65 }}>Qty</TableCell>
                <TableCell sx={{ color: "#fff", fontWeight: 700, minWidth: 100 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" style={{ color: "#999" }}>
                    No quote details found.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{item.medicineName || item.name}</TableCell>
                    <TableCell>{item.brand || "-"}</TableCell>
                    <TableCell>
                      {item.available === false ? "-" : `₹${item.price ?? ""}`}
                    </TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell
                      style={{
                        color: item.available === false ? "#d32f2f" : "#198754",
                        fontWeight: 600,
                        letterSpacing: 0.5
                      }}
                    >
                      {item.available === false ? "Unavailable" : "Available"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Box>
        <Divider sx={{ my: 2 }} />
        <Typography
          sx={{
            fontWeight: 800,
            fontSize: 20,
            color: "#13C0A2",
            textAlign: "right",
            letterSpacing: 0.5
          }}
        >
          Total Price: <span style={{ color: "#0c725f" }}>₹{total}</span>
        </Typography>
        {message && (
          <Typography sx={{ mt: 1, color: "#888" }}>
            Note: {message}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={onClose}
          variant="contained"
          color="primary"
          sx={{
            minWidth: 100,
            bgcolor: "#13C0A2",
            borderRadius: 3,
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: 0.4,
            boxShadow: "0px 2px 8px #13C0A229",
            "&:hover": { bgcolor: "#0e9c87" }
          }}
        >
          CLOSE
        </Button>
      </DialogActions>
    </Dialog>
  );
}
