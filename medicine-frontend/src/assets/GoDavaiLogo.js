// A simple, clean logo for GoDavai (teal/yellow combo, scalable)
import React from "react";
export default function GoDavaiLogo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="30" fill="#13C0A2" />
      <path d="M18 32a14 14 0 1028 0 14 14 0 10-28 0" fill="#FFD43B" />
      <text x="50%" y="54%" textAnchor="middle" fill="#1188A3" fontSize={size/2.8} fontWeight="bold" dy=".3em" fontFamily="Montserrat, Arial">G</text>
    </svg>
  );
}
