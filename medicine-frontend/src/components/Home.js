// src/components/Home.js
import React, { useEffect, useState } from "react";
import {
  Box, Typography, Card, Button, Stack
} from "@mui/material";
import Carousel from "react-multi-carousel";
import "react-multi-carousel/lib/styles.css";
import axios from "axios";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useNavigate } from "react-router-dom";
import Navbar from "./Navbar";

const offerBanners = [
  { img: "/images/offer1.png" },
  { img: "/images/offer2.png" },
  { img: "/images/offer3.png" }
];

const mainTiles = [
  { title: "Medicines in 13–29 min", subtitle: "Fastest delivery at your doorstep", path: "/pharmacies-near-you" },
  { title: "Book Doctor Appointment", subtitle: "Clinic & hospital doctors nearby", path: "/doctors" },
  { title: "Book Lab Test Near You", subtitle: "Accredited labs, home pickup", path: "/labs" },
  { title: "Order Again", subtitle: "Repeat your last order", path: "/orders" },
];

const bottomNavItems = [
  { label: "GoDavai", path: "/home" },
  { label: "Medicines", path: "/pharmacies-near-you" },
  { label: "Doctor", path: "/doctors" },
  { label: "Lab Test", path: "/labs" }
];

// ADJUST THESE heights as per your real app if needed:
const CART_BAR_HEIGHT = 68; // px, height of your View Cart bar
const NAV_BAR_HEIGHT = 56;  // px, height of your bottom navbar

export default function Home() {
  const [mostOrdered, setMostOrdered] = useState([]);
  const [search, setSearch] = useState("");
  const [activeNav, setActiveNav] = useState(0);
  const { user } = useAuth();
  const { cart, addToCart } = useCart();
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const navigate = useNavigate();

  // Track Order Bar State
  const [activeOrderId, setActiveOrderId] = useState(() => localStorage.getItem("activeOrderId"));

  // Always keep Track Order bar in sync with real ongoing orders (not just localStorage)
  useEffect(() => {
    const checkOrder = async () => {
      let id = localStorage.getItem("activeOrderId");
      if (id) {
        try {
          const res = await axios.get(`/api/orders/${id}`);
          if (res.data.status === "delivered" || res.data.status === "cancelled") {
            localStorage.removeItem("activeOrderId");
            setActiveOrderId(null);
          } else {
            setActiveOrderId(id);
            return;
          }
        } catch {
          setActiveOrderId(null);
        }
      }
      if (user && user._id) {
        try {
          const ordersRes = await axios.get(`/api/orders?user=${user._id}&limit=5`);
          const ongoing = (ordersRes.data || []).find(
            o => o.status !== "delivered" && o.status !== "cancelled"
          );
          if (ongoing && ongoing._id) {
            localStorage.setItem("activeOrderId", ongoing._id);
            setActiveOrderId(ongoing._id);
          } else {
            setActiveOrderId(null);
          }
        } catch {
          setActiveOrderId(null);
        }
      }
    };

    checkOrder();
    const interval = setInterval(checkOrder, 3000);
    return () => clearInterval(interval);
  }, [user && user._id]);

 useEffect(() => {
  // 1. Get city & area from localStorage if needed
  const city = localStorage.getItem("city") || "Mumbai";
  const area = localStorage.getItem("area") || "";

  // 2. Fetch active pharmacies for this city/area
  fetch(`/api/pharmacies?city=${encodeURIComponent(city)}${area ? `&area=${encodeURIComponent(area)}` : ""}`)
    .then(res => res.json())
    .then(pharmacies => {
      // Only active pharmacies
      const activePharmacyIds = pharmacies
        .filter(ph => ph.active) // <-- Defensive, but your backend filters this anyway
        .map(ph => ph._id);

      // 3. Fetch most-ordered medicines
      fetch(`/api/medicines/most-ordered?city=${encodeURIComponent(city)}`)
        .then(res => res.json())
        .then(meds => {
          // 4. Only show medicines from active pharmacies
          const filtered = meds.filter(med => med.pharmacy && activePharmacyIds.includes(med.pharmacy._id || med.pharmacy));
          setMostOrdered(filtered);
        })
        .catch(() => setMostOrdered([]));
    })
    .catch(() => setMostOrdered([]));
}, []);

  const handleNavClick = (idx, path) => {
    setActiveNav(idx);
    navigate(path);
  };

  const carouselResponsive = {
    desktop: { breakpoint: { max: 3000, min: 1024 }, items: 1 },
    tablet: { breakpoint: { max: 1024, min: 464 }, items: 1 },
    mobile: { breakpoint: { max: 464, min: 0 }, items: 1 }
  };

  // -------- FIX: calculate cart bar visibility --------
  const cartBarVisible = cartCount > 0;
  // ----------------------------------------------------

  return (
    <Box sx={{ bgcolor: "#f9fafb", minHeight: "100vh", pb: 12 }}>
      <Navbar
        search={search}
        onSearchChange={e => setSearch(e.target.value)}
        onSearchEnter={query =>
          window.location.href = `/search?q=${encodeURIComponent(query.trim())}`
        }
      />
      {/* Banner Carousel */}
      <Box sx={{ maxWidth: 480, mx: "auto", mt: 2, borderRadius: 4, boxShadow: 1, overflow: "hidden" }}>
        <Carousel
          responsive={carouselResponsive}
          infinite
          autoPlay
          autoPlaySpeed={3200}
          showDots
          arrows={false}
        >
          {offerBanners.map((banner, i) => (
            <Box
              key={i}
              sx={{
                position: "relative",
                width: "100%",
                height: { xs: 110, sm: 140 },
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#e9faf7"
              }}
            >
              <img
                src={banner.img}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  borderRadius: 20,
                  filter: "brightness(0.93)"
                }}
              />
            </Box>
          ))}
        </Carousel>
      </Box>

      {/* Main Tiles */}
      <Stack spacing={2} sx={{ maxWidth: 480, mx: "auto", px: 2, mt: 3 }}>
        {mainTiles.map((tile, i) => (
          <Card
            key={tile.title}
            onClick={() => {
              if (tile.title === "Order Again") {
                navigate("/orders");
              } else {
                navigate(tile.path);
              }
            }}
            sx={{
              px: 2,
              py: 1.6,
              boxShadow: 1,
              borderRadius: 99,
              cursor: "pointer",
              bgcolor: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              transition: "box-shadow 0.16s",
              "&:hover": { boxShadow: 3 }
            }}
          >
            <Box>
              <Typography fontWeight={700} fontSize={17}>{tile.title}</Typography>
              <Typography fontSize={14} color="text.secondary" fontWeight={500}>
                {tile.subtitle}
              </Typography>
            </Box>
            <Typography fontWeight={800} fontSize={26} color="#13C0A2">➔</Typography>
          </Card>
        ))}
      </Stack>

      {/* Most Ordered Medicines as Cards */}
      <Box sx={{ maxWidth: 480, mx: "auto", mt: 4, mb: 2, px: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography fontWeight={700} fontSize={17}>
            Most Ordered Medicines
          </Typography>
          <Typography fontWeight={800} color="#13C0A2" fontSize={18}>➔</Typography>
        </Stack>
        <Box
          sx={{
            display: "flex",
            overflowX: "auto",
            pb: 1,
            gap: 2
          }}
        >
          {mostOrdered.map((med, idx) => (
            <Card
              key={med._id || med.name || idx}
              sx={{
                minWidth: 170,
                maxWidth: 190,
                bgcolor: "#e6f9f5",
                color: "#138a72",
                fontWeight: 600,
                fontSize: 16,
                borderRadius: 3,
                px: 2,
                py: 1.7,
                mr: 1.5,
                boxShadow: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                cursor: "pointer",
              }}
              onClick={() => navigate("/pharmacies-near-you")}
            >
              <Typography
                fontWeight={700}
                fontSize={16}
                sx={{ mb: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {med.name}
              </Typography>
              {med.price &&
                <Typography fontWeight={500} fontSize={15} color="#13C0A2" sx={{ mb: 0.2 }}>
                  ₹{med.price}
                </Typography>
              }
              <Button
                onClick={e => {
                  e.stopPropagation();
                  addToCart(med);
                }}
                size="small"
                sx={{
                  bgcolor: "#13C0A2",
                  color: "#fff",
                  px: 2,
                  py: 0.7,
                  fontWeight: 700,
                  borderRadius: 2,
                  fontSize: 14,
                  textTransform: "none",
                  mt: 0.8,
                  "&:hover": { bgcolor: "#139e84" }
                }}
              >
                Add to Cart
              </Button>
              <Typography fontSize={12} color="#888" mt={0.7}>
                22-30 min delivery
              </Typography>
            </Card>
          ))}
        </Box>
      </Box>

      {/* Cheer-up Message */}
      <Box sx={{
        width: "100vw",
        display: "flex",
        justifyContent: "center",
        my: 2
      }}>
        <Box
          sx={{
            bgcolor: "#fff",
            px: 3, py: 1.3,
            borderRadius: 99,
            boxShadow: 2,
            fontWeight: 700,
            color: "#13C0A2",
            fontSize: 17,
            letterSpacing: 0.5,
            textAlign: "center"
          }}
        >
          Fastest medicine, happiest you! Get well soon! 💊❤️
        </Box>
      </Box>

      {/* Track Order Bar (ALWAYS sits above the view cart bar if cart is visible) */}
      {activeOrderId && (
        <Box
          sx={{
            position: "fixed",
            left: 0,
            right: 0,
            // BOTTOM CALC LOGIC: sits above cart if cart is visible, otherwise above nav
            bottom: cartBarVisible
              ? `${CART_BAR_HEIGHT + NAV_BAR_HEIGHT + 8}px`
              : `${NAV_BAR_HEIGHT + 8}px`,
            zIndex: 1301,
            px: 2, py: 1,
            maxWidth: 480, mx: "auto",
            bgcolor: "#fff",
            borderRadius: 3,
            boxShadow: "0 2px 10px #13C0A225",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            border: "1.5px solid #eaf4fb",
            transition: "bottom 0.2s"
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1.2}>
            <LocalPharmacyIcon sx={{ color: "#13C0A2", fontSize: 28 }} />
            <Typography sx={{ fontWeight: 800, color: "#13C0A2", fontSize: 17 }}>
              Track your order in real time!
            </Typography>
          </Stack>
          <Button
            variant="contained"
            sx={{
              bgcolor: "#FFD43B", color: "#222", borderRadius: 2,
              fontWeight: 900, ml: 2, px: 3, boxShadow: "0 2px 12px #ffe999"
            }}
            onClick={() => navigate(`/order-tracking/${activeOrderId}`)}
          >
            Track Order
          </Button>
        </Box>
      )}

      {/* BottomNavbar */}
      <Box
        sx={{
          position: "fixed",
          left: 0, right: 0, bottom: 0,
          width: "100vw",
          bgcolor: "#13C0A2",
          borderTop: "1.5px solid #e3e3e3",
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          py: 1.2,
          zIndex: 1201,
          boxShadow: "0px -1px 8px 0px #13C0A235"
        }}
      >
        {bottomNavItems.map((item, idx) => (
          <Button
            key={item.label}
            onClick={() => handleNavClick(idx, item.path)}
            sx={{
              fontWeight: idx === activeNav ? 800 : 600,
              color: idx === activeNav ? "#FFD43B" : "#fff",
              bgcolor: "transparent",
              fontSize: 16,
              borderRadius: 2,
              minWidth: 0,
              px: 0.7,
              textTransform: "none"
            }}
          >
            {item.label}
          </Button>
        ))}
      </Box>
    </Box>
  );
}
