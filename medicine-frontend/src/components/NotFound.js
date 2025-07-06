import React from "react";
import { Box, Typography, Button } from "@mui/material";
import GoDavaiLogo from "../assets/GoDavaiLogo";
import { useNavigate } from "react-router-dom";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#FFE066",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <GoDavaiLogo size={66} />
      <Typography variant="h2" sx={{ fontWeight: 900, color: "#13C0A2", mt: 2 }}>
        404
      </Typography>
      <Typography variant="h5" sx={{ color: "#1188A3", mb: 3 }}>
        Oops! Page not found.
      </Typography>
      <Button
        variant="contained"
        color="primary"
        sx={{ bgcolor: "#13C0A2", fontWeight: 700, borderRadius: 3, px: 3 }}
        onClick={() => navigate("/home")}
      >
        Go to Home
      </Button>
    </Box>
  );
}
