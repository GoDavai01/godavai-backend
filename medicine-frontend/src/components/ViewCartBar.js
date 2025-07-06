// src/components/ViewCartBar.js
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Button, Typography, Badge, Paper, Slide } from "@mui/material";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import { useCart } from "../context/CartContext";

const HIDDEN_ROUTES = ["/profile", "/checkout", "/cart"]; // Hide on these

export default function ViewCartBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { cart } = useCart();

  const total = cart.reduce((sum, med) => sum + med.price * med.quantity, 0);

  if (
    HIDDEN_ROUTES.includes(location.pathname) ||
    !cart.length
  ) return null;

  return (
    <Slide direction="up" in={cart.length > 0} mountOnEnter unmountOnExit>
      <Paper
        elevation={8}
        sx={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 60,
          zIndex: 1200,
          px: { xs: 2, sm: 10 },
          py: 1,
          bgcolor: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 -2px 16px rgba(0,0,0,0.12)",
          minHeight: 64,
        }}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <Badge badgeContent={cart.length} color="primary">
            <ShoppingCartIcon fontSize="large" />
          </Badge>
          <Typography fontWeight={700} fontSize="1.1rem">
            {cart.length} {cart.length === 1 ? "item" : "items"}
          </Typography>
          <Typography color="text.secondary" sx={{ ml: 2, fontSize: "1rem" }}>
            ₹{total}
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="large"
          color="primary"
          sx={{
            borderRadius: "2rem",
            px: 4,
            py: 1.5,
            fontWeight: 600,
            fontSize: "1.1rem",
            bgcolor: "#13c7ae",
            "&:hover": { bgcolor: "#12b2a2" },
            boxShadow: "0 4px 16px #13C0A260",
          }}
          onClick={() => navigate("/cart")}
        >
          View Cart
        </Button>
      </Paper>
    </Slide>
  );
}
