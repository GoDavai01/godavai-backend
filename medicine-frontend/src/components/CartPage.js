import React, { useState, useEffect } from "react";
import {
  Box, Typography, Card, CardContent, CardMedia, Grid, Button, Stack, Divider,
  IconButton, Tooltip, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem, ListItemButton
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import EditIcon from "@mui/icons-material/Edit";
import { useCart } from "../context/CartContext";
import { useNavigate } from "react-router-dom";

// --- Make image URL production safe ---
const getImageUrl = (img) => {
  if (!img)
    return "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg?w=400";
  if (img.startsWith("/uploads/")) return `${img}`; // Use relative URL in production!
  return img;
};

export default function CartPage() {
  const {
    cart, removeFromCart, changeQuantity, clearCart, addToCart, removeOneFromCart,
    selectedPharmacy, setSelectedPharmacy,
  } = useCart();
  const navigate = useNavigate();
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [selectDialogOpen, setSelectDialogOpen] = useState(false);
  const [pharmacies, setPharmacies] = useState([]);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);

  const total = cart.reduce((sum, med) => sum + med.price * med.quantity, 0);

  // Check for "multi-pharmacy" cart
  const cartPharmacyId =
    typeof selectedPharmacy === "object"
      ? selectedPharmacy?._id
      : selectedPharmacy;
  const multiPharmacy = cart.some(
    (item) =>
      item.pharmacy &&
      ((typeof item.pharmacy === "object"
        ? item.pharmacy._id
        : item.pharmacy) !== cartPharmacyId)
  );

  useEffect(() => {
    if (!cart.length && selectedPharmacy) setSelectedPharmacy(null);
  }, [cart, selectedPharmacy, setSelectedPharmacy]);

  // --- Use relative path for production! ---
  const fetchEligiblePharmacies = async () => {
    setLoadingPharmacies(true);
    try {
      const medicines = cart.map((med) => med._id);
      const city = cart[0]?.city || "Delhi";
      const area = "";
      const res = await fetch("/api/pharmacies/available-for-cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, area, medicines }),
      });
      const data = await res.json();
      setPharmacies(data);
    } catch (err) {
      setPharmacies([]);
    }
    setLoadingPharmacies(false);
  };

  useEffect(() => {
    if (selectDialogOpen && cart.length) fetchEligiblePharmacies();
    // eslint-disable-next-line
  }, [selectDialogOpen, cart]);

  const handleChangePharmacy = () => setSelectDialogOpen(true);

  const handleClearCart = () => {
    clearCart();
    setSelectedPharmacy(null);
    setSnackbar({ open: true, message: "Cart and pharmacy reset.", severity: "info" });
  };

  const handleProceedCheckout = () => {
    if (!selectedPharmacy || multiPharmacy) {
      setSelectDialogOpen(true);
      setSnackbar({
        open: true,
        message: multiPharmacy
          ? "Cart contains medicines from multiple pharmacies. Please clear cart."
          : "Please select a pharmacy first.",
        severity: "warning",
      });
      return;
    }
    navigate("/checkout");
  };

  const handleSelectPharmacy = (pharmacy) => {
    setSelectedPharmacy(pharmacy);
    setSelectDialogOpen(false);
    setSnackbar({ open: true, message: `${pharmacy.name} selected.`, severity: "success" });
  };

  if (!cart.length)
    return (
      <Box sx={{ textAlign: "center", pt: 8 }}>
        <ShoppingCartIcon sx={{ fontSize: 60, color: "#FFD43B", mb: 1 }} />
        <Typography variant="h5" sx={{ color: "#FFD43B", mb: 1, fontWeight: 700 }}>
          Your cart is empty.
        </Typography>
        <Button
          variant="contained"
          color="primary"
          sx={{ mt: 2, px: 4, py: 1.2, fontWeight: 700, fontSize: 16, borderRadius: 99 }}
          onClick={() => navigate("/medicines")}
        >
          Browse Medicines
        </Button>
      </Box>
    );

  return (
    <Box sx={{ maxWidth: 550, mx: "auto", mt: 4, mb: 8, px: 1 }}>
      <Typography variant="h5" sx={{
        color: "#FFD43B", fontWeight: 900, mb: 2, fontSize: 30,
        letterSpacing: 1.5, textShadow: "1px 1px 0 #fffde7"
      }}>
        Cart
      </Typography>
      <Card sx={{
        borderRadius: 5, boxShadow: 4, mb: 3, p: 1, background: "#fff"
      }}>
        <CardContent sx={{ p: 2 }}>
          <Grid container spacing={2}>
            {cart.map((med) => (
              <Grid item xs={12} key={med._id}>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <CardMedia
                    component="img"
                    sx={{
                      width: 64, height: 64, objectFit: "contain",
                      bgcolor: "#FFF9DB", borderRadius: 3, boxShadow: 2, border: "1.5px solid #ffd43b"
                    }}
                    image={getImageUrl(med.img)}
                    alt={med.name}
                  />
                  <Box flex={1} sx={{ minWidth: 0 }}>
                    <Typography variant="body1" sx={{ fontWeight: 800, fontSize: 18, color: "#222" }}>
                      {med.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#666", fontSize: 15 }}>
                      ₹{med.price} x {med.quantity}{" "}
                      <span style={{ fontWeight: 700, color: "#23b98e", display: "block" }}>
                        = ₹{med.price * med.quantity}
                      </span>
                    </Typography>
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Tooltip title="Decrease">
                      <span>
                        <IconButton
                          color="primary"
                          sx={{
                            border: "1.5px solid #FFD43B", bgcolor: "#fffde7",
                            borderRadius: 99, width: 36, height: 36
                          }}
                          disabled={med.quantity === 1}
                          onClick={() => removeOneFromCart(med)}
                        >
                          <RemoveIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Typography sx={{
                      minWidth: 28, textAlign: "center", fontWeight: 700,
                      color: "#17879c", fontSize: 18
                    }}>{med.quantity}</Typography>
                    <Tooltip title="Increase">
                      <IconButton
                        color="primary"
                        sx={{
                          border: "1.5px solid #FFD43B", bgcolor: "#fffde7",
                          borderRadius: 99, width: 36, height: 36
                        }}
                        onClick={() => addToCart(med)}
                      >
                        <AddIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  <Tooltip title="Remove">
                    <IconButton color="error" onClick={() => removeFromCart(med)} sx={{ ml: 1 }}>
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Grid>
            ))}
          </Grid>
          <Divider sx={{ my: 3 }} />
          <Typography variant="h6" sx={{
            color: "#FFD43B", fontWeight: 800, textAlign: "right", fontSize: 22
          }}>
            Total: ₹{total}
          </Typography>
        </CardContent>
      </Card>

      {selectedPharmacy ? (
        <Box sx={{ mb: 2, display: "flex", alignItems: "center" }}>
          <Typography sx={{ color: "#13c7ae", fontWeight: 700, fontSize: 17, mr: 1 }}>
            Selected Pharmacy:
          </Typography>
          <Typography sx={{ color: "#17879c", fontWeight: 700, fontSize: 17 }}>
            {selectedPharmacy.name || selectedPharmacy.pharmacyName || "Unknown"}
          </Typography>
          <Tooltip title="Change Pharmacy">
            <IconButton
              color="primary"
              onClick={handleChangePharmacy}
              sx={{ ml: 1 }}
              size="small"
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ) : (
        <Box sx={{ mb: 2 }}>
          <Button
            variant="outlined"
            color="primary"
            onClick={() => setSelectDialogOpen(true)}
            sx={{ fontWeight: 700, textTransform: "none", mt: 1 }}
          >
            Select Pharmacy
          </Button>
        </Box>
      )}

      <Dialog open={selectDialogOpen} onClose={() => setSelectDialogOpen(false)}>
        <DialogTitle>Select a Pharmacy</DialogTitle>
        <DialogContent>
          {loadingPharmacies ? (
            <Typography>Loading pharmacies...</Typography>
          ) : (
            <List>
              {pharmacies.length === 0 ? (
                <Typography>No eligible pharmacies found.</Typography>
              ) : (
                pharmacies.map((pharmacy) => (
                  <ListItem disablePadding key={pharmacy._id}>
                    <ListItemButton onClick={() => handleSelectPharmacy(pharmacy)}>
                      <Typography>{pharmacy.name}</Typography>
                    </ListItemButton>
                  </ListItem>
                ))
              )}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectDialogOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <Stack direction="row" spacing={2} sx={{ mt: 3, justifyContent: "flex-end" }}>
        <Button
          color="error"
          variant="text"
          sx={{ fontWeight: 700, letterSpacing: 0.3, fontSize: 16, borderRadius: 99 }}
          onClick={handleClearCart}
        >
          CLEAR CART
        </Button>
        <Button
          variant="contained"
          color="primary"
          sx={{
            px: 5, py: 1.5, fontWeight: 900, borderRadius: 99, fontSize: 18,
            bgcolor: "#13c7ae", "&:hover": { bgcolor: "#12b2a2" }, boxShadow: 3
          }}
          onClick={handleProceedCheckout}
          disabled={multiPharmacy}
        >
          PROCEED TO CHECKOUT
        </Button>
      </Stack>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2200}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity} sx={{ width: "100%" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
