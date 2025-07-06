import React, { useState, useEffect, useRef } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Stack, TextField, Chip
} from "@mui/material";
import axios from "axios";

/**
 * Props:
 * - open: boolean
 * - onClose: function
 * - orderId: string
 * - thread: string ("delivery", etc)
 * - orderStatus: string
 * - partnerName: string
 * - partnerType: string ("user", "pharmacy", "delivery")
 * - currentRole: string ("user", "delivery", "pharmacy") <-- PASS THIS from parent!
 */
export default function ChatModal({
  open,
  onClose,
  orderId,
  thread,
  orderStatus,
  partnerName,
  partnerType,
  currentRole // "user" for customer/order tracking, "delivery" for delivery dashboard
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef();

  // Helper: use correct token for currentRole
  const getAuthConfig = () => {
    let token = "";
    if (currentRole === "delivery") {
      token = localStorage.getItem("deliveryToken");
    } else if (currentRole === "pharmacy") {
      token = localStorage.getItem("pharmacyToken");
    } else {
      token = localStorage.getItem("token");
    }
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  };

  // Fetch chat history
  useEffect(() => {
    if (!open) return;
    setLoading(true);

    axios
      .get(`/api/chat/${orderId}/${thread}`, getAuthConfig())
      .then((res) => {
        setMessages(res.data);
        setLoading(false);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      })
      .catch(() => setLoading(false));

    // Polling for new messages (or use socket in future)
    const poll = setInterval(() => {
      axios
        .get(`/api/chat/${orderId}/${thread}`, getAuthConfig())
        .then((res) => setMessages(res.data));
    }, 5000);
    return () => clearInterval(poll);
    // eslint-disable-next-line
  }, [open, orderId, thread, currentRole]);

  // Send message
  const sendMessage = async () => {
    if (!input.trim() || orderStatus === "delivered") return;
    try {
      const res = await axios.post(
        `/api/chat/${orderId}/${thread}`,
        { message: input.trim() },
        getAuthConfig()
      );
      setMessages((m) => [...m, res.data]);
      setInput("");
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }catch (err) {
      alert("Send failed: " + (err.response?.data?.error || err.message));
    }
  };

  // --- Core change: map senderType to "You" or proper role label ---
  const getLabel = (msg) => {
    if (msg.senderType === currentRole) return "You";
    if (msg.senderType === "delivery") return "Delivery Partner";
    if (msg.senderType === "user") return "Customer";
    if (msg.senderType === "pharmacy") return "Pharmacy";
    return msg.senderType || "Other";
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Chat with {partnerType === "pharmacy" ? "Pharmacy" : "Delivery Partner"}: {partnerName}
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 340, bgcolor: "#f7faff" }}>
        {loading ? (
          <Typography>Loading…</Typography>
        ) : (
          <Box sx={{ maxHeight: 320, overflowY: "auto", px: 1 }}>
            <Stack spacing={2}>
              {messages.map((msg, i) => (
                <Box
                  key={i}
                  alignSelf={msg.senderType === currentRole ? "flex-end" : "flex-start"}
                >
                  <Chip
                    label={
                      <span>
                        <b>{getLabel(msg)}</b>: {msg.message}
                        <span
                          style={{
                            color: "#888",
                            marginLeft: 10,
                            fontSize: 12,
                          }}
                        >
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                    }
                    sx={{
                      bgcolor: msg.senderType === currentRole ? "#13C0A2" : "#fff",
                      color: msg.senderType === currentRole ? "#fff" : "#222",
                      mb: 1,
                      fontWeight: 500,
                    }}
                  />
                </Box>
              ))}
              <div ref={bottomRef} />
            </Stack>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <TextField
          autoFocus
          disabled={orderStatus === "delivered"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendMessage();
          }}
          placeholder={
            orderStatus === "delivered"
              ? "Chat closed after delivery"
              : "Type a message…"
          }
          sx={{ flex: 1, mr: 2 }}
        />
        <Button
          variant="contained"
          color="primary"
          onClick={sendMessage}
          disabled={!input.trim() || orderStatus === "delivered"}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
