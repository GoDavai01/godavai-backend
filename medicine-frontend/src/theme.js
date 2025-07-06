import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: {
      main: "#13C0A2", // teal/green
    },
    secondary: {
      main: "#FFD43B", // sunshine yellow
    },
    background: {
      default: "#F8F8FA",
      paper: "#FFF",
    },
    info: {
      main: "#1188A3", // blue
    },
  },
  typography: {
    fontFamily: "Montserrat, Arial, sans-serif",
    h1: { fontWeight: 900 },
    h2: { fontWeight: 800 },
    h3: { fontWeight: 800 },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { fontWeight: 700 },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 700,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 20,
        },
      },
    },
  },
});

export default theme;
