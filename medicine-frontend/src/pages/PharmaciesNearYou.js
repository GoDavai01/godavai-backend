// src/pages/PharmaciesNearYou.js
import React, { useEffect, useState } from "react";
import {
  Box, Typography, Card, Button, Stack, Chip, Fab,
  Rating, MenuItem, Select, InputLabel, FormControl, Divider
} from "@mui/material";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import PrescriptionUploadModal from "../components/PrescriptionUploadModal";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useNavigate } from "react-router-dom";

// Demo Areas (update as needed)
const AREA_MAP = {
  Mumbai: ["Andheri", "Powai", "Bandra", "Borivali", "Goregaon"],
  Delhi: ["CP", "Saket", "Karol Bagh", "Dwarka", "Rohini"],
  Bangalore: ["Koramangala", "Indiranagar", "Whitefield"],
  Chennai: ["T Nagar", "Velachery", "Anna Nagar"],
};

const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

export default function PharmaciesNearYou() {
  const [city, setCity] = useState(localStorage.getItem("city") || "Mumbai");
  const [area, setArea] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    const handleStorage = () => {
      const newCity = localStorage.getItem("city") || "Mumbai";
      setCity(newCity);
      setArea("");
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    setLoading(true);
    let url = `${API_BASE}/api/pharmacies?city=${encodeURIComponent(city)}`;
    if (area) url += `&area=${encodeURIComponent(area)}`;
    fetch(url)
      .then(res => res.json())
      .then(data => setPharmacies(data))
      .catch(() => setPharmacies([]))
      .finally(() => setLoading(false));
  }, [city, area, sortBy]);

  const areaList = AREA_MAP[city] || [];
  const minDeliveryTime = 13;
  const maxDeliveryTime = 29;

  return (
    <Box sx={{ bgcolor: "#f9fafb", minHeight: "100vh", pb: 12, pt: 2 }}>
      <Box sx={{ maxWidth: 480, mx: "auto", px: 0 }}>
        {/* Offer banner */}
        <Box
          sx={{
            bgcolor: "#eafcf4",
            color: "#13C0A2",
            fontWeight: 800,
            fontSize: 18,
            borderRadius: 6,
            px: 2.5,
            py: 1.6,
            mb: 2,
            display: "flex",
            alignItems: "center",
            boxShadow: 1,
            gap: 1,
            mx: 2
          }}
        >
          <span role="img" aria-label="lightning" style={{ color: "#FFD43B", fontSize: 22, marginRight: 10 }}>⚡</span>
          <span>Flat 15% OFF on health supplements! Use code <b>HEALTH15</b></span>
        </Box>
        {/* Heading */}
        <Stack direction="row" alignItems="center" spacing={1} mb={1} mx={2}>
          <LocalPharmacyIcon sx={{ color: "#FFD43B", fontSize: 28, mr: 1 }} />
          <Typography fontWeight={900} fontSize={23} color="#1199a6" sx={{ letterSpacing: 0.5 }}>
            Pharmacies Near You
          </Typography>
          <Chip
            label={city}
            sx={{
              bgcolor: "#13C0A2",
              color: "#fff",
              ml: 1,
              fontWeight: 700,
              fontSize: 15,
              borderRadius: 2,
              px: 1.2,
              cursor: "default",
              pointerEvents: "none"
            }}
            size="small"
          />
        </Stack>
        {/* Filters row */}
        <Stack direction="row" spacing={1.5} alignItems="center" mx={2} mb={1}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="area-filter-label" sx={{ fontWeight: 700, color: "#222" }}>All Areas</InputLabel>
            <Select
              labelId="area-filter-label"
              value={area}
              label="All Areas"
              onChange={e => setArea(e.target.value)}
              sx={{
                bgcolor: "#e8faf7",
                borderRadius: 2,
                fontWeight: 700,
                minWidth: 110,
                px: 0,
                maxWidth: 140,
                color: "#1199a6",
                '& .MuiSelect-select': {
                  color: "#1199a6",
                  fontWeight: 700
                }
              }}
              displayEmpty
              MenuProps={{ PaperProps: { sx: { maxHeight: 200 } } }}
            >
              <MenuItem value="" sx={{ fontWeight: 700, color: "#1199a6" }}>All Areas</MenuItem>
              {areaList.map(areaName =>
                <MenuItem key={areaName} value={areaName}>{areaName}</MenuItem>
              )}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="sort-filter-label" sx={{ fontWeight: 700 }}>Sort By</InputLabel>
            <Select
              labelId="sort-filter-label"
              value={sortBy}
              label="Sort By"
              onChange={e => setSortBy(e.target.value)}
              sx={{ borderRadius: 2, fontWeight: 700, bgcolor: "#e8faf7" }}
            >
              <MenuItem value="default">Relevance</MenuItem>
              <MenuItem value="rating">Top Rated</MenuItem>
              <MenuItem value="time">Fastest Delivery</MenuItem>
            </Select>
          </FormControl>
        </Stack>

        <Divider sx={{ my: 1 }} />

        {/* Pharmacy cards */}
        <Box sx={{ px: 2, pt: 0.5 }}>
          {loading ? (
            <Typography sx={{ mt: 6, color: "#888" }}>Loading pharmacies...</Typography>
          ) : pharmacies.length === 0 ? (
            <Typography sx={{ mt: 6, color: "#888" }}>No pharmacies found in this location.</Typography>
          ) : (
            <Stack spacing={2}>
              {pharmacies
                .filter(pharmacy => pharmacy.active)
                .map((pharmacy) => (
                  <Card
                    key={pharmacy._id}
                    sx={{
                      borderRadius: 5,
                      boxShadow: 3,
                      px: 2,
                      py: 1.7,
                      bgcolor: "#fff",
                      display: "flex",
                      alignItems: "center",
                      gap: 1.6,
                      cursor: "pointer",
                      transition: "box-shadow 0.13s",
                      "&:hover": { boxShadow: 7, bgcolor: "#fafbfa" }
                    }}
                    onClick={() => navigate(`/medicines/${pharmacy._id}`)}
                  >
                    {/* Pharmacy Icon */}
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        background: "#e8faf7",
                        borderRadius: "14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        mr: 1
                      }}
                    >
                      <img
                        src="/pharmacy-icon.png"
                        alt="Pharmacy"
                        style={{
                          width: 32,
                          height: 32,
                          objectFit: "contain",
                          display: "block"
                        }}
                      />
                    </Box>
                    {/* Main info */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        fontWeight={800}
                        fontSize={16}
                        color="#138a72"
                        sx={{
                          overflowWrap: "break-word",
                          wordBreak: "break-all",
                          whiteSpace: "normal",
                          maxWidth: 165,
                          lineHeight: 1.2
                        }}
                        title={pharmacy.name}
                      >
                        {pharmacy.name}
                      </Typography>
                      <Typography fontSize={14} color="#666" sx={{ mt: 0.1 }}>
                        {pharmacy.area} • {city}
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.7 }}>
                        <Chip
                          size="small"
                          label={`13–29 min`}
                          sx={{
                            bgcolor: "#13C0A225",
                            color: "#13C0A2",
                            fontWeight: 700,
                            fontSize: 13
                          }}
                        />
                        <Chip
                          size="small"
                          label="✅Verified"
                          sx={{
                            bgcolor: "#FFD43B22",
                            color: "#f49f00",
                            fontWeight: 700,
                            fontSize: 13
                          }}
                        />
                      </Stack>
                    </Box>
                    <Stack alignItems="flex-end" spacing={1}>
                      <Rating
                        value={pharmacy.rating || 4.5}
                        precision={0.1}
                        readOnly
                        size="small"
                        sx={{ fontSize: 18, mb: 0.3 }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        sx={{
                          bgcolor: "#328439",
                          color: "#fff",
                          borderRadius: 99,
                          px: 2.3,
                          py: 0.6,
                          fontWeight: 700,
                          textTransform: "none",
                          fontSize: 15,
                          boxShadow: "none",
                          "&:hover": { bgcolor: "#146b2d" }
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          navigate(`/medicines/${pharmacy._id}`);
                        }}
                      >
                        View
                      </Button>
                    </Stack>
                  </Card>
                ))}
            </Stack>
          )}
        </Box>
      </Box>

      {/* Floating: Upload Prescription */}
      {!uploadOpen && (
        <Fab
          variant="extended"
          sx={{
            position: "fixed",
            bottom: 140,
            right: 18,
            zIndex: 2001,
            bgcolor: "#FFD43B",
            color: "#1199a6",
            fontWeight: 700,
            boxShadow: 7,
            pl: 2,
            pr: 2.6,
            "&:hover": { bgcolor: "#f2c200" }
          }}
          onClick={() => setUploadOpen(true)}
          title="Upload Prescription"
        >
          <UploadFileIcon sx={{ fontSize: 23, mr: 1 }} />
          Upload Prescription
        </Fab>
      )}
      <PrescriptionUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        userCity={city}
      />
    </Box>
  );
}
