import React, { useEffect, useState } from "react";
import { Box, Typography, Card, CardContent, Button, Stack, CircularProgress } from "@mui/material";
import { useCart } from "../context/CartContext";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

export default function PharmaciesPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setSelectedPharmacy } = useCart();
  const navigate = useNavigate();

  // Always use the latest city from localStorage, fallback to "Delhi"
  const selectedCity = localStorage.getItem("city") || "Delhi";

  useEffect(() => {
    axios.get(`${API_BASE}/api/pharmacies?city=${encodeURIComponent(selectedCity)}`)
      .then(res => setPharmacies(res.data))
      .catch(() => setPharmacies([]))
      .finally(() => setLoading(false));
    // Only runs once on mount (city doesn't change on page)
    // eslint-disable-next-line
  }, []);

  const handleSelect = (pharmacy) => {
    setSelectedPharmacy(pharmacy);
    navigate("/cart");
  };

  if (loading) return <Box sx={{ textAlign: "center", mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ maxWidth: 520, mx: "auto", mt: 4 }}>
      <Typography variant="h5" sx={{ fontWeight: 900, mb: 3, color: "#13c7ae" }}>
        Select a Pharmacy Near You
      </Typography>
      <Stack spacing={2}>
        {pharmacies.map(pharmacy => (
          <Card key={pharmacy._id} sx={{ borderRadius: 4, boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6">{pharmacy.name}</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>{pharmacy.address}</Typography>
              <Button
                variant="contained"
                color="primary"
                sx={{ fontWeight: 700 }}
                onClick={() => handleSelect(pharmacy)}
              >
                Select This Pharmacy
              </Button>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
