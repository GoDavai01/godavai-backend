import React, { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";

const PaymentPage = () => {
  const navigate = useNavigate();
  const { cart, clearCart } = useCart();
  const [method, setMethod] = useState("UPI");
  const [loading, setLoading] = useState(false);

  // Load address
  const address = JSON.parse(localStorage.getItem("checkoutAddress") || "{}");

  if (!cart.length)
    return <div style={{ padding: 20 }}>No items in cart. <button onClick={() => navigate("/")}>Go Home</button></div>;

  const handlePayment = () => {
    setLoading(true);
    setTimeout(() => {
      clearCart();
      setLoading(false);
      navigate("/payment-success");
    }, 1500);
  };

  return (
    <div className="payment-container">
      <h2>Payment</h2>
      <div className="address-summary">
        <b>Deliver to:</b>
        <div>{address.name}, {address.phone}</div>
        <div>{address.address}, {address.city}, {address.pincode}</div>
      </div>
      <div className="payment-methods">
        <h3>Select Payment Method:</h3>
        <label>
          <input
            type="radio"
            name="method"
            value="UPI"
            checked={method === "UPI"}
            onChange={() => setMethod("UPI")}
          />
          UPI
        </label>
        <label>
          <input
            type="radio"
            name="method"
            value="Card"
            checked={method === "Card"}
            onChange={() => setMethod("Card")}
          />
          Debit/Credit Card
        </label>
        <label>
          <input
            type="radio"
            name="method"
            value="COD"
            checked={method === "COD"}
            onChange={() => setMethod("COD")}
          />
          Cash on Delivery
        </label>
      </div>
      <button
        className="primary-btn"
        disabled={loading}
        style={{ marginTop: 14, width: "100%" }}
        onClick={handlePayment}
      >
        {loading ? "Processing..." : "Pay & Place Order"}
      </button>
    </div>
  );
};

export default PaymentPage;
