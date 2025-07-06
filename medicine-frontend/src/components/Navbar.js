// src/components/Navbar.js
import React, { useState, useEffect } from "react";
import {
  Box, InputBase, IconButton, Avatar, Typography, Menu, MenuItem, Link,
  Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem, ListItemIcon, ListItemText, Slide,
  Button, Tooltip, useMediaQuery, CircularProgress
} from "@mui/material";
import RoomIcon from '@mui/icons-material/Room';
import MyLocationIcon from "@mui/icons-material/MyLocation";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import SearchIcon from "@mui/icons-material/Search";
import PersonIcon from "@mui/icons-material/Person";
import { useLocation, useNavigate } from "react-router-dom";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import axios from "axios";

const AREA_MAP = {
  Mumbai: ["Andheri", "Powai", "Bandra", "Borivali", "Goregaon"],
  Delhi: ["CP", "Saket", "Karol Bagh", "Dwarka", "Rohini"],
  Bangalore: ["Koramangala", "Indiranagar", "Whitefield"],
  Chennai: ["T Nagar", "Velachery", "Anna Nagar"],
};
const cities = Object.keys(AREA_MAP);

export default function Navbar({
  search: searchProp = "",
  onSearchChange = () => { },
  onSearchEnter = () => { },
  onProfile = () => window.location.href = "/profile"
}) {
  // Unified city/area state and localStorage key
  const [city, setCity] = useState(localStorage.getItem("city") || "Mumbai");
  const [area, setArea] = useState(localStorage.getItem("area") || "");
  const [anchorEl, setAnchorEl] = useState(null);
  const [areaDialog, setAreaDialog] = useState(false);
  const [selectedArea, setSelectedArea] = useState(area);
  const [geoLoading, setGeoLoading] = useState(false);

  // For mobile responsiveness
  const isMobile = useMediaQuery('(max-width:600px)');

  // Autocomplete search logic (with suggestions by page)
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(searchProp);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  function getSearchType() {
    if (location.pathname.startsWith("/medicines")) return "medicine";
    if (location.pathname.startsWith("/doctors")) return "doctor";
    if (location.pathname.startsWith("/labs")) return "lab";
    return "all";
  }

  useEffect(() => { setSearch(searchProp); }, [searchProp]);
  useEffect(() => { localStorage.setItem("city", city); }, [city]);
  useEffect(() => { localStorage.setItem("area", area); }, [area]);

  useEffect(() => {
    if (!search) {
      setOptions([]);
      return;
    }
    setLoading(true);
    const type = getSearchType();
    axios.get(`/api/search-autocomplete?q=${search}&type=${type}&city=${encodeURIComponent(city)}`)
      .then(res => setOptions(res.data))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, [search, location.pathname, city]);

  // City change resets area
  const handleCityClick = (e) => setAnchorEl(e.currentTarget);
  const handleCityClose = () => setAnchorEl(null);
  const handleCitySelect = (selectedCity) => {
    setCity(selectedCity);
    setArea("");
    setSelectedArea("");
    setAnchorEl(null);
  };

  // Area dialog logic
  const openAreaDialog = () => setAreaDialog(true);
  const closeAreaDialog = () => setAreaDialog(false);
  const saveArea = () => {
    setArea(selectedArea);
    setAreaDialog(false);
  };

  // Detect user location
  const handleDetectLocation = async () => {
    setGeoLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const key = "REMOVED_SECRET";
          const response = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`
          );
          const components = response.data.results[0]?.address_components || [];
          let detectedCity = "";
          let detectedArea = "";
          for (const comp of components) {
            if (comp.types.includes("locality")) detectedCity = comp.long_name;
            if (
              comp.types.includes("sublocality_level_1") ||
              comp.types.includes("sublocality") ||
              comp.types.includes("neighborhood")
            ) {
              detectedArea = comp.long_name;
            }
          }
          // Fuzzy mapping for city
          if (!cities.includes(detectedCity)) {
            if (detectedCity?.toLowerCase().includes("mumbai")) detectedCity = "Mumbai";
            if (detectedCity?.toLowerCase().includes("delhi")) detectedCity = "Delhi";
            if (detectedCity?.toLowerCase().includes("bangalore")) detectedCity = "Bangalore";
            if (detectedCity?.toLowerCase().includes("chennai")) detectedCity = "Chennai";
          }
          if (cities.includes(detectedCity)) {
            setCity(detectedCity);
            // Find best area match or fallback
            const available = AREA_MAP[detectedCity] || [];
            let bestArea = available.find(a =>
              detectedArea?.toLowerCase().includes(a.toLowerCase())
            ) || available[0];
            setArea(bestArea || "");
            setSelectedArea(bestArea || "");
          } else {
            alert("We currently serve only: " + cities.join(", "));
          }
        } catch (e) {
          alert("Could not detect location.");
        }
        setGeoLoading(false);
      }, () => {
        alert("Unable to get your location.");
        setGeoLoading(false);
      });
    } else {
      alert("Geolocation is not supported by your browser.");
      setGeoLoading(false);
    }
  };

  const availableAreas = AREA_MAP[city] || [];

  return (
    <Box sx={{
      width: "100vw",
      bgcolor: "#13C0A2",
      boxShadow: 3,
      position: "sticky",
      top: 0,
      zIndex: 1200,
      pb: 1.2,
      borderBottomLeftRadius: 22,
      borderBottomRightRadius: 22,
    }}>
      {/* Address row */}
      <Box sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        px: 2,
        pt: 1.2,
        pb: 1,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <IconButton size="small" sx={{ mr: 0.5 }} onClick={handleCityClick}>
            <LocationOnIcon sx={{ color: "#FFD43B", fontSize: 25 }} />
          </IconButton>
          <Typography
            variant="subtitle1"
            fontWeight={700}
            sx={{ color: "#fff", cursor: "pointer", fontSize: 17 }}
            onClick={handleCityClick}
            noWrap
          >
            {city}
            {area ? `, ${area}` : ""}
            {" ▼"}
          </Typography>
          {/* Show "Select Area" only if area not set */}
          {!area && (
            <Link
              component="button"
              underline="hover"
              sx={{
                color: "#FFD43B",
                fontWeight: 700,
                fontSize: 14,
                ml: 1
              }}
              onClick={openAreaDialog}
            >
              Select Area
            </Link>
          )}
          {/* Detect Location */}
          <Tooltip title="Detect my location">
            <span>
              <IconButton
                onClick={handleDetectLocation}
                sx={{ ml: 1, color: "#FFD43B" }}
                disabled={geoLoading}
              >
                {geoLoading ? <CircularProgress size={24} color="inherit" /> : <MyLocationIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        <IconButton onClick={onProfile} sx={{ ml: 1 }}>
          <Avatar sx={{ bgcolor: "#FFD43B", width: 36, height: 36, color: "#13C0A2" }}>
            <PersonIcon />
          </Avatar>
        </IconButton>
      </Box>
      {/* City select menu */}
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={handleCityClose}>
        {cities.map(c => (
          <MenuItem key={c} onClick={() => handleCitySelect(c)}>
            {c}
          </MenuItem>
        ))}
      </Menu>
      {/* Area dialog as full-screen for mobile */}
      <Dialog
        open={areaDialog}
        onClose={closeAreaDialog}
        fullScreen={isMobile}
        TransitionComponent={Slide}
        PaperProps={{ sx: { bgcolor: "#f9fafb" } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, bgcolor: "#13C0A2", color: "#fff", minHeight: 58 }}>
          <RoomIcon sx={{ color: "#FFD43B" }} />
          Select Area
          <IconButton sx={{ ml: "auto", color: "#fff" }} onClick={closeAreaDialog}>
            <span style={{ fontSize: 24 }}>&times;</span>
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<MyLocationIcon />}
            sx={{
              mb: 2,
              borderColor: "#13C0A2",
              color: "#13C0A2",
              fontWeight: 700,
              fontSize: 16
            }}
            onClick={handleDetectLocation}
            disabled={geoLoading}
          >
            {geoLoading ? "Detecting..." : "Use My Current Location"}
          </Button>
          <List>
            {availableAreas.map(areaName => (
              <ListItem
                key={areaName}
                button
                onClick={() => setSelectedArea(areaName)}
                sx={{
                  mb: 1,
                  borderRadius: 2,
                  bgcolor: selectedArea === areaName ? "#13C0A230" : "#fff",
                  border: selectedArea === areaName ? "2px solid #13C0A2" : "1px solid #e0e0e0",
                  boxShadow: selectedArea === areaName ? 2 : 0
                }}
              >
                <ListItemIcon>
                  <RoomIcon sx={{ color: "#13C0A2" }} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography fontWeight={selectedArea === areaName ? 800 : 600} color="#13C0A2">
                      {areaName}
                    </Typography>
                  }
                />
                {selectedArea === areaName && (
                  <span style={{ color: "#FFD43B", fontWeight: 700, marginLeft: 8 }}>✔</span>
                )}
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions sx={{ pb: 2, px: 2 }}>
          <Button onClick={closeAreaDialog} sx={{ flex: 1 }}>Cancel</Button>
          <Button
            variant="contained"
            sx={{ flex: 2, bgcolor: "#13C0A2", color: "#fff", fontWeight: 700 }}
            onClick={saveArea}
            disabled={!selectedArea}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
      {/* Big search bar row (with Autocomplete suggestions) */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          bgcolor: "#fff",
          borderRadius: 3,
          mx: 2,
          px: 2,
          height: 46,
          boxShadow: 2,
          mt: 1
        }}
      >
        <SearchIcon color="action" sx={{ fontSize: 24 }} />
        <Autocomplete
          freeSolo
          options={options}
          loading={loading}
          onInputChange={(event, value) => setSearch(value)}
          value={search}
          sx={{ flex: 1 }}
          inputValue={search}
          onChange={(event, newValue) => {
            setSearch(newValue || "");
            if (newValue) navigate(`/search?q=${encodeURIComponent(newValue)}`);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="standard"
              placeholder={
                getSearchType() === "medicine"
                  ? "Search Medicines"
                  : getSearchType() === "doctor"
                  ? "Search Doctors"
                  : getSearchType() === "lab"
                  ? "Search Labs"
                  : "Search for Medicines, Doctors, Labs"
              }
              InputProps={{
                ...params.InputProps,
                disableUnderline: true,
                style: { fontSize: 17 }
              }}
            />
          )}
        />
        {loading && <CircularProgress size={18} sx={{ ml: 1 }} />}
      </Box>
    </Box>
  );
}
