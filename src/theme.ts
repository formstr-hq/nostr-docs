import { createTheme } from "@mui/material/styles";

const sharedComponents = {
  MuiButton: {
    styleOverrides: {
      root: {
        lineHeight: 1,
        textTransform: "none" as const,
      },
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: {
        lineHeight: 1,
        textTransform: "none" as const,
      },
    },
  },
};

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
  components: sharedComponents,
});

// Light theme
export const lightTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0A2540" },
    // Darker amber for light mode — same brand feel, readable on white
    secondary: { main: "#B45309", light: "#D97706", dark: "#92400E" },
    background: {
      default: "#F3F4F6",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#0F172A",
      secondary: "#4B5563",
    },
  },
  typography: { fontFamily: `"Inter", sans-serif` },
  shape: { borderRadius: 12 },
  components: sharedComponents,
});
