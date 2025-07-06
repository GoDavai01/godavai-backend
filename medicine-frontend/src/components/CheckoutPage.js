// src/components/CheckoutPage.js
// src/components/CheckoutPage.js
import React, { useState, useRef } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardMedia,
  TextField,
  Button,
  Divider,
  RadioGroup,
  FormControlLabel,
  Radio,
  Snackbar,
  Alert,
  Stack,
  Chip,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  ToggleButtonGroup,
  ToggleButton,
  Menu,
  MenuItem,
} from "@mui/material";
import PaymentIcon from "@mui/icons-material/Payment";
import HomeIcon from "@mui/icons-material/Home";
import WorkIcon from "@mui/icons-material/Work";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import { useLocation, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import AddressSelector from "./AddressSelector";
import { useAuth } from "../context/AuthContext";
import axios from "axios";

const ICONS = {
  Home: <HomeIcon sx={{ color: "#31c48d" }} />,
  Work: <WorkIcon sx={{ color: "#fea44d" }} />,
  Other: <AddLocationAltIcon sx={{ color: "#1976d2" }} />,
};

// Razorpay Loader
function loadRazorpayScript(src) {
  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve(true);
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

// Place order with/without Razorpay
const handlePlaceOrder = async (
  {
    cart,
    addresses,
    selectedAddressId,
    wantChemistInstruction,
    dosage,
    paymentMethod,
    selectedPharmacy,
    total,
    prescription,
    prescriptionPreview,
    instructions,
    coupon,
    tip,
    donate,
    deliveryInstructions,
    user,
    token,
    setSnackbar,
    clearCart,
    setLoading,
  },
  paymentStatus,
  paymentDetails = {},
  onOrderSuccess // <--- callback for after successful order
) => {
  setLoading(true);
  try {
    let prescriptionUrl = "";
    if (prescription) {
      prescriptionUrl = prescriptionPreview;
    }
    const res = await axios.post(
      "/api/orders",
      {
        items: cart,
        address: addresses.find((a) => a.id === selectedAddressId),
        dosage: wantChemistInstruction ? "Let chemist suggest" : dosage,
        paymentMethod,
        pharmacyId: selectedPharmacy._id,
        total,
        prescription: prescriptionUrl,
        instructions,
        coupon,
        tip,
        donate: donate ? 3 : 0,
        deliveryInstructions,
        paymentStatus,
        paymentDetails,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    clearCart();
    setSnackbar({
      open: true,
      message: "Order placed successfully!",
      severity: "success",
    });
    if (onOrderSuccess && typeof onOrderSuccess === "function") {
      onOrderSuccess(res.data);
    }
  } catch (err) {
    setSnackbar({
      open: true,
      message:
        err.response?.data?.message || "Order failed! Please try again.",
      severity: "error",
    });
  }
  setLoading(false);
};

// Helper: universal image resolver (relative path, prod ready)
const getImageUrl = (img) => {
  if (!img)
    return "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg?w=400";
  if (img.startsWith("/uploads/"))
    return `${process.env.REACT_APP_API_URL || ""}${img}`;
  return img;
};

export default function CheckoutPage() {
  // Cart/Auth
  const { cart, clearCart, selectedPharmacy } = useCart();
  const { user, token, addresses, updateAddresses } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Prescription quote order state
  const [isPrescriptionFlow, setIsPrescriptionFlow] = useState(false);
  const [prescriptionOrder, setPrescriptionOrder] = useState(null);
  const lockedAddress = isPrescriptionFlow && prescriptionOrder?.address;
  const [quoteItems, setQuoteItems] = useState([]);
  const [quoteTotal, setQuoteTotal] = useState(0);
  const [quoteMessage, setQuoteMessage] = useState("");

  // ---- STEP 2: Fetch quote order if orderId is in URL ----
  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const orderId = params.get("orderId");
    if (orderId && token) {
      setIsPrescriptionFlow(true);
      axios
        .get(`/api/prescriptions/order/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => {
          setPrescriptionOrder(res.data);
          if (res.data.tempQuote && res.data.tempQuote.items && res.data.tempQuote.items.length) {
            setQuoteItems(res.data.tempQuote.items);
            setQuoteTotal(
              typeof res.data.tempQuote.approxPrice === "number"
                ? res.data.tempQuote.approxPrice
                : res.data.tempQuote.items.filter(i => i.available !== false)
                    .reduce((sum, i) => sum + ((i.price || 0) * (i.quantity || 1)), 0)
            );
            setQuoteMessage(res.data.tempQuote.message || "");
          } else if (res.data.quote && res.data.quote.items && res.data.quote.items.length) {
            setQuoteItems(res.data.quote.items);
            setQuoteTotal(res.data.quote.price || 0);
            setQuoteMessage(res.data.quote.message || "");
          } else if (Array.isArray(res.data.quotes) && res.data.quotes.length) {
            const latest = res.data.quotes[res.data.quotes.length - 1];
            setQuoteItems(latest.items || []);
            setQuoteTotal(latest.price || 0);
            setQuoteMessage(latest.message || "");
          } else {
            setQuoteItems([]);
            setQuoteTotal(0);
            setQuoteMessage("");
          }
        })
        .catch(() => {
          setSnackbar({ open: true, message: "Failed to fetch quote/order!", severity: "error" });
          setIsPrescriptionFlow(false);
        });
    }
  }, [location.search, token]);

  // Bill and order state
  const [prescription, setPrescription] = useState(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success",
  });
  const [loading, setLoading] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [wantChemistInstruction, setWantChemistInstruction] = useState(false);

  // Address state
  const [selectedAddressId, setSelectedAddressId] = useState(addresses[0]?.id || null);
  const [addressFormOpen, setAddressFormOpen] = useState(false);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState("cod");

  // Dosage (if user types)
  const [dosage, setDosage] = useState("");

  // Tip/Donate
  const [tip, setTip] = useState(0);
  const [donate, setDonate] = useState(false);

  // Offer Modal
  const [anchorEl, setAnchorEl] = useState(null);
  const offerOpen = Boolean(anchorEl);

  // Prescription ref
  const prescriptionInput = useRef();

  // Delivery instructions for delivery partner (NEW STATE)
  const [deliveryInstructions, setDeliveryInstructions] = useState("");

  // --- Unified Bill Calculation (quote OR cart) ---
  const tipAmounts = [10, 15, 20, 30];
  const platformFee = 10;
  const availableOffers = [
    { code: "NEW15", desc: "Get 15% off for new users. Max ₹100 off." },
    { code: "FREESHIP", desc: "Free delivery on orders above ₹399." },
    { code: "SAVE30", desc: "Save ₹30 on your next order!" },
  ];

  // --- Bill calculation logic (depends on flow) ---
  const itemList = isPrescriptionFlow && quoteItems.length
    ? quoteItems.filter(med => med.available !== false)
    : cart;
  const itemTotal = itemList.reduce((sum, med) =>
    sum + (med.price || 0) * (med.quantity || 1), 0
  );

  const deliveryFee = itemTotal > 499 ? 0 : 25;
  const gst = Math.round(itemTotal * 0.05 * 100) / 100;
  const discount = couponApplied
    ? Math.min(100, Math.round(itemTotal * 0.15))
    : 0;
  const fullTotal = itemTotal +
    deliveryFee +
    gst +
    platformFee +
    (tip || 0) +
    (donate ? 3 : 0) -
    discount;

  // Handle address add/save
  const handleSaveAddress = async (address) => {
    let updated;
    if (address.id && addresses.some((a) => a.id === address.id)) {
      updated = addresses.map((a) => (a.id === address.id ? address : a));
    } else {
      address.id = Date.now().toString();
      updated = [...addresses, address];
    }
    await updateAddresses(updated);
    setSelectedAddressId(address.id);
    setAddressFormOpen(false);
  };

  // Confirm-before-delete handler
  const handleDeleteAddress = async (addr) => {
    if (!window.confirm("Are you sure you want to delete this address?")) return;
    const updated = addresses.filter(a => a.id !== addr.id);
    await updateAddresses(updated);
    setSnackbar({ open: true, message: "Address deleted!", severity: "success" });
    if (selectedAddressId === addr.id && updated.length) {
      setSelectedAddressId(updated[0].id);
    } else if (updated.length === 0) {
      setSelectedAddressId(null);
    }
  };

  // Handle prescription file
  const handlePrescriptionChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPrescription(file);
    const reader = new FileReader();
    reader.onload = () => setPrescriptionPreview(reader.result);
    reader.readAsDataURL(file);
  };

  // ------ RAZORPAY + ORDER LOGIC -------
  const handleOrder = async () => {
    if (isPrescriptionFlow && prescriptionOrder) {
      setLoading(true);
      try {
        await axios.post(
          `/api/prescriptions/respond/${prescriptionOrder._id}`,
          { response: "accepted" },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        await axios.put(
          `/api/prescriptions/${prescriptionOrder._id}/accept`,
          { paymentStatus: "PAID", paymentDetails: { method: "COD" } },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const res = await axios.post(
          `/api/prescriptions/${prescriptionOrder._id}/convert-to-order`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.data && res.data.orderId) {
          setSnackbar({ open: true, message: "Order placed! Track in My Orders.", severity: "success" });
          setTimeout(() => navigate(`/order/${res.data.orderId}`), 1200);
        } else {
          setSnackbar({ open: true, message: "Order placed but failed to update order!", severity: "warning" });
          setTimeout(() => navigate("/orders"), 1200);
        }
      } catch (err) {
        setSnackbar({ open: true, message: "Failed to confirm order!", severity: "error" });
      }
      setLoading(false);
      return;
    }
    if (!user || !token) {
      setSnackbar({
        open: true,
        message: "Please log in to place an order!",
        severity: "error",
      });
      setTimeout(() => navigate("/login"), 1200);
      return;
    }
    if (!cart.length) {
      setSnackbar({
        open: true,
        message: "Your cart is empty.",
        severity: "error",
      });
      return;
    }
    if (!selectedPharmacy || !selectedPharmacy._id) {
      setSnackbar({
        open: true,
        message: "Please select a pharmacy.",
        severity: "error",
      });
      return;
    }
    const address = isPrescriptionFlow && lockedAddress
      ? lockedAddress
      : addresses.find((a) => a.id === selectedAddressId);
    if (!address) {
      setSnackbar({
        open: true,
        message: "Please select or add an address.",
        severity: "error",
      });
      return;
    }
    // --- COD ---
    if (paymentMethod === "cod") {
      await handlePlaceOrder(
        {
          cart,
          addresses,
          selectedAddressId,
          wantChemistInstruction,
          dosage,
          paymentMethod,
          selectedPharmacy,
          total: fullTotal,
          prescription,
          prescriptionPreview,
          instructions,
          coupon,
          tip,
          donate,
          deliveryInstructions,
          user,
          token,
          setSnackbar,
          clearCart,
          navigate,
          setLoading,
        },
        "COD",
        {},
        (order) => {
          navigate(`/order/${order._id}`);
        }
      );
      return;
    }
    // --- Razorpay ---
    setLoading(true);
    const res = await loadRazorpayScript("https://checkout.razorpay.com/v1/checkout.js");
    if (!res) {
      setSnackbar({
        open: true,
        message: "Razorpay SDK failed to load. Try again.",
        severity: "error",
      });
      setLoading(false);
      return;
    }
    let orderBackend;
    try {
      orderBackend = await axios.post(
        "/api/payments/razorpay/order",
        {
          amount: Math.round(fullTotal * 100),
          currency: "INR",
          receipt: "order_rcptid_" + Date.now(),
        }
      );
    } catch (err) {
      setSnackbar({
        open: true,
        message: "Failed to create Razorpay order. Try again.",
        severity: "error",
      });
      setLoading(false);
      return;
    }
    const options = {
      key: "REMOVED_SECRET", // <- CHANGE FOR LIVE!
      amount: orderBackend.data.amount,
      currency: "INR",
      name: "GoDavai - Medicine Delivery",
      description: "Order Payment",
      order_id: orderBackend.data.id,
      handler: async function (response) {
        if (isPrescriptionFlow && prescriptionOrder) {
          try {
            await axios.post(
              `/api/prescriptions/respond/${prescriptionOrder._id}`,
              { response: "accepted" },
              { headers: { Authorization: `Bearer ${token}` } }
            );
            await axios.put(
              `/api/prescriptions/${prescriptionOrder._id}/accept`,
              { paymentStatus: "PAID", paymentDetails: response },
              { headers: { Authorization: `Bearer ${token}` } }
            );
            const res = await axios.post(
              `/api/prescriptions/${prescriptionOrder._id}/convert-to-order`,
              {},
              { headers: { Authorization: `Bearer ${token}` } }
            );
            setLoading(false);
            if (res.data && res.data.orderId) {
              setSnackbar({ open: true, message: "Order placed! Track in My Orders.", severity: "success" });
              setTimeout(() => navigate(`/order/${res.data.orderId}`), 1200);
            } else {
              setSnackbar({ open: true, message: "Order placed but failed to update order!", severity: "warning" });
              setTimeout(() => navigate("/orders"), 1200);
            }
          } catch (err) {
            setSnackbar({ open: true, message: "Failed to confirm order!", severity: "error" });
            setLoading(false);
          }
          return;
        }
        // --- Normal flow ---
        await handlePlaceOrder(
          {
            cart,
            addresses,
            selectedAddressId,
            wantChemistInstruction,
            dosage,
            paymentMethod,
            selectedPharmacy,
            total: fullTotal,
            prescription,
            prescriptionPreview,
            instructions,
            coupon,
            tip,
            donate,
            deliveryInstructions,
            user,
            token,
            setSnackbar,
            clearCart,
            setLoading,
          },
          "PAID",
          response,
          (order) => {
            navigate(`/order/${order._id}`);
          }
        );
      },
      prefill: {
        name: user.name,
        email: user.email,
        contact: addresses[0]?.phone || "",
      },
      theme: { color: "#13c7ae" },
      modal: {
        ondismiss: () => setLoading(false),
      },
    };
    setLoading(false);
    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  if (!cart.length && !isPrescriptionFlow)
    return (
      <Box sx={{ textAlign: "center", pt: 8 }}>
        <PaymentIcon sx={{ fontSize: 70, color: "#FFD43B", mb: 2 }} />
        <Typography
          variant="h5"
          sx={{ color: "#FFD43B", mb: 1, fontWeight: 700 }}
        >
          No items in cart
        </Typography>
        <Button
          variant="contained"
          color="primary"
          sx={{ mt: 2, px: 4, py: 1.2, fontWeight: 700, fontSize: 16 }}
          onClick={() => navigate("/medicines")}
        >
          Browse Medicines
        </Button>
      </Box>
    );

  return (
    <Box sx={{ maxWidth: 480, mx: "auto", mt: 2, mb: 7, px: 1 }}>
      {/* Medicine summary (top) - Show quoted or cart */}
      <Card sx={{ mb: 2, borderRadius: 4, boxShadow: 2, p: 2 }}>
        <CardContent sx={{ p: 0 }}>
          {isPrescriptionFlow && prescriptionOrder ? (
            <>
              <Typography variant="subtitle2" sx={{ color: "#17879c", fontWeight: 700, mb: 1 }}>
                Prescription Quote (from {prescriptionOrder.pharmacy?.name || "pharmacy"})
              </Typography>
              <Stack spacing={1}>
                {quoteItems.map((med, idx) => (
                  <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 2, minHeight: 56, justifyContent: "space-between" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
                      <CardMedia component="img" sx={{ width: 48, height: 48, objectFit: "contain", bgcolor: "#FFF9DB", borderRadius: 2 }} image={getImageUrl(med.img)} alt={med.medicineName} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body1" sx={{ fontWeight: 600 }}>{med.medicineName} {med.brand && <span>({med.brand})</span>}</Typography>
                        <Typography variant="body2" sx={{ color: "#555", fontSize: 15 }}>
                          ₹{med.price} × {med.quantity}
                          {med.available === false && <span style={{ color: "#e53935", marginLeft: 8 }}>(Unavailable)</span>}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography sx={{ color: "#17879c", fontWeight: 700, minWidth: 72, textAlign: "right" }}>
                      {med.available === false ? "--" : `= ₹${med.price * med.quantity}`}
                    </Typography>
                  </Box>
                ))}
              </Stack>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body1" sx={{ fontWeight: 700 }}>
                Quoted Total: <span style={{ color: "#17879c" }}>₹{quoteTotal}</span>
              </Typography>
              {quoteMessage && (
                <Typography variant="body2" sx={{ mt: 1, color: "#ff9800" }}>
                  Note from Pharmacy: {quoteMessage}
                </Typography>
              )}
            </>
          ) : (
            <>
              <Typography
                variant="subtitle2"
                sx={{ color: "#17879c", fontWeight: 700, mb: 1 }}
              >
                Medicines in your order
              </Typography>
              <Stack spacing={1}>
                {cart.map((med) => (
                  <Box
                    key={med._id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      minHeight: 56,
                      justifyContent: "space-between",
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
                      <CardMedia
                        component="img"
                        sx={{
                          width: 48,
                          height: 48,
                          objectFit: "contain",
                          bgcolor: "#FFF9DB",
                          borderRadius: 2,
                        }}
                        image={getImageUrl(med.img)}
                        alt={med.name}
                      />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body1" sx={{ fontWeight: 600 }}>
                          {med.name}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ color: "#555", fontSize: 15 }}
                        >
                          ₹{med.price} × {med.quantity}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography sx={{ color: "#17879c", fontWeight: 700, minWidth: 72, textAlign: "right" }}>
                      = ₹{med.price * med.quantity}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      {/* Address: Locked for prescription orders, normal for others */}
{isPrescriptionFlow && lockedAddress ? (
  <Box sx={{ mb: 2, bgcolor: "#23242c", p: 2, borderRadius: 2 }}>
    <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: "#ffd43b" }}>
      Delivery Address (locked)
    </Typography>
    <Typography sx={{ color: "#fff", fontWeight: 700 }}>{lockedAddress.name}</Typography>
    <Typography sx={{ color: "#cfd8dc" }}>{lockedAddress.phone}</Typography>
    <Typography sx={{ color: "#cfd8dc" }}>
      {lockedAddress.addressLine}
      {lockedAddress.floor && `, Floor: ${lockedAddress.floor}`}
      {lockedAddress.landmark && `, ${lockedAddress.landmark}`}
    </Typography>
    <Typography sx={{ color: "#cfd8dc", mt: 1, fontStyle: "italic" }}>
      (You can't change address for prescription orders)
    </Typography>
  </Box>
) : (
  <>
    <AddressSelector
      addresses={addresses}
      selectedAddressId={selectedAddressId}
      onSelect={setSelectedAddressId}
      onAddAddress={() => setAddressFormOpen(true)}
      onEdit={addr => setAddressFormOpen(true)}
      onDelete={handleDeleteAddress} // ADD THIS
    />
    <AddressForm
      open={addressFormOpen}
      onClose={() => setAddressFormOpen(false)}
      onSave={handleSaveAddress}
      initial={addresses.find((a) => a.id === selectedAddressId) || {}}
    />
  </>
)}

      {/* Prescription, Dosage, Instructions (as before) */}
      <Card sx={{ p: 3, borderRadius: 4, boxShadow: 2, mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Checkbox
            checked={wantChemistInstruction}
            onChange={(e) => setWantChemistInstruction(e.target.checked)}
          />
          <Typography>
            Do you want <b>dosage instruction from chemist?</b>
          </Typography>
        </Stack>
        {!wantChemistInstruction && (
          <TextField
            label="Dosage instructions (optional)"
            multiline
            fullWidth
            value={dosage}
            onChange={(e) => setDosage(e.target.value)}
            sx={{ mb: 2 }}
            placeholder="E.g., 1 tablet after lunch, as prescribed, etc."
          />
        )}
        <Box sx={{ mt: 1, mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Prescription (if needed)
          </Typography>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<AddAPhotoIcon />}
            onClick={() => prescriptionInput.current.click()}
            sx={{
              fontWeight: 700,
              mb: 1,
              bgcolor: "#fffde7",
              color: "#ffc107",
              border: "1.5px solid #ffc107",
              "&:hover": {
                bgcolor: "#fff8e1",
                borderColor: "#ffa000",
              },
            }}
          >
            {prescription ? "Change File" : "Upload Prescription"}
          </Button>
          <input
            type="file"
            accept="image/*,application/pdf"
            style={{ display: "none" }}
            ref={prescriptionInput}
            onChange={handlePrescriptionChange}
          />
          {prescriptionPreview && (
            <Box sx={{ mt: 1 }}>
              <img
                src={prescriptionPreview}
                alt="Prescription Preview"
                style={{
                  maxWidth: 200,
                  borderRadius: 8,
                  border: "1px solid #ddd",
                }}
              />
            </Box>
          )}
        </Box>
        <TextField
          label="Instructions for chemist (optional)"
          multiline
          fullWidth
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          sx={{ mt: 2 }}
          placeholder="Any note for your order or delivery..."
        />
      </Card>

      {/* Bill Summary (always old detailed logic) */}
      <Card
        sx={{
          borderRadius: 4,
          boxShadow: 2,
          mb: 2,
          px: 2,
          py: 2,
          overflowX: "auto",
        }}
      >
        <Typography
          variant="h6"
          sx={{
            color: "#17879c",
            fontWeight: 800,
            mb: 2,
            fontFamily: "Montserrat, Arial, sans-serif",
            letterSpacing: 0.5,
          }}
        >
          Bill Summary
        </Typography>
        <table style={{ width: "100%", fontSize: 16, fontFamily: "inherit" }}>
          <tbody>
            <tr>
              <td style={{ color: "#666", padding: "6px 4px", width: "60%" }}>
                Item total
              </td>
              <td align="right">₹{itemTotal}</td>
            </tr>
            <tr>
              <td style={{ color: "#666", padding: "6px 4px" }}>
                GST & Taxes (5%)
              </td>
              <td align="right">₹{gst}</td>
            </tr>
            <tr>
              <td style={{ color: "#666", padding: "6px 4px" }}>
                Delivery Fee
              </td>
              <td align="right">
                {deliveryFee === 0 ? (
                  <span style={{ color: "#10b981" }}>Free</span>
                ) : (
                  <>₹{deliveryFee}</>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ color: "#666", padding: "6px 4px" }}>
                Platform Fee
              </td>
              <td align="right">₹{platformFee}</td>
            </tr>
            {tip > 0 && (
              <tr>
                <td style={{ color: "#1976d2", padding: "6px 4px" }}>
                  Delivery Tip
                </td>
                <td align="right" style={{ color: "#1976d2" }}>
                  +₹{tip}
                </td>
              </tr>
            )}
            {donate ? (
              <tr>
                <td style={{ color: "#43a047", padding: "6px 4px" }}>
                  Donation
                </td>
                <td align="right" style={{ color: "#43a047" }}>
                  +₹3
                </td>
              </tr>
            ) : null}
            {discount > 0 && (
              <tr>
                <td style={{ color: "#31c48d", padding: "6px 4px" }}>
                  Coupon Discount
                </td>
                <td align="right" style={{ color: "#31c48d" }}>
                  −₹{discount}
                </td>
              </tr>
            )}
            <tr style={{ fontWeight: 700 }}>
              <td
                style={{
                  padding: "6px 4px",
                  fontSize: 18,
                  color: "#17879c",
                  fontWeight: 700,
                }}
              >
                Grand Total
              </td>
              <td
                align="right"
                style={{ fontSize: 18, color: "#17879c", fontWeight: 700 }}
              >
                ₹{fullTotal}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Coupon entry + view offers */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ mt: 2, mb: 1 }}
        >
          <TextField
            label="Apply Coupon"
            size="small"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
            disabled={couponApplied}
            sx={{ flex: 1, background: "#fff", borderRadius: 1 }}
          />
          <Button
            variant="contained"
            size="small"
            startIcon={<LocalOfferIcon />}
            disabled={couponApplied || !coupon}
            onClick={() => setCouponApplied(true)}
            sx={{
              backgroundColor: "#ffd43b",
              color: "#17879c",
              fontWeight: 600,
              "&:hover": { backgroundColor: "#ffe066" },
            }}
          >
            Apply
          </Button>
          <Button
            variant="outlined"
            size="small"
            sx={{
              minWidth: 36,
              borderColor: "#ffd43b",
              color: "#ffd43b",
              fontWeight: 700,
              ml: 1,
            }}
            onClick={(e) => setAnchorEl(e.currentTarget)}
          >
            View all offers
          </Button>
          <Menu
            anchorEl={anchorEl}
            open={offerOpen}
            onClose={() => setAnchorEl(null)}
          >
            {availableOffers.map((offer) => (
              <MenuItem
                key={offer.code}
                onClick={() => {
                  setCoupon(offer.code);
                  setAnchorEl(null);
                }}
              >
                <LocalOfferIcon sx={{ fontSize: 18, mr: 1 }} />
                <b>{offer.code}</b> – {offer.desc}
              </MenuItem>
            ))}
          </Menu>
        </Stack>
        {couponApplied && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={() => {
              setCoupon("");
              setCouponApplied(false);
            }}
            sx={{ mt: 1 }}
          >
            Remove Coupon
          </Button>
        )}
      </Card>

      {/* Instructions for Delivery Partner (as before) */}
      <Card
        sx={{
          borderRadius: 4,
          boxShadow: 2,
          mb: 2,
          px: 2,
          py: 2,
          background: "#fff",
        }}
      >
        <TextField
          label="Instructions for Delivery Partner (optional)"
          multiline
          fullWidth
          value={deliveryInstructions}
          onChange={e => setDeliveryInstructions(e.target.value)}
          sx={{ mt: 1 }}
          placeholder="Any note for your delivery partner..."
        />
      </Card>

      {/* Tip and Donate (old logic) */}
      <Card
        sx={{
          borderRadius: 4,
          boxShadow: 2,
          mb: 2,
          px: 2,
          py: 2,
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 700, mb: 1, color: "#17879c" }}
        >
          Add a Delivery Tip
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          {tipAmounts.map((amount) => (
            <Button
              key={amount}
              variant={tip === amount ? "contained" : "outlined"}
              onClick={() => setTip(amount)}
              sx={{
                borderRadius: 4,
                minWidth: 48,
                bgcolor: tip === amount ? "#1976d2" : "#fff",
                color: tip === amount ? "#fff" : "#1976d2",
                borderColor: "#1976d2",
                fontWeight: 700,
              }}
            >
              ₹{amount}
            </Button>
          ))}
          <Button
            variant={tip && !tipAmounts.includes(tip) ? "contained" : "outlined"}
            sx={{
              borderRadius: 4,
              minWidth: 60,
              bgcolor:
                tip && !tipAmounts.includes(tip) ? "#1976d2" : "#fff",
              color:
                tip && !tipAmounts.includes(tip) ? "#fff" : "#1976d2",
              borderColor: "#1976d2",
              fontWeight: 700,
            }}
            onClick={() => {
              const amt = prompt("Enter custom tip amount:");
              const value = parseInt(amt);
              if (!isNaN(value) && value > 0) setTip(value);
            }}
          >
            Other
          </Button>
          <Button
            variant="text"
            color="error"
            sx={{ fontWeight: 700, ml: 2 }}
            onClick={() => setTip(0)}
          >
            No Tip
          </Button>
        </Stack>
        <Divider sx={{ mb: 2 }} />
        <Stack direction="row" spacing={1} alignItems="center">
          <Checkbox
            checked={donate}
            icon={<VolunteerActivismIcon />}
            checkedIcon={<VolunteerActivismIcon color="success" />}
            onChange={(e) => setDonate(e.target.checked)}
          />
          <Typography sx={{ color: "#388e3c", fontWeight: 600 }}>
            Donate ₹3 to "Serve Brighter Future"
          </Typography>
        </Stack>
      </Card>

      {/* Payment Methods & Place Order (old logic with dynamic button text) */}
      <Card
        sx={{
          borderRadius: 4,
          boxShadow: 2,
          mb: 2,
          px: 2,
          pt: 2,
          pb: 2,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          Pay Using
        </Typography>
        <RadioGroup
          row
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          <FormControlLabel
            value="cod"
            control={<Radio />}
            label="Cash on Delivery"
          />
          <FormControlLabel value="upi" control={<Radio />} label="UPI" />
          <FormControlLabel
            value="card"
            control={<Radio />}
            label="Credit/Debit Card"
          />
        </RadioGroup>
        <Button
          variant="contained"
          color="primary"
          size="large"
          sx={{
            fontWeight: 700,
            fontSize: 18,
            px: 4,
            py: 1.3,
            mt: 2,
            width: "100%",
            bgcolor: "#13c7ae",
            "&:hover": { bgcolor: "#12b2a2" },
          }}
          onClick={handleOrder}
          disabled={loading}
        >
          {loading
            ? "Processing..."
            : isPrescriptionFlow
              ? `Accept Quote & Pay ₹${fullTotal}`
              : `PAY ₹${fullTotal} & PLACE ORDER`}
        </Button>
      </Card>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={1800}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

// AddressForm Component (same as your old one)
function AddressForm({ open, onClose, onSave, initial = {} }) {
  const [type, setType] = useState(initial.type || "Home");
  const [name, setName] = useState(initial.name || "");
  const [phone, setPhone] = useState(initial.phone || "");
  const [addressLine, setAddressLine] = useState(initial.addressLine || "");
  const [floor, setFloor] = useState(initial.floor || "");
  const [landmark, setLandmark] = useState(initial.landmark || "");

  React.useEffect(() => {
    setType(initial.type || "Home");
    setName(initial.name || "");
    setPhone(initial.phone || "");
    setAddressLine(initial.addressLine || "");
    setFloor(initial.floor || "");
    setLandmark(initial.landmark || "");
  }, [open, initial]);

  const handleSave = () => {
    if (!name || !phone || !addressLine) return;
    onSave({
      type,
      name,
      phone,
      addressLine,
      floor,
      landmark,
      id: initial.id || Date.now(),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add/Edit Address</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <ToggleButtonGroup
            value={type}
            exclusive
            onChange={(_, t) => t && setType(t)}
          >
            <ToggleButton value="Home">Home</ToggleButton>
            <ToggleButton value="Work">Work</ToggleButton>
            <ToggleButton value="Other">Other</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            label="Name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Phone"
            fullWidth
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TextField
            label="Address"
            fullWidth
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
          />
          <TextField
            label="Floor (optional)"
            fullWidth
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          />
          <TextField
            label="Landmark (optional)"
            fullWidth
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
          />
          <Button variant="contained" onClick={handleSave}>
            Save Address
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
