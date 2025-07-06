// src/components/WelcomePage.js
import React from "react";
import { Box, Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import GoDavaiLogo from "../assets/GoDavaiLogo";

export default function WelcomePage() {
  const navigate = useNavigate();

  // Check login (token) in localStorage
  const handleGetStarted = () => {
    const token = localStorage.getItem("token");
    if (token) {
      navigate("/home");
    } else {
      navigate("/otp-login");
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#FFE066",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
      }}
    >
      <GoDavaiLogo size={90} />
      <Typography
        variant="h2"
        sx={{
          color: "#13C0A2",
          fontWeight: 900,
          letterSpacing: 3,
          mt: 2,
          mb: 1,
          textAlign: "center",
          fontFamily: "Montserrat, Arial",
          textShadow: "2px 2px 0 #fff",
        }}
      >
        GoDavai
      </Typography>
      <Typography
        variant="h6"
        sx={{
          color: "#1188A3",
          mb: 2,
          fontWeight: 600,
          fontFamily: "Montserrat, Arial",
          letterSpacing: 1,
          textAlign: "center",
        }}
      >
        Your Trusted Medicine Delivery in 13-29 minutes.
        <br />
        Fast. Reliable. Guaranteed. <span style={{ color: "#13C0A2" }}>Smiles Delivered 😊</span>
      </Typography>
      <Button
        size="large"
        variant="contained"
        sx={{
          bgcolor: "#13C0A2",
          fontWeight: 700,
          px: 4,
          py: 1.5,
          borderRadius: 6,
          fontSize: 18,
          "&:hover": { bgcolor: "#1188A3" },
          mt: 3,
        }}
        onClick={handleGetStarted}
      >
        Get Started
      </Button>
    </Box>
  );
}
