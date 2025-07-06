import React from "react";
import { Box, Typography, Button, Card, CardContent } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useNavigate } from "react-router-dom";

export default function PaymentSuccess() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "#f5f7fb"
      }}
    >
      <Card sx={{ p: 4, borderRadius: 5, boxShadow: 4, maxWidth: 430, mx: "auto" }}>
        <Box sx={{ textAlign: "center", mb: 3 }}>
          <CheckCircleIcon sx={{ fontSize: 75, color: "#43a047", mb: 1 }} />
          <Typography variant="h5" sx={{ fontWeight: 700, color: "#1976d2", mb: 2 }}>
            Payment Successful!
          </Typography>
          <Typography variant="body1" sx={{ color: "#444", mb: 1 }}>
            Your order has been placed.  
            <br />
            You will receive a confirmation soon.
          </Typography>
        </Box>
        <CardContent sx={{ textAlign: "center" }}>
          <Button
            variant="contained"
            color="primary"
            sx={{ mt: 2, fontWeight: 700, px: 4, py: 1.3, fontSize: 16 }}
            onClick={() => navigate("/profile")}
          >
            View My Orders
          </Button>
          <Button
            variant="outlined"
            color="primary"
            sx={{ mt: 2, ml: 2, fontWeight: 700, px: 4, py: 1.3, fontSize: 16 }}
            onClick={() => navigate("/")}
          >
            Go to Home
          </Button>
          <Button
            variant="contained"
            color="primary"
            sx={{ mt: 2, fontWeight: 700, px: 4, py: 1.3, fontSize: 16 }}
            onClick={() => navigate("/order/ORD23456")}
          >
            Track My Order
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
