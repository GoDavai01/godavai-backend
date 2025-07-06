import React, { useEffect, useState } from "react";
import {
  Box, Typography, Card, Button, Stack, Chip, Fab, Snackbar, Alert, Divider, MenuItem, Select, InputLabel, FormControl, Dialog, DialogTitle, DialogContent, DialogActions
} from "@mui/material";
import PrescriptionUploadModal from "../components/PrescriptionUploadModal";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import CategoryIcon from "@mui/icons-material/Category";
import { useCart } from "../context/CartContext";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import axios from "axios";

// Only this function changed: Now always uses relative path for production.
const getImageUrl = (img) => {
  if (!img)
    return "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg?w=400";
  if (img.startsWith("/uploads/")) return `${img}`; // Use relative path
  return img;
};

const allCategories = ["All", "Painkiller", "Fever", "Cough & Cold", "Diabetes", "Heart", "Antibiotic", "Ayurveda"];
const medTypes = ["All", "Tablet", "Syrup", "Injection", "Cream", "Ointment", "Drop", "Spray", "Inhaler"];

export default function Medicines() {
  const { pharmacyId } = useParams();
  const { addToCart } = useCart();
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedType, setSelectedType] = useState("All");
  const [pharmacy, setPharmacy] = useState(null);
  const [selectedMed, setSelectedMed] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const city = localStorage.getItem("city") || "Delhi";
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPharmacy = async () => {
      try {
        const res = await axios.get(`/api/pharmacies?id=${pharmacyId}`);
        if (Array.isArray(res.data)) {
          setPharmacy(res.data[0]);
        }
      } catch {
        setPharmacy(null);
      }
    };
    fetchPharmacy();
  }, [pharmacyId]);

  useEffect(() => {
    setLoading(true);
    axios
      .get(`/api/medicines?pharmacyId=${pharmacyId}`)
      .then((res) => setMedicines(res.data))
      .catch(() => setMedicines([]))
      .finally(() => setLoading(false));
  }, [pharmacyId]);

  const filteredMeds = medicines.filter(med => {
    const catMatch = selectedCategory === "All" || med.category === selectedCategory;
    const typeMatch = selectedType === "All" || (med.type && med.type === selectedType);
    return catMatch && typeMatch;
  });

  return (
    <Box sx={{ bgcolor: "#f9fafb", minHeight: "100vh", pb: 12, pt: 3 }}>
      <Box sx={{ maxWidth: 480, mx: "auto", px: 2 }}>
        {pharmacy && (
          <Box sx={{ mb: 2, pb: 1 }}>
            <Typography fontWeight={900} fontSize={22} color="#13C0A2">
              🏥 {pharmacy.name}
            </Typography>
            <Typography fontSize={14} color="#555">
              {pharmacy.area}, {pharmacy.city}
            </Typography>
            <Divider sx={{ mt: 1.5 }} />
          </Box>
        )}

        {/* Filter Section */}
        <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Category</InputLabel>
            <Select
              value={selectedCategory}
              label="Category"
              onChange={(e) => setSelectedCategory(e.target.value)}
              startAdornment={<FilterAltIcon sx={{ mr: 1, color: "#13C0A2" }} />}
              sx={{ fontWeight: 700, bgcolor: "#eafaf3", borderRadius: 2 }}
            >
              {allCategories.map(cat => (
                <MenuItem key={cat} value={cat}>{cat}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={selectedType}
              label="Type"
              onChange={(e) => setSelectedType(e.target.value)}
              startAdornment={<CategoryIcon sx={{ mr: 1, color: "#13C0A2" }} />}
              sx={{ fontWeight: 700, bgcolor: "#eafaf3", borderRadius: 2 }}
            >
              {medTypes.map(type => (
                <MenuItem key={type} value={type}>{type}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {loading ? (
          <Typography color="text.secondary">Loading medicines...</Typography>
        ) : filteredMeds.length === 0 ? (
          <Typography color="text.secondary">No medicines found.</Typography>
        ) : (
          <Stack spacing={2}>
            {filteredMeds.map((med) => {
              const mrp = med.mrp;
              const discount = Math.round(((med.mrp - med.price) / med.mrp) * 100);

              return (
                <Card
                  key={med._id}
                  sx={{
                    display: "flex", p: 1.6, borderRadius: 4, boxShadow: 2,
                    bgcolor: "#fff", alignItems: "center", justifyContent: "space-between"
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <Box
                      component="img"
                      src={getImageUrl(med.img)}
                      alt={med.name}
                      sx={{ width: 72, height: 72, borderRadius: 3, bgcolor: "#f1fff7", objectFit: "contain" }}
                    />
                    <Box>
                      <Typography fontWeight={700} fontSize={16} color="#07908A" sx={{ mb: 0.2 }}>
                        {med.name}
                      </Typography>
                      {med.brand && med.brand.trim() && (
                        <Typography
                          fontWeight={600}
                          fontSize={14}
                          color="#146e6e"
                          sx={{ mb: 0.2 }}
                        >
                          {med.brand}
                        </Typography>
                      )}
                      <Typography fontSize={13} color="#666" sx={{ mb: 0.5 }}>
                        {med.category || "Miscellaneous"}
                      </Typography>
                      <Stack direction="row" spacing={1} mt={1}>
                        <Button
                          size="medium"
                          onClick={() => setSelectedMed(med)}
                          sx={{ px: 1.5, fontSize: 15, borderRadius: 2, textTransform: "none" }}
                        >
                          Know More
                        </Button>
                        <Button
                          variant="contained"
                          size="medium"
                          sx={{
                            bgcolor: "#13C0A2", color: "#fff", px: 2,
                            fontWeight: 800, borderRadius: 2, fontSize: 14, textTransform: "none",
                            "&:hover": { bgcolor: "#0e9c87" }
                          }}
                          onClick={() => {
                            addToCart(med);
                            setSnackbar({ open: true, message: `${med.name} added to cart!`, severity: "success" });
                          }}
                        >
                          Add to Cart
                        </Button>
                      </Stack>
                    </Box>
                  </Box>
                  <Box textAlign="right">
                    {med.mrp ? (
                      <>
                        <Typography fontSize={14} sx={{ textDecoration: "line-through", color: "#999" }}>
                          MRP: ₹{med.mrp}
                        </Typography>
                        <Typography fontWeight={900} fontSize={18} color="#13C0A2">
                          ₹{med.price}
                        </Typography>
                        {med.price < med.mrp && (
                          <Chip
                            label={`${Math.round(((med.mrp - med.price) / med.mrp) * 100)}% OFF`}
                            size="small"
                            color="success"
                            sx={{ height: 20, fontWeight: 700, mt: 0.5 }}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <Typography fontSize={18} fontWeight={900} color="#13C0A2">
                          ₹{med.price}
                        </Typography>
                        <Typography fontSize={13} color="gray">
                          MRP not available
                        </Typography>
                      </>
                    )}
                  </Box>
                </Card>
              );
            })}
          </Stack>
        )}
      </Box>

      {/* Know More Modal */}
      <Dialog open={!!selectedMed} onClose={() => setSelectedMed(null)}>
        {selectedMed && (
          <>
            <DialogTitle>
              {selectedMed.name}
              {selectedMed.brand && selectedMed.brand.trim() && (
                <Typography
                  component="div"
                  fontWeight={500}
                  fontSize={15}
                  color="#1188A3"
                  sx={{ mt: 0.5 }}
                >
                  {selectedMed.brand}
                </Typography>
              )}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" gutterBottom color="text.secondary">
                {selectedMed.description || "No description available."}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Category: {selectedMed.category || "Miscellaneous"}
              </Typography>
              <Typography variant="h6" mt={2}>
                ₹{selectedMed.price} <Typography component="span" sx={{ textDecoration: "line-through", ml: 1, fontSize: 14, color: "gray" }}>₹{Math.round(selectedMed.price / (1 - (selectedMed.discount || 10) / 100))}</Typography>
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedMed(null)}>Close</Button>
              <Button
                variant="contained"
                sx={{ bgcolor: "#13C0A2", color: "white" }}
                onClick={() => {
                  addToCart(selectedMed);
                  setSnackbar({ open: true, message: `${selectedMed.name} added to cart!`, severity: "success" });
                  setSelectedMed(null);
                }}
              >
                Add to Cart
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Floating Upload Prescription */}
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

      <Snackbar
        open={snackbar.open}
        autoHideDuration={1600}
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
