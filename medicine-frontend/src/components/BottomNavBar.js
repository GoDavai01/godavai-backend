import React from "react";
import { Box, Button } from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";

const navs = [
  { label: "GoDavai", path: "/home" },
  { label: "Medicines", path: "/pharmacies-near-you" },
  { label: "Doctor", path: "/doctors" },
  { label: "Lab Test", path: "/labs" }
];

export default function BottomNavBar() {
  const navigate = useNavigate();
  const location = useLocation();

  const activeIdx = navs.findIndex(n => location.pathname.startsWith(n.path));

  return (
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
      {navs.map((item, idx) => (
        <Button
          key={item.label}
          onClick={() => navigate(item.path)}
          sx={{
            fontWeight: idx === activeIdx ? 800 : 600,
            color: idx === activeIdx ? "#FFD43B" : "#fff",
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
  );
}
