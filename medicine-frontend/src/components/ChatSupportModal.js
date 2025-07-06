// src/components/ChatSupportModal.js
import React, { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Stack, Typography, Box, CircularProgress, Avatar
} from "@mui/material";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import PersonIcon from "@mui/icons-material/Person";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

export default function ChatSupportModal({ open, onClose, orderId }) {
  const { token } = useAuth();
  const [chat, setChat] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  // Fetch chat thread
 // --- POLLING for auto-refresh ---
useEffect(() => {
  let interval;
  async function fetchChat() {
    if (open && token) {
      const res = await axios.get(`/api/support-chat/thread?orderId=${orderId}`, {
        headers: { Authorization: "Bearer " + token }
      });
      setChat(res.data);
    }
  }
  if (open && token) {
    fetchChat();
    interval = setInterval(fetchChat, 3000); // every 3s
  }
  return () => clearInterval(interval);
}, [open, orderId, token]);


  // Scroll to bottom when new message
  useEffect(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 120);
  }, [chat]);

  // Send message
  async function sendMsg() {
    if (!input.trim()) return;
    setSending(true);
    const res = await axios.post("/api/support-chat/message", {
      orderId,
      text: input
    }, {
      headers: { Authorization: "Bearer " + token }
    });
    setChat(res.data);
    setInput("");
    setSending(false);
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 900, bgcolor: "#13C0A2", color: "#fff", pb: 2 }}>
        <SupportAgentIcon sx={{ mr: 1, mb: "-4px" }} /> GoDavai Support
      </DialogTitle>
      <DialogContent sx={{ minHeight: 330, maxHeight: 430, p: 0, bgcolor: "#e9f9f6" }}>
        <Stack spacing={1} sx={{ px: 2, pt: 1.5, height: "360px", overflowY: "auto" }}>
          {!chat ? (
            <CircularProgress sx={{ mx: "auto", mt: 7 }} />
          ) : (
            chat.messages.map((msg, i) => (
              <Box
                key={i}
                sx={{
                  display: "flex",
                  justifyContent: msg.sender === "user" ? "flex-end" : "flex-start"
                }}
              >
                <Box
                  sx={{
                    bgcolor: msg.sender === "user" ? "#FFD43B" : (msg.sender === "admin" ? "#18c5ad" : "#fff"),
                    color: "#222",
                    borderRadius: 3,
                    p: 1.2,
                    mb: 0.5,
                    maxWidth: "85%",
                    boxShadow: "0 2px 6px #dadada",
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {msg.sender === "bot" && <ChatBubbleIcon fontSize="small" sx={{ mr: 1, color: "#18c5ad" }} />}
                  {msg.sender === "admin" && <SupportAgentIcon fontSize="small" sx={{ mr: 1, color: "#18c5ad" }} />}
                  {msg.sender === "user" && <PersonIcon fontSize="small" sx={{ mr: 1, color: "#FFD43B" }} />}
                  <span>{msg.text}</span>
                </Box>
              </Box>
            ))
          )}
          {chat?.status === "closed" && (
  <Typography sx={{
    mt: 2, textAlign: "center", color: "#c22", fontWeight: 700, fontSize: 14
  }}>
    This support chat is closed by our team. Start a new chat if you need more help!
  </Typography>
)}
          <div ref={messagesEndRef} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>
        <TextField
          fullWidth
          placeholder="Type your message…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => (e.key === "Enter" && !sending) && sendMsg()}
          sx={{ bgcolor: "#fff", borderRadius: 2 }}
        />
        <Button
          variant="contained"
          onClick={sendMsg}
          disabled={sending || !input.trim()}
          sx={{ bgcolor: "#13C0A2", ml: 1, minWidth: 90, fontWeight: 800 }}
        >
          {sending ? <CircularProgress size={19} /> : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
