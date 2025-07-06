// src/context/ThemeContext.js
import React, { createContext, useContext, useMemo, useState, useEffect } from "react";
import { createTheme, ThemeProvider as MUIThemeProvider } from "@mui/material/styles";

const ThemeContext = createContext();

function getSystemMode() {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light"; // default fallback for SSR
}

const getDesignTokens = (mode) => {
  let actualMode = mode;
  if (mode === "System") {
    actualMode = getSystemMode();
  } else {
    actualMode = mode.toLowerCase();
  }
  return {
    palette: {
      mode: actualMode,
      ...(actualMode === "dark"
        ? {
            background: { default: "#121212", paper: "#181818" },
            text: { primary: "#fff", secondary: "#bbb" },
          }
        : {
            background: { default: "#f7f7f7", paper: "#fff" },
            text: { primary: "#232323", secondary: "#888" },
          }
      ),
      primary: { main: "#13C0A2" },
      secondary: { main: "#FFD43B" },
    }
  };
};

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem("themeMode") || "Light");
  const [systemMode, setSystemMode] = useState(getSystemMode());

  // Update systemMode on system color scheme change
  useEffect(() => {
    if (mode === "System" && typeof window !== "undefined" && window.matchMedia) {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => setSystemMode(mql.matches ? "dark" : "light");
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    }
  }, [mode]);

  useEffect(() => {
    localStorage.setItem("themeMode", mode);
  }, [mode]);

  const theme = useMemo(() => {
    if (mode === "System") {
      return createTheme(getDesignTokens(systemMode));
    }
    return createTheme(getDesignTokens(mode));
  }, [mode, systemMode]);

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      <MUIThemeProvider theme={theme}>
        {children}
      </MUIThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeContext);
}
