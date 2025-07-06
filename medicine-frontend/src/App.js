// src/App.js
import React, { useEffect } from "react";
import axios from "axios";
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import "./i18n";
import { ThemeProvider } from "./context/ThemeContext";
import CssBaseline from "@mui/material/CssBaseline";

import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";

import Navbar from "./components/Navbar";
import BottomNavBar from "./components/BottomNavBar";
import MainLayout from "./components/MainLayout";
import Home from "./components/Home";
import PharmacyLogin from "./pages/PharmacyLogin";
import ViewCartBar from "./components/ViewCartBar";
import Medicines from "./components/Medicines";
import CartPage from "./components/CartPage";
import WelcomePage from "./components/WelcomePage";
import OtpLogin from "./components/OtpLogin";
import PharmacyDashboard from "./components/PharmacyDashboard";
import AdminDashboard from "./components/AdminDashboard";
import DeliveryDashboard from './components/DeliveryDashboard';
import RegisterDeliveryPartner from './components/RegisterDeliveryPartner';
import DriverSimulator from "./components/DriverSimulator";
import PharmacyRegistrationStepper from "./components/PharmacyRegistrationStepper";
import StepperStandalone from "./components/StepperStandalone";
import AdminRegistration from "./components/AdminRegistration";
import ProfilePage from "./components/ProfilePage";
import PharmaciesNearYou from './pages/PharmaciesNearYou';
import CheckoutPage from "./components/CheckoutPage";
import PaymentPage from "./components/PaymentPage";
import PaymentSuccess from "./components/PaymentSuccess";
import MyOrdersPage from "./components/MyOrdersPage";
import OrderTracking from "./components/OrderTracking";
import NotFound from "./components/NotFound";
import SearchResults from "./pages/SearchResults";
import AllMedicines from './pages/AllMedicines';

import ProtectedRoute from "./components/ProtectedRoute";

function AppContent() {
  const location = useLocation();
  const hideNavbar = location.pathname === "/" || location.pathname === "/home";

  // --- Production-ready: Only set axios default once per token change ---
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      axios.defaults.headers.common["Authorization"] = "Bearer " + token;
    } else {
      delete axios.defaults.headers.common["Authorization"];
    }
  }, []); // [] means only on mount

  return (
    <>
      {!hideNavbar && <Navbar />}
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/otp-login" element={<OtpLogin />} />
        <Route path="/pharmacy/login" element={<PharmacyLogin />} />
        <Route path="/order/:orderId" element={<OrderTracking />} />
        <Route path="/order-tracking/:orderId" element={<OrderTracking />} />
        <Route path="/orders/:orderId" element={<OrderTracking />} />
        <Route path="/test-standalone" element={<StepperStandalone />} />
        <Route path="*" element={<NotFound />} />

        {/* Protected routes - user must be logged in */}
        <Route element={<MainLayout />}>
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/medicines/:pharmacyId"
            element={
              <ProtectedRoute>
                <Medicines />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cart"
            element={
              <ProtectedRoute>
                <CartPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pharmacy/dashboard"
            element={
              <ProtectedRoute>
                <PharmacyDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pharmacy/register"
            element={
              <ProtectedRoute>
                <PharmacyRegistrationStepper />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/register"
            element={
              <ProtectedRoute>
                <AdminRegistration />
              </ProtectedRoute>
            }
          />
          <Route
            path="/delivery/dashboard"
            element={
              <ProtectedRoute>
                <DeliveryDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/delivery/register"
            element={
              <ProtectedRoute>
                <RegisterDeliveryPartner />
              </ProtectedRoute>
            }
          />
          <Route
            path="/driver-sim"
            element={
              <ProtectedRoute>
                <DriverSimulator />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pharmacies-near-you"
            element={
              <ProtectedRoute>
                <PharmaciesNearYou />
              </ProtectedRoute>
            }
          />
          <Route
            path="/checkout"
            element={
              <ProtectedRoute>
                <CheckoutPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payment"
            element={
              <ProtectedRoute>
                <PaymentPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payment-success"
            element={
              <ProtectedRoute>
                <PaymentSuccess />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute>
                <MyOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/search"
            element={
              <ProtectedRoute>
                <SearchResults />
              </ProtectedRoute>
            }
          />
          <Route
            path="/all-medicines"
            element={
              <ProtectedRoute>
                <AllMedicines />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
      {!hideNavbar && <BottomNavBar />}
      <ViewCartBar />
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <CssBaseline />
      <AuthProvider>
        <CartProvider>
          <Router>
            <AppContent />
          </Router>
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
