// src/components/MainLayout.js
import React from "react";
import { Outlet } from "react-router-dom";

const MainLayout = () => (
  <div style={{
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column"
  }}>
    <div style={{ flex: 1, paddingBottom: 80 /* Height of your BottomNavbar */ }}>
      <Outlet />
    </div>
  </div>
);

export default MainLayout;
