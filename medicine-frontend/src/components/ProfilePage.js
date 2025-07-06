// src/components/ProfilePage.js
import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useThemeMode } from "../context/ThemeContext";
import { useTheme } from "@mui/material/styles";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import {
  Box, Typography, Avatar, IconButton, Button, Stack, Collapse, Paper,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip, Snackbar, Alert, MenuItem,
  List, ListItem, ListItemText, Switch, FormControlLabel
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import EmailIcon from "@mui/icons-material/Email";
import HomeIcon from "@mui/icons-material/Home";
import HistoryIcon from "@mui/icons-material/History";
import LoyaltyIcon from "@mui/icons-material/Loyalty";
import WalletIcon from "@mui/icons-material/AccountBalanceWallet";
import SettingsIcon from "@mui/icons-material/Settings";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import LogoutIcon from "@mui/icons-material/Logout";
import creditCardType from "credit-card-type";
import StarsIcon from "@mui/icons-material/Stars";
import TwoWheelerIcon from "@mui/icons-material/TwoWheeler";
import CurrencyRupeeIcon from "@mui/icons-material/CurrencyRupee";
import DeleteIcon from "@mui/icons-material/Delete";
import LockIcon from "@mui/icons-material/Lock";
import ChatSupportModal from "./ChatSupportModal";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import { useNavigate } from "react-router-dom";
import AddressForm from "./AddressForm"; // Make sure you have this!

const cardIcons = {
  Visa: "https://img.icons8.com/color/48/000000/visa.png",
  Mastercard: "https://img.icons8.com/color/48/000000/mastercard-logo.png",
  Amex: "https://img.icons8.com/color/48/000000/amex.png",
  Rupay: "https://seeklogo.com/images/R/rupay-logo-E3947D7A13-seeklogo.com.png",
};

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, setUser, logout, token, addresses, updateAddresses } = useAuth();
  const [chatSupportOpen, setChatSupportOpen] = useState(false);



  const [openSections, setOpenSections] = useState({
    addresses: true,
    wallet: false,
    orders: false,
    badges: false,
    personalization: false,
    settings: false,
    pharmacist: false,
    delivery: false,
    support: false,
    refer: false,
  });
  const toggleSection = (key) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  // --- MANDATORY PROFILE FIELDS DIALOG ---
  const [editDialog, setEditDialog] = useState(false);
  const [editData, setEditData] = useState({
    name: user?.name || "",
    email: user?.email || "",
    mobile: user?.mobile || "",
    dob: user?.dob || "",
    avatar: user?.avatar || "",
  });
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar || "");
  const fileInputRef = useRef();

  // Open the dialog if any required field is missing
  useEffect(() => {
    if (user && (!user.name || !user.email || !user.dob)) {
      setEditDialog(true);
      setEditData({
        name: user.name || "",
        email: user.email || "",
        mobile: user.mobile || "",
        dob: user.dob || "",
        avatar: user.avatar || ""
      });
      setAvatarPreview(user.avatar || "");
    }
  }, [user]);

  // Handler to manually open the dialog for editing
  const handleEditProfileOpen = () => {
    setEditData({
      name: user.name || "",
      email: user.email || "",
      mobile: user.mobile || "",
      dob: user.dob || "",
      avatar: user.avatar || ""
    });
    setAvatarPreview(user.avatar || "");
    setEditDialog(true);
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarPreview(reader.result);
      setEditData(d => ({ ...d, avatar: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSave = async () => {
    // Removed console.log("SAVING TO", `/api/users/${user._id}`, editData); // PRODUCTION: no logs
    try {
    const res = await axios.put(`/api/users/${user._id}`, editData);
    setSnackbar({ open: true, message: "Profile updated!", severity: "success" });

    // Fetch latest from backend!
    const updatedProfile = await axios.get("/api/profile", {
      headers: { Authorization: "Bearer " + token }
    });
    setUser(updatedProfile.data);
    setEditDialog(false);
  } catch (e) {
    setSnackbar({ open: true, message: "Failed to update!", severity: "error" });
  }
};

  // --- Settings Dialogs ---
  const [changePassOpen, setChangePassOpen] = useState(false);
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // --- Addresses (static, no backend here) ---
  const [editingAddress, setEditingAddress] = useState(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const handleAddressSave = async (newAddr) => {
  let updated;
  if (newAddr.id && addresses.some((a) => a.id === newAddr.id)) {
    // Edit
    updated = addresses.map((a) => (a.id === newAddr.id ? newAddr : a));
  } else {
    newAddr.id = Date.now().toString();
    updated = [...addresses, newAddr];
  }
  // Set as default, mark only this one as default
  if (newAddr.isDefault) {
    updated = updated.map(a => ({ ...a, isDefault: a.id === newAddr.id }));
  }
  await updateAddresses(updated);
  setSnackbar({ open: true, message: editingAddress ? "Address updated!" : "Address added!", severity: "success" });
  setShowAddressForm(false);
  setEditingAddress(null);
};

const handleDeleteAddress = async (addr) => {
  if (!window.confirm("Are you sure you want to delete this address?")) return;
  const updated = addresses.filter(a => a.id !== addr.id);
  await updateAddresses(updated);
  setSnackbar({ open: true, message: "Address deleted!", severity: "success" });
};

  // --- Cards (local only) ---
  const [cards, setCards] = useState([]);
  const [cardDialog, setCardDialog] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [cardForm, setCardForm] = useState({
    number: "",
    name: "",
    expiry: "",
    brand: "",
  });
  const [cardTypeIcon, setCardTypeIcon] = useState(null);

  function detectCardType(number) {
    if (!number) return "";
    const result = creditCardType(number.replace(/\s/g, ''));
    return result.length ? result[0].niceType : "";
  }
  function handleCardNumberChange(e) {
    let num = e.target.value.replace(/[^\d]/g, "").slice(0, 16);
    num = num.replace(/(.{4})/g, "$1 ").trim();
    const type = detectCardType(num);
    setCardTypeIcon(cardIcons[type] || null);
    setCardForm(f => ({
      ...f,
      number: num,
      brand: type || ""
    }));
  }
  function handleCardFormChange(field, value) {
    setCardForm(f => ({ ...f, [field]: value }));
  }
  function handleCardSave() {
    if (cardForm.number.length < 19 || !cardForm.name || !/^\d{2}\/\d{2}$/.test(cardForm.expiry)) {
      setSnackbar({ open: true, message: "Enter valid card details!", severity: "error" });
      return;
    }
    const last4 = cardForm.number.replace(/\s/g, "").slice(-4);
    if (editingCard) {
      setCards(prev => prev.map(c =>
        c.id === editingCard.id ? { ...cardForm, id: c.id, last4 } : c
      ));
    } else {
      setCards(prev => [...prev, { ...cardForm, id: Date.now(), last4 }]);
    }
    setSnackbar({ open: true, message: editingCard ? "Card updated!" : "Card added!", severity: "success" });
    setCardDialog(false);
    setEditingCard(null);
    setCardForm({ number: "", name: "", expiry: "", brand: "" });
    setCardTypeIcon(null);
  }
  function handleCardEdit(card) {
    setEditingCard(card);
    setCardForm({ ...card, number: "**** **** **** " + card.last4 });
    setCardTypeIcon(cardIcons[card.brand] || null);
    setCardDialog(true);
  }
  function handleCardAdd() {
    setEditingCard(null);
    setCardForm({ number: "", name: "", expiry: "", brand: "" });
    setCardTypeIcon(null);
    setCardDialog(true);
  }

  // --- Orders (fetch from backend) ---
  const [orders, setOrders] = useState([]);
  const [orderDetail, setOrderDetail] = useState(null);

  useEffect(() => {
    if (user?._id) {
      axios.get(`/api/orders/myorders-userid/${user._id}`)
        .then(res => {
          const sortedOrders = [...res.data].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
          );
          setOrders(sortedOrders);
        })
        .catch(() => setOrders([]));
    }
  }, [user]);

  const handleOrderAgain = (order) => {
    const pharmacyId =
      (order.pharmacy && order.pharmacy._id) ||
      order.pharmacyId ||
      order.pharmacy;
    if (pharmacyId) {
      navigate(`/medicines/${pharmacyId}`);
    } else {
      setSnackbar({
        open: true,
        message: "Pharmacy information missing. Unable to reorder.",
        severity: "error",
      });
    }
  };

  // --- Loyalty
  const totalSpent = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const loyaltyPoints = Math.floor(totalSpent);

  // --- Personalization
  const { t, i18n } = useTranslation();
  const { mode, setMode } = useThemeMode();
  const [language, setLanguage] = useState(i18n.language || "en");
  const handleLanguageChange = (lng) => {
    setLanguage(lng);
    i18n.changeLanguage(lng);
    localStorage.setItem("language", lng);
  };
  const handleThemeChange = (theme) => setMode(theme);

  // --- Settings toggles
  const [orderUpdates, setOrderUpdates] = useState(true);
  const [offerPromos, setOfferPromos] = useState(true);
  const [dataSharing, setDataSharing] = useState(true);
  const [twoFA, setTwoFA] = useState(false);

  // --- Support/Feedback ---
  const [supportDialog, setSupportDialog] = useState(false);
  const [supportMsg, setSupportMsg] = useState("");
  const [chatDialog, setChatDialog] = useState(false);
  const [chatMsg, setChatMsg] = useState("");

  // --- Referral code
  const referralCode = `REMOVED_SECRET-USER-${user?._id || "XXXX"}`;

  // --- Logout (context)
  const handleLogout = () => {
    logout();
    setSnackbar({ open: true, message: "Logged out!", severity: "info" });
    setTimeout(() => navigate("/login"), 1000);
  };

  // --- UI ---
  return (
    <Box sx={{ maxWidth: 700, mx: "auto", mt: 4, p: 2, pb: 10 }}>
      {/* Profile Card */}
      <Paper elevation={6}
        sx={{
          borderRadius: 12, mb: 4, background: "linear-gradient(90deg,#FFD43B 30%,#FFF 100%)",
          boxShadow: "0 8px 32px 0 rgba(31,38,135,0.13)",
          px: 3, py: 2, display: "flex", alignItems: "center",
          position: "relative", width: { xs: "100%", sm: 470 },
          mx: { xs: "auto", sm: "inherit" }
        }}>
        <Box sx={{ position: "relative" }}>
          <Avatar
            src={user.avatar || "https://ui-avatars.com/api/?name=" + encodeURIComponent(user.name || "")}
            sx={{
              width: 90, height: 90, fontSize: 40, border: "3px solid #fff", boxShadow: 3, bgcolor: "#bcbcbc"
            }}
          />
          <IconButton
            sx={{
              position: "absolute", bottom: -8, right: -8, bgcolor: "#fff", border: "2px solid #1976d2", zIndex: 2,
              boxShadow: 2, "&:hover": { bgcolor: "#e3f2fd" }
            }}
            onClick={handleEditProfileOpen}
          >
            <EditIcon sx={{ color: "#1976d2" }} />
          </IconButton>
        </Box>
        <Stack spacing={0.3} ml={3} flex={1}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: "#232323" }}>
            {user.name}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1}>
            <EmailIcon sx={{ fontSize: 19, color: "#1976d2" }} />
            <Typography sx={{ color: "#1976d2", fontSize: 17 }}>{user.email}</Typography>
          </Stack>
          <Typography sx={{ color: "#1976d2", fontSize: 16 }}>{user.mobile}</Typography>
        </Stack>
      </Paper>

      {/* --- Addresses Section --- */}
      <Section
        icon={<HomeIcon sx={{ color: "#17879c" }} />}
        title={t("My Addresses")}
        expanded={openSections.addresses}
        onToggle={() => toggleSection("addresses")}
        action={
          <Button
            startIcon={<AddIcon />}
            size="small"
            variant="outlined"
            sx={{ ml: 2 }}
            onClick={e => { e.stopPropagation(); setEditingAddress(null); setShowAddressForm(true); }}
          >
            {t("Add New")}
          </Button>
        }
      >
        <Stack spacing={2} mt={2}>
          {addresses.length === 0 ? (
            <Typography color="text.secondary">No addresses yet. Add one!</Typography>
          ) : (
            addresses.map((addr) => (
              <Paper
  key={addr.id}
  sx={{
    p: 2, borderRadius: 3,
    bgcolor: addr.isDefault ? "#e3fcec" : "#f7fafc",
    cursor: "pointer",
    transition: "box-shadow 0.2s",
    '&:hover': { boxShadow: 6 },
  }}
  onClick={() => { setEditingAddress(addr); setShowAddressForm(true); }}
>
  <Stack direction="row" alignItems="center" justifyContent="space-between">
    <Box>
      <Typography sx={{ fontWeight: 700 }}>{addr.type}</Typography>
      <Typography sx={{ color: "#888" }}>{addr.addressLine}</Typography>
      {addr.isDefault && <Chip label="Default" size="small" color="success" sx={{ mt: 1, fontWeight: 600 }} />}
    </Box>
    <Stack direction="row" alignItems="center" spacing={1}>
      <IconButton
        onClick={e => {
          e.stopPropagation();
          setEditingAddress(addr);
          setShowAddressForm(true);
        }}
        aria-label="Edit"
        sx={{ mr: 1 }}
      >
        <EditIcon />
      </IconButton>
      <IconButton
        color="error"
        onClick={e => {
          e.stopPropagation();
          handleDeleteAddress(addr);
        }}
        aria-label="Delete"
      >
        <DeleteIcon />
      </IconButton>
    </Stack>
  </Stack>
</Paper>
            ))
          )}
        </Stack>
        <AddressForm
          open={showAddressForm}
          onClose={() => { setShowAddressForm(false); setEditingAddress(null); }}
          onSave={handleAddressSave}
          initial={editingAddress || {}}
        />
      </Section>

      {/* --- Saved Cards & GoDavai Money --- */}
      <Section
        icon={<WalletIcon sx={{ color: "#FFD43B" }} />}
        title={t("Saved Cards & GoDavai Money")}
        expanded={openSections.wallet}
        onToggle={() => toggleSection("wallet")}
      >
        <List dense sx={{ width: "100%", bgcolor: "transparent" }}>
          {cards.length === 0 ? (
            <ListItem>
              <ListItemText primary="No cards saved yet. Add one!" />
            </ListItem>
          ) : (
            cards.map((card) => (
              <ListItem
                key={card.id}
                sx={{
                  bgcolor: "#fffde7", mb: 1, borderRadius: 2, pl: 1.5, pr: 0.5,
                  display: "flex", alignItems: "center"
                }}
                secondaryAction={
                  <IconButton edge="end" aria-label="edit" onClick={() => handleCardEdit(card)}>
                    <EditIcon sx={{ color: "#222" }} />
                  </IconButton>
                }
              >
                {cardIcons[card.brand] && <img src={cardIcons[card.brand]} alt={card.brand} style={{ width: 34, marginRight: 10 }} />}
                <ListItemText
                  primary={
                    <>
                      {card.brand} •••• {card.last4}
                      <span style={{ marginLeft: 12, fontWeight: 500, color: "#444" }}>{card.name}</span>
                      <span style={{ marginLeft: 18, color: "#888" }}>Exp: {card.expiry}</span>
                    </>
                  }
                />
              </ListItem>
            ))
          )}
          <ListItem sx={{ pl: 1.5 }}>
            <CurrencyRupeeIcon sx={{ mr: 1, color: "green" }} />
            <ListItemText primary="GoDavai Money: ₹240" primaryTypographyProps={{ fontWeight: 700, color: "green" }} />
          </ListItem>
          <ListItem button onClick={handleCardAdd}>
            <AddIcon sx={{ color: "#17879c" }} />
            <ListItemText primary={t("Add New Card")} primaryTypographyProps={{ color: "#17879c", fontWeight: 600 }} />
          </ListItem>
        </List>
        {/* Card Form Dialog */}
        <Dialog open={cardDialog} onClose={() => setCardDialog(false)} fullWidth maxWidth="xs">
          <DialogTitle>{editingCard ? "Edit Card" : "Add Card"}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                {cardTypeIcon && <img src={cardTypeIcon} alt="brand" style={{ width: 38, marginRight: 10 }} />}
                <TextField
                  label="Card Number"
                  value={cardForm.number}
                  onChange={handleCardNumberChange}
                  fullWidth
                  inputProps={{
                    maxLength: 19,
                    pattern: "[0-9 ]*",
                    readOnly: editingCard !== null
                  }}
                  disabled={editingCard !== null}
                  sx={{ flex: 1 }}
                  placeholder="1234 5678 9012 3456"
                />
              </Box>
              <TextField
                label="Name on Card"
                value={cardForm.name}
                onChange={e => handleCardFormChange("name", e.target.value)}
                fullWidth
              />
              <TextField
                label="Expiry (MM/YY)"
                value={cardForm.expiry}
                onChange={e => {
                  let v = e.target.value.replace(/[^\d/]/g, "").slice(0, 5);
                  if (v.length === 2 && !v.includes("/")) v += "/";
                  setCardForm(f => ({ ...f, expiry: v }));
                }}
                placeholder="MM/YY"
                fullWidth
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCardDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleCardSave}>Save</Button>
          </DialogActions>
        </Dialog>
      </Section>

      {/* --- Order History --- */}
      <Section
        icon={<HistoryIcon sx={{ color: "#1976d2" }} />}
        title={t("Order History")}
        expanded={openSections.orders}
        onToggle={() => toggleSection("orders")}
        action={
          <Button
            size="small"
            variant="outlined"
            sx={{ ml: 2 }}
            onClick={e => { e.stopPropagation(); navigate('/orders'); }}
          >
            {t("View All Orders")}
          </Button>
        }
      >
        <Stack spacing={2} mt={2}>
          {orders.length === 0 ? (
            <Typography color="text.secondary">No orders yet.</Typography>
          ) : (
            orders.slice(0, 2).map(order => (
              <Paper
                key={order._id || order.id}
                sx={{ p: 2, borderRadius: 3, bgcolor: "#f7fafc", cursor: "pointer" }}
                onClick={() => setOrderDetail(order)}
              >
                <Typography sx={{ fontWeight: 700 }}>
                  Order #{order._id ? order._id.slice(-6).toUpperCase() : order.id}
                </Typography>
                <Typography>
                  ₹{order.total} for {order.items?.length || order.items} items
                </Typography>
                <Typography sx={{ color: "#666" }}>
                  {(order.status || "Placed").charAt(0).toUpperCase() + (order.status || "Placed").slice(1)} | {order.createdAt && order.createdAt.substring(0, 10)}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ mt: 1 }}
                  onClick={e => {
                    e.stopPropagation();
                    handleOrderAgain(order);
                  }}
                >
                  Order Again
                </Button>
              </Paper>
            ))
          )}
        </Stack>
        {/* Order Detail Dialog */}
        <Dialog open={!!orderDetail} onClose={() => setOrderDetail(null)}>
          <DialogTitle>Order Details</DialogTitle>
          <DialogContent>
            {orderDetail && (
              <>
                <Typography sx={{ mb: 1 }}>
                  <b>Order #{orderDetail._id ? orderDetail._id.slice(-6).toUpperCase() : orderDetail.id}</b>
                </Typography>
                <Typography>
                  ₹{orderDetail.total} for {orderDetail.items?.length || orderDetail.items} items
                </Typography>
                {Array.isArray(orderDetail.items) && (
                  <Box sx={{ mt: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>Items:</Typography>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {orderDetail.items.map((item, idx) => (
                        <li key={idx}>
                          {item.name} × {item.quantity} – ₹{item.price}
                        </li>
                      ))}
                    </ul>
                  </Box>
                )}
                {typeof orderDetail.details === "string" && (
                  <Typography>Details: {orderDetail.details}</Typography>
                )}
                <Typography>Status: {orderDetail.status}</Typography>
                <Typography>Date: {orderDetail.createdAt}</Typography>
                <Button
                  variant="contained"
                  sx={{ mt: 2, bgcolor: "#13C0A2", color: "#fff" }}
                  onClick={() => handleOrderAgain(orderDetail)}
                >
                  Order Again
                </Button>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOrderDetail(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      </Section>

      {/* --- Badges & Loyalty --- */}
      <Section
        icon={<LoyaltyIcon sx={{ color: "#31C48D" }} />}
        title={t("Badges & Loyalty")}
        expanded={openSections.badges}
        onToggle={() => toggleSection("badges")}
      >
        <Stack direction="row" spacing={2} mt={2}>
          <Chip icon={<StarsIcon sx={{ color: "#FFD43B" }} />} label="Super Saver" sx={{ fontWeight: 700, bgcolor: "#e3f2fd" }} />
          <Chip icon={<LoyaltyIcon sx={{ color: "#31C48D" }} />} label="Loyal Customer" sx={{ fontWeight: 700, bgcolor: "#e3f2fd" }} />
        </Stack>
        <Typography sx={{ mt: 2 }}>Loyalty Points: <b>{loyaltyPoints}</b></Typography>
        <Typography sx={{ mt: 1, fontSize: 13, color: "#888" }}>
          1 point per ₹1 spent. Earn badges for frequent orders and savings!
        </Typography>
      </Section>

      {/* --- Personalization --- */}
      <Section
        icon={<SettingsIcon sx={{ color: "#FFD43B" }} />}
        title={t("Personalization")}
        expanded={openSections.personalization}
        onToggle={() => toggleSection("personalization")}
      >
        <List dense>
          <ListItem>
            <ListItemText
              primary={<Typography sx={{ fontWeight: 700, fontSize: 17 }}>{t("Language")}</Typography>}
            />
            <TextField
              select
              value={language}
              onChange={e => handleLanguageChange(e.target.value)}
              sx={{ minWidth: 120, fontWeight: 700 }}
              size="small"
            >
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="hi">Hindi</MenuItem>
            </TextField>
          </ListItem>
          <ListItem>
            <ListItemText
              primary={<Typography sx={{ fontWeight: 700, fontSize: 17 }}>{t("Theme")}</Typography>}
            />
            <TextField
              select
              value={mode}
              onChange={e => handleThemeChange(e.target.value)}
              sx={{ minWidth: 120, fontWeight: 700 }}
              size="small"
            >
              <MenuItem value="Light">{t("Light")}</MenuItem>
              <MenuItem value="Dark">{t("Dark")}</MenuItem>
              <MenuItem value="System">{t("System")}</MenuItem>
            </TextField>
          </ListItem>
        </List>
      </Section>

      {/* --- Settings --- */}
      <Section
        icon={<SettingsIcon sx={{ color: "#888" }} />}
        title={t("Settings")}
        expanded={openSections.settings}
        onToggle={() => toggleSection("settings")}
      >
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ fontWeight: 700, color: "#1976d2", mb: 1 }}>Account Settings</Typography>
          <Stack direction="row" spacing={2} mb={2}>
            <Button startIcon={<LockIcon />} variant="outlined" sx={{ mb: 2 }} onClick={() => setChangePassOpen(true)}>Change Password</Button>
            <Button startIcon={<EmailIcon />} variant="outlined" onClick={() => setChangeEmailOpen(true)}>Change Email</Button>
            <Button startIcon={<DeleteIcon />} variant="outlined" color="error" onClick={() => setDeleteOpen(true)}>Delete Account</Button>
          </Stack>
          <Typography sx={{ fontWeight: 700, color: "#1976d2", mb: 1 }}>Notifications</Typography>
          <Stack direction="row" spacing={2} mb={2}>
            <FormControlLabel
              control={<Switch checked={orderUpdates} onChange={e => setOrderUpdates(e.target.checked)} />}
              label="Order Updates"
            />
            <FormControlLabel
              control={<Switch checked={offerPromos} onChange={e => setOfferPromos(e.target.checked)} />}
              label="Offers & Promotions"
            />
          </Stack>
          <Typography sx={{ fontWeight: 700, color: "#1976d2", mb: 1 }}>Privacy</Typography>
          <FormControlLabel
            control={<Switch checked={dataSharing} onChange={e => setDataSharing(e.target.checked)} />}
            label={`Data Sharing: ${dataSharing ? "Allowed" : "Not Allowed"}`}
            sx={{ mb: 2 }}
          />
          <Typography sx={{ fontWeight: 700, color: "#1976d2", mb: 1 }}>Security</Typography>
          <Stack direction="row" spacing={2} mb={2}>
            <FormControlLabel
              control={<Switch checked={twoFA} onChange={e => setTwoFA(e.target.checked)} />}
              label={`2FA: ${twoFA ? "On" : "Off"}`}
            />
            <Chip label="Device Activity: Last login 1 hr ago" sx={{ fontWeight: 700 }} />
          </Stack>
        </Box>
      </Section>

      {/* --- Pharmacist Portal --- */}
      <Section
        icon={<LocalPharmacyIcon sx={{ color: "#13C0A2" }} />}
        title={t("Pharmacist Portal")}
        expanded={openSections.pharmacist}
        onToggle={() => toggleSection("pharmacist")}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mt={2}>
          <Button
  variant="contained"
  sx={{ minWidth: 220 }}
  onClick={() => {
    if (localStorage.getItem("pharmacyToken")) {
      navigate("/pharmacy/dashboard");
    } else {
      navigate("/pharmacy/login");
    }
  }}
>
  {t("Go to Pharmacist Dashboard")}
</Button>
          <Button variant="outlined" sx={{ minWidth: 220 }} onClick={() => navigate("/pharmacy/register")}>
            {t("Register as Pharmacist")}
          </Button>
        </Stack>
      </Section>

      {/* --- Delivery Partner Portal --- */}
      <Section
        icon={<TwoWheelerIcon sx={{ color: "#1976d2" }} />}
        title="Delivery Partner Portal"
        expanded={openSections.delivery}
        onToggle={() => toggleSection("delivery")}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mt={2}>
          <Button
  variant="contained"
  sx={{ minWidth: 220 }}
  onClick={() => {
    if (localStorage.getItem("deliveryToken")) {
      navigate("/delivery/dashboard");
    } else {
      navigate("/delivery/login");
    }
  }}
>
  Go to Delivery Dashboard
</Button>
          <Button
            variant="outlined"
            sx={{ minWidth: 220 }}
            onClick={() => navigate("/delivery/register")}
          >
            Register as Delivery Partner
          </Button>
        </Stack>
      </Section>

      {/* --- Support/Feedback --- */}
      <Section
        icon={<SupportAgentIcon sx={{ color: "#1976d2" }} />}
        title="Support & Feedback"
        expanded={openSections.support}
        onToggle={() => toggleSection("support")}
      >
        <Stack direction="row" spacing={2} mt={2}>
          <Button variant="outlined" sx={{ mr: 2 }} onClick={() => setSupportDialog(true)}>Raise Ticket</Button>
          <Button variant="text" onClick={() => setChatSupportOpen(true)}>Contact Support</Button>
        </Stack>
      </Section>

      {/* --- Refer & Earn --- */}
      <Section
        icon={<GroupAddIcon sx={{ color: "#FFD43B" }} />}
        title="Refer & Earn"
        expanded={openSections.refer}
        onToggle={() => toggleSection("refer")}
      >
        <Typography sx={{ mb: 1, fontWeight: 700 }}>
          Refer friends and earn ₹50 GoDavai Money on their first order!
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <TextField value={referralCode} size="small" sx={{ mr: 2, width: 200 }} disabled />
          <Button variant="contained" onClick={() => {
            navigator.clipboard.writeText(referralCode);
            setSnackbar({ open: true, message: "Referral link copied!", severity: "success" });
          }}>
            Copy Link
          </Button>
        </Box>
      </Section>

      {/* --- Logout Button at Bottom --- */}
      <Box sx={{ display: "flex", justifyContent: "center", mt: 3, mb: 2 }}>
        <Button
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          sx={{
            borderRadius: 6,
            px: 5,
            fontWeight: 700,
            fontSize: 18,
            bgcolor: "#fff",
            border: "2px solid #f44336",
            color: "#f44336",
            boxShadow: "0 2px 8px 0 rgba(244,67,54,0.12)",
            '&:hover': {
              bgcolor: "#fff5f5",
              border: "2.5px solid #f44336"
            }
          }}
          onClick={logout}
        >
          Logout
        </Button>
      </Box>

      {/* --- Snackbars and Dialogs --- */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2200}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
      
      {/* Profile Edit Dialog */}
      <Dialog open={editDialog} onClose={() => {
        // Only allow closing if all required fields are filled
        if (editData.name && editData.email && editData.dob) setEditDialog(false);
      }}>
        <DialogTitle>Edit Profile</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Avatar src={avatarPreview} sx={{ width: 80, height: 80, mr: 2 }} />
              <Button component="label" startIcon={<CameraAltIcon />}>
                Change Avatar
                <input type="file" accept="image/*" hidden ref={fileInputRef} onChange={handleAvatarChange} />
              </Button>
            </Box>
            <TextField
              label="Name"
              required
              fullWidth
              value={editData.name}
              onChange={e => setEditData({ ...editData, name: e.target.value })}
            />
            <TextField
              label="Email"
              required
              fullWidth
              value={editData.email}
              onChange={e => setEditData({ ...editData, email: e.target.value })}
            />
            <TextField
              label="Mobile"
              fullWidth
              value={editData.mobile}
              disabled
            />
            <TextField
              label="DOB"
              required
              fullWidth
              type="date"
              InputLabelProps={{ shrink: true }}
              value={editData.dob}
              onChange={e => setEditData({ ...editData, dob: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setEditDialog(false)}
            disabled={!editData.name || !editData.email || !editData.dob}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleProfileSave}
            disabled={!editData.name || !editData.email || !editData.dob}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2200}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
      <ChatSupportModal open={chatSupportOpen} onClose={() => setChatSupportOpen(false)} />
    </Box>
  );
}

// Reusable Section Component
function Section({ icon, title, expanded, onToggle, action, children }) {
  const theme = useTheme();
  return (
    <Paper sx={{
      mb: 3,
      borderRadius: 4,
      boxShadow: 2,
      px: 2,
      py: 1.5,
      bgcolor: theme.palette.background.paper
    }}>
      <Stack direction="row" alignItems="center" spacing={2} onClick={onToggle} sx={{ cursor: "pointer" }}>
        {icon}
        <Typography sx={{ fontWeight: 700, flex: 1, fontSize: 18 }}>{title}</Typography>
        {action}
        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </Stack>
      <Collapse in={expanded}>{children}</Collapse>
    </Paper>
  );
}