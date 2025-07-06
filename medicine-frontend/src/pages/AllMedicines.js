// src/pages/AllMedicines.js
import React, { useEffect, useState } from "react";
import {
  Box, Typography, Card, CardContent, Button, Grid, Stack, Chip, CardActions
} from "@mui/material";
import { useCart } from "../context/CartContext";
import { ShoppingCart } from "@mui/icons-material";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const getImageUrl = (img) => {
  if (!img) return "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg?w=400";
  if (img.startsWith("/uploads/")) return `${API_BASE_URL}${img}`;
  return img;
};

export default function AllMedicines() {
  const { selectedCity, selectedArea, addToCart } = useCart();
  const [medicines, setMedicines] = useState([]);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    setFetchError(false);
    const params = new URLSearchParams();
    if (selectedCity) params.append("city", selectedCity);
    if (selectedArea) params.append("area", selectedArea);
    fetch(`/api/medicines/all?${params.toString()}`)
      .then(res => res.json())
      .then(setMedicines)
      .catch(() => {
        setMedicines([]);
        setFetchError(true);
      });
  }, [selectedCity, selectedArea]);

  return (
    <Box sx={{ maxWidth: 500, mx: "auto", p: 1, bgcolor: "#f7f9fa", minHeight: "100vh" }}>
      <Typography variant="h4" fontWeight={900} sx={{ color: "#13C0A2", mb: 2, mt: 2 }}>
        <span role="img" aria-label="star" style={{ marginRight: 4 }}>⭐</span>
        All Medicines in <span style={{ color: "#1188A3" }}>{selectedCity || "your city"}</span>
      </Typography>
      <Stack spacing={2}>
        {fetchError ? (
          <Typography color="error" align="center">Failed to load medicines.</Typography>
        ) : medicines.length === 0 ? (
          <Typography color="text.secondary" align="center">No medicines available.</Typography>
        ) : (
          medicines.map(med => (
            <Card
              key={med._id}
              sx={{
                borderRadius: 4,
                boxShadow: 1,
                display: "flex",
                alignItems: "center",
                px: 2,
                py: 1.5,
                minHeight: 90,
                background: "#fff",
                justifyContent: "space-between"
              }}
            >
              <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
                <Chip
                  label={med.pharmacy?.name || med.pharmacyName || "Pharmacy"}
                  size="small"
                  sx={{
                    bgcolor: "#FFF9DB",
                    color: "#E0A800",
                    fontWeight: 700,
                    mb: 0.5,
                    maxWidth: 140,
                    fontSize: 13,
                    borderRadius: 2
                  }}
                />
                <Typography fontWeight={700} fontSize={17} color="#07908A" noWrap>
                  {med.name}
                </Typography>
                <Typography fontWeight={700} color="#13C0A2" fontSize={16} mt={0.2}>
                  ₹{med.price}
                </Typography>
              </Stack>
              <CardActions sx={{ p: 0, m: 0 }}>
                <Button
                  variant="contained"
                  size="medium"
                  startIcon={<ShoppingCart />}
                  sx={{
                    bgcolor: "linear-gradient(90deg, #13C0A2 60%, #FFD43B 100%)",
                    color: "#fff",
                    fontWeight: 900,
                    px: 2,
                    minWidth: 120,
                    minHeight: 44,
                    fontSize: 15,
                    borderRadius: 3,
                    boxShadow: "0 2px 8px 0 rgba(13,192,162,0.07)",
                    "&:hover": {
                      bgcolor: "#13C0A2",
                      color: "#FFD43B",
                    },
                    whiteSpace: "nowrap"
                  }}
                  onClick={() => {
                    addToCart(med);
                    setSnackbar({
                      open: true,
                      message: `${med.name} added to cart!`,
                      severity: "success"
                    });
                  }}
                >
                  ADD TO CART
                </Button>
              </CardActions>
            </Card>
          ))
        )}
      </Stack>
    </Box>
  );
}
