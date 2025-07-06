// src/context/CartContext.js
import React, { createContext, useContext, useState, useEffect } from "react";

const CartContext = createContext();

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export const CartProvider = ({ children }) => {
  const [cart, setCart] = useState(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("cart");
    return saved ? safeParse(saved, []) : [];
  });

  const [selectedPharmacy, setSelectedPharmacy] = useState(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("selectedPharmacy");
    return saved ? safeParse(saved, null) : null;
  });

  const [selectedCity, setSelectedCity] = useState(() => {
    if (typeof window === "undefined") return "Delhi";
    return localStorage.getItem("selectedCity") || "Delhi";
  });

  const [selectedArea, setSelectedArea] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("selectedArea") || "";
  });

  useEffect(() => {
    localStorage.setItem("cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem("selectedPharmacy", JSON.stringify(selectedPharmacy));
  }, [selectedPharmacy]);

  useEffect(() => {
    localStorage.setItem("selectedCity", selectedCity || "");
  }, [selectedCity]);

  useEffect(() => {
    localStorage.setItem("selectedArea", selectedArea || "");
  }, [selectedArea]);

  // MAIN LOGIC: Only allow adding medicines from a single pharmacy
  const addToCart = (medicine) => {
    if (
      !medicine ||
      !medicine._id ||
      !medicine.pharmacy ||
      (typeof medicine.pharmacy === "object" && !medicine.pharmacy._id)
    ) {
      alert("Medicine or pharmacy not specified. Please select a valid medicine with pharmacy.");
      return;
    }
    setCart((prev) => {
      const pharmacyId =
        typeof medicine.pharmacy === "object"
          ? medicine.pharmacy._id
          : medicine.pharmacy;

      if (prev.length === 0) {
        setSelectedPharmacy(
          medicine.pharmacyObj ||
          medicine.pharmacyObject ||
          (typeof medicine.pharmacy === "object" ? medicine.pharmacy : null)
        );
        return [{ ...medicine, quantity: 1 }];
      }

      const cartPharmacyId =
        typeof selectedPharmacy === "object"
          ? selectedPharmacy?._id
          : selectedPharmacy;

      if (
        cartPharmacyId &&
        pharmacyId &&
        cartPharmacyId !== pharmacyId
      ) {
        window.alert(
          "You can only add medicines from one pharmacy at a time. Please clear your cart to add from another pharmacy."
        );
        return prev;
      }

      // Check if medicine is already in cart
      const exists = prev.find((item) => item._id === medicine._id);
      if (exists) {
        return prev.map((item) =>
          item._id === medicine._id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...prev, { ...medicine, quantity: 1 }];
    });
  };

  const removeOneFromCart = (medicine) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item._id === medicine._id
            ? { ...item, quantity: item.quantity - 1 }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (medicine) => {
    setCart((prev) => prev.filter((item) => item._id !== medicine._id));
  };

  const changeQuantity = (medicine, qty) => {
    setCart((prev) =>
      prev.map((item) =>
        item._id === medicine._id
          ? { ...item, quantity: Math.max(1, qty) }
          : item
      )
    );
  };

  const clearCartAndPharmacy = () => {
    setCart([]);
    setSelectedPharmacy(null);
    localStorage.removeItem("cart");
    localStorage.removeItem("selectedPharmacy");
  };

  const clearCart = () => setCart([]);

  return (
    <CartContext.Provider
      value={{
        cart,
        setCart,
        selectedPharmacy,
        setSelectedPharmacy,
        addToCart,
        removeFromCart,
        changeQuantity,
        clearCart,
        removeOneFromCart,
        clearCartAndPharmacy,
        selectedCity,
        setSelectedCity,
        selectedArea,
        setSelectedArea,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => useContext(CartContext);
