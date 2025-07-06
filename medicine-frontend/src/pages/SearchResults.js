import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useCart } from '../context/CartContext';

const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

const highlight = (str, color = "#13C0A2") => (
  <span style={{ color, fontWeight: 800 }}>{str}</span>
);

const SearchResults = () => {
  const location = useLocation();
  const query = new URLSearchParams(location.search).get("q") || "";
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoSuggestions, setAutoSuggestions] = useState([]);
  const [pharmacySearch, setPharmacySearch] = useState("");
  const { addToCart } = useCart();
  const navigate = useNavigate();

  // Always use latest city/area from localStorage
  const selectedCity = localStorage.getItem("city") || "Mumbai";
  const selectedArea = localStorage.getItem("area") || "";

  useEffect(() => {
    if (!query) return;
    setLoading(true);

    // 1. Fetch active pharmacies for city/area
    axios
      .get(`${API_BASE}/api/pharmacies`, {
        params: {
          city: selectedCity,
          area: selectedArea,
        }
      })
      .then(res => {
        const activePharmacyIds = (res.data || [])
          .filter(ph => ph.active)
          .map(ph => ph._id);

        // 2. Now fetch offers for this medicine
        axios
          .get(`${API_BASE}/api/medicines/by-name`, {
            params: {
              name: query,
              city: selectedCity,
              area: selectedArea
            }
          })
          .then((offersRes) => {
            // 3. Filter offers for only active pharmacies
            const filtered = (offersRes.data || []).filter(offer =>
              offer.pharmacy && activePharmacyIds.includes(offer.pharmacy._id || offer.pharmacy)
            );
            setOffers(filtered);
          })
          .catch(() => setOffers([]))
          .finally(() => setLoading(false));
      })
      .catch(() => {
        setOffers([]);
        setLoading(false);
      });

  }, [query, selectedCity, selectedArea]);

  useEffect(() => {
    if (!query) return;
    axios
      .get(`${API_BASE}/api/medicines/search`, {
        params: { q: query, city: selectedCity, area: selectedArea }
      })
      .then((res) => {
        const names = Array.from(new Set(res.data.map((m) => m.name)));
        setAutoSuggestions(names);
      })
      .catch(() => setAutoSuggestions([]));
  }, [query, selectedCity, selectedArea]);

  const handleSuggestionClick = (suggestion) => {
    navigate(`/search?q=${encodeURIComponent(suggestion)}`);
  };

  const filteredOffers = offers.filter((offer) => {
    if (!pharmacySearch) return true;
    const term = pharmacySearch.toLowerCase();
    return (
      (offer.pharmacy?.name || "").toLowerCase().includes(term) ||
      (offer.pharmacy?.area || "").toLowerCase().includes(term) ||
      (offer.pharmacy?.city || "").toLowerCase().includes(term)
    );
  });

  return (
    <div style={{
      padding: 24,
      maxWidth: 700,
      margin: "0 auto",
      minHeight: "100vh"
    }}>
      <h2 style={{ fontWeight: 800, color: "#17879c", marginBottom: 2 }}>
        Search Results for:
      </h2>
      <div style={{ fontSize: 25, color: "#17879c", marginBottom: 16 }}>
        {highlight(query)}
      </div>
      {/* Suggestions */}
      {autoSuggestions.length > 0 && (
        <div style={{
          background: "#f8faff",
          borderRadius: 12,
          marginBottom: 18,
          boxShadow: "0 0 9px #dde8ff30",
          padding: "10px 10px 8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap"
        }}>
          <span style={{ color: "#aaa", fontWeight: 600 }}>Suggestions:</span>
          {autoSuggestions.map((suggestion, i) => (
            <button
              key={suggestion}
              onClick={() => handleSuggestionClick(suggestion)}
              style={{
                background: "#fff",
                border: "1.5px solid #13C0A2",
                color: "#13C0A2",
                borderRadius: 9,
                padding: "2.5px 14px",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                margin: "2px 0"
              }}>
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* Pharmacy search input */}
      <input
        type="text"
        placeholder="Search pharmacy, area or city…"
        value={pharmacySearch}
        onChange={e => setPharmacySearch(e.target.value)}
        style={{
          width: "100%",
          padding: "10px",
          marginBottom: 18,
          borderRadius: 8,
          border: "1.5px solid #13C0A2",
          fontSize: 16,
          outline: "none",
        }}
      />

      <h3 style={{ fontWeight: 700, color: "#1188A3", margin: "22px 0 6px 0" }}>
        Pharmacies in {highlight(selectedCity || "your city")}
        {" with "}{highlight(query)}
      </h3>
      {loading ? (
        <p style={{ marginTop: 20 }}>Loading...</p>
      ) : filteredOffers.length === 0 ? (
        <div style={{
          background: "#fffbe6",
          color: "#b29d29",
          borderRadius: 9,
          padding: "18px 16px",
          boxShadow: "0 2px 8px #ffe06644",
          fontWeight: 600,
          marginTop: 18
        }}>
          No pharmacies found in <b>{selectedCity}</b> for <b>{query}</b>.
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          {filteredOffers.map((offer, idx) => (
            <div
              key={offer.medId || offer._id || idx}
              style={{
                background: "#f8fbfc",
                borderRadius: 15,
                marginBottom: 16,
                boxShadow: "0 3px 10px #dde8ff44",
                padding: 0,
                display: "flex",
                alignItems: "stretch",
                border: "1.5px solid #e4f3fc",
                overflow: "hidden",
                transition: "box-shadow 0.15s"
              }}
            >
              {/* Pharmacy Info */}
              <div style={{
                flex: 2.3,
                padding: "20px 18px 18px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center"
              }}>
                <div style={{
                  fontWeight: 700,
                  color: "#17879c",
                  fontSize: 20,
                  marginBottom: 4
                }}>
                  {offer.pharmacy?.name}
                </div>
                <div style={{ fontSize: 15, color: "#888", marginBottom: 1 }}>
                  <span style={{ fontWeight: 600 }}>{offer.pharmacy?.area}</span>
                  {offer.pharmacy?.area && offer.pharmacy?.city && ","} {offer.pharmacy?.city}
                </div>
              </div>
             {/* Price/Stock */}
              <div style={{
                flex: 1.5,
                background: "#fff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                borderLeft: "1.5px solid #e4f3fc",
                borderRight: "1.5px solid #e4f3fc"
              }}>
                <div style={{
                  fontSize: 19,
                  color: "#13C0A2",
                  fontWeight: 800,
                  marginBottom: 2
                }}>
                  ₹{offer.price}
                </div>
                <div style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: offer.stock > 0 ? "#1188A3" : "#e76c4b"
                }}>
                  {offer.stock > 0 ? "In stock" : "Out of stock"}
                </div>
              </div>
              {/* Add to Cart */}
              <div style={{
                flex: 1.1,
                background: "#13C0A2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <button
                  onClick={() => addToCart({ ...offer, name: query })}
                  style={{
                    background: "#fff",
                    color: "#13C0A2",
                    border: "none",
                    borderRadius: 10,
                    padding: "9px 18px",
                    fontWeight: 800,
                    fontSize: 15,
                    cursor: "pointer",
                    transition: "background 0.14s"
                  }}
                  disabled={offer.stock === 0}
                >
                  {offer.stock > 0 ? "Add to Cart" : "Out of Stock"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchResults;
