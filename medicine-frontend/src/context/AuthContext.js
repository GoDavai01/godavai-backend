import React, { createContext, useContext, useState, useEffect } from "react";
import { jwtDecode } from "jwt-decode";
import axios from "axios";

const AuthContext = createContext();

function safeParse(json, fallback = null) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function AuthProvider({ children }) {
  // SSR-safe initial values
  const [token, setToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("token") || "";
  });
  const [user, setUser] = useState(() => {
    if (typeof window === "undefined") return null;
    return safeParse(localStorage.getItem("user"), null);
  });
  const [addresses, setAddresses] = useState([]);

  // Always sync user object to localStorage (with all fields)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (user) localStorage.setItem("user", JSON.stringify(user));
    else localStorage.removeItem("user");
  }, [user]);

  // Set/remove Axios global header on token changes (production pattern)
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["Authorization"] = "Bearer " + token;
      if (typeof window !== "undefined") localStorage.setItem("token", token);
    } else {
      delete axios.defaults.headers.common["Authorization"];
      if (typeof window !== "undefined") localStorage.removeItem("token");
    }
  }, [token]);

  // Sync addresses from backend on login/profile change
  useEffect(() => {
    if (user?._id) {
      axios.get(`/api/users/${user._id}/addresses`)
        .then(res => setAddresses(res.data || []))
        .catch(() => setAddresses([]));
    } else {
      setAddresses([]);
    }
  }, [user]);

  // On login, also fetch profile to get latest (with dob/avatar)
  useEffect(() => {
    if (token) {
      axios.get("/api/profile", {
        headers: { Authorization: "Bearer " + token }
      })
      .then(res => setUser(res.data))
      .catch(() => setUser(null));
    }
  }, [token]);

  // Sync address changes to backend and context
  const updateAddresses = async (nextAddresses) => {
    if (!user?._id) return;
    setAddresses(nextAddresses);
    await axios.put(`/api/users/${user._id}/addresses`, { addresses: nextAddresses });
  };

  const login = (userData, jwt) => {
    setToken(jwt);
    setUser(userData);
    // axios header set automatically via effect
  };

  const logout = () => {
    setUser(null);
    setToken("");
    setAddresses([]);
    // axios header unset automatically via effect
  };

  return (
    <AuthContext.Provider value={{ user, token, setUser, login, logout, addresses, updateAddresses }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
