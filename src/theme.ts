import { createTheme } from "@mui/material/styles";

// Dark theme
export const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#0A2540" },
    secondary: { main: "#FFB703" },
    background: {
      default: "#0F172A",
      paper: "#1E293B",
    },
    text: {
      primary: "#F9FAFB",
      secondary: "#CBD5E1",
    },
  },
  typography: { fontFamily: `"Inter", sans-serif` },
  shape: { borderRadius: 12 },
});

// Light theme
export const lightTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0A2540" },
    secondary: { main: "#FFB703" },
    background: {
      default: "#F7F7F7",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#0F172A",
      secondary: "#4B5563",
    },
  },
  typography: { fontFamily: `"Inter", sans-serif` },
  shape: { borderRadius: 12 },
});
