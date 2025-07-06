import React, { useEffect, useState } from "react";
import axios from "axios";

export default function PharmacyDashboard() {
  const [orders, setOrders] = useState([]);
  const token = localStorage.getItem("pharmacyToken"); // Save on login

  useEffect(() => {
    axios.get("/api/pharmacy/orders", {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => setOrders(Array.isArray(res.data) ? res.data : []))
      .catch(() => setOrders([]));
  }, [token]);

  // Simple UI to update dosage/note/status
  const updateOrder = (orderId, update) => {
    return axios.patch(`/api/pharmacy/orders/${orderId}`, update, {
      headers: { Authorization: `Bearer ${token}` }
    });
  };

  // Handler to accept order and assign delivery
  const handleAccept = async (orderId) => {
    try {
      await updateOrder(orderId, { status: 1, pharmacyAccepted: true });
      // Assign delivery partner (needs backend endpoint)
      await fetch("/api/delivery/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ orderId }),
      });
      window.location.reload();
    } catch {
      alert("Failed to accept and assign delivery!");
    }
  };

  // Handler to reject order
  const handleReject = async (orderId) => {
    try {
      await updateOrder(orderId, { status: -1, pharmacyAccepted: false });
      window.location.reload();
    } catch {
      alert("Failed to reject order!");
    }
  };

  return (
    <div>
      <h2>Pharmacy Dashboard</h2>
      {orders.map(order => (
        <div key={order.id || order._id} style={{ border: "1px solid #ccc", padding: 16, marginBottom: 18 }}>
          <h4>Order #{order.id || order._id}</h4>
          <p>Status: {order.status}</p>
          <form onSubmit={e => {
            e.preventDefault();
            const dosage = e.target.dosage.value;
            const note = e.target.note.value;
            updateOrder(order.id || order._id, { dosage, note }).then(() => window.location.reload());
          }}>
            <input name="dosage" placeholder="Dosage" defaultValue={order.dosage} />
            <input name="note" placeholder="Note" defaultValue={order.note} />
            <button type="submit">Update</button>
          </form>

          {/* Accept/Reject buttons if order is new/processing */}
          {order.status === 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                style={{ marginRight: 10, background: "#13C0A2", color: "#fff", padding: "6px 16px", border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer" }}
                onClick={() => handleAccept(order.id || order._id)}
              >
                Accept Order
              </button>
              <button
                style={{ background: "#e74c3c", color: "#fff", padding: "6px 16px", border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer" }}
                onClick={() => handleReject(order.id || order._id)}
              >
                Reject Order
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
