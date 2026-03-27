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

export type ThemeId =
  | "warmPaper"
  | "candlelit"
  | "sepia"
  | "forest"
  | "ocean"
  | "cypherpunk"
  | "dracula"
  | "nord";

export interface ThemeDefinition {
  label: string;
  swatch: string;       // background half of the preview chip
  accentSwatch: string; // accent half of the preview chip
  theme: ReturnType<typeof createTheme>;
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  warmPaper: {
    label: "Warm Paper",
    swatch: "#F5F2EE",
    accentSwatch: "#C4A882",
    theme: createTheme({
      palette: {
        mode: "light",
        primary: { main: "#4A4038" },
        secondary: { main: "#C4A882" },
        background: { default: "#F5F2EE", paper: "#FDFCFA" },
        text: { primary: "#2C2520", secondary: "#7A7068" },
      },
      typography: { fontFamily: `"Inter", sans-serif` },
      shape: { borderRadius: 12 },
      components: sharedComponents,
    }),
  },

  candlelit: {
    label: "Candlelit",
    swatch: "#242019",
    accentSwatch: "#C4A882",
    theme: createTheme({
      palette: {
        mode: "dark",
        primary: { main: "#E8E0D5" },
        secondary: { main: "#C4A882" },
        background: { default: "#1A1714", paper: "#242019" },
        text: { primary: "#F0EDE8", secondary: "#A89C90" },
      },
      typography: { fontFamily: `"Inter", sans-serif` },
      shape: { borderRadius: 12 },
      components: sharedComponents,
    }),
  },

  sepia: {
    label: "Sepia",
    swatch: "#F0E6CC",
    accentSwatch: "#C4813A",
    theme: createTheme({
      palette: {
        mode: "light",
        primary: { main: "#6B3D1E" },
        secondary: { main: "#C4813A" },
        background: { default: "#F0E6CC", paper: "#F8F0DC" },
        text: { primary: "#3A2010", secondary: "#8B5A30" },
      },
      typography: { fontFamily: `"Inter", sans-serif` },
      shape: { borderRadius: 12 },
      components: sharedComponents,
    }),
  },

  forest: {
    label: "Forest",
    swatch: "#162018",
    accentSwatch: "#6A9E60",
    theme: createTheme({
      palette: {
        mode: "dark",
        primary: { main: "#A8C59E" },
        secondary: { main: "#6A9E60" },
        background: { default: "#0E1612", paper: "#162018" },
        text: { primary: "#D8EDD4", secondary: "#8FBB87" },
      },
      typography: { fontFamily: `"Inter", sans-serif` },
      shape: { borderRadius: 12 },
      components: sharedComponents,
    }),
  },

  ocean: {
    label: "Ocean",
    swatch: "#102035",
    accentSwatch: "#4A90B8",
    theme: createTheme({
      palette: {
        mode: "dark",
        primary: { main: "#89C4DA" },
        secondary: { main: "#4A90B8" },
        background: { default: "#0B1623", paper: "#102035" },
        text: { primary: "#D0E8F5", secondary: "#7EB8D4" },
      },
      typography: { fontFamily: `"Inter", sans-serif` },
      shape: { borderRadius: 12 },
      components: sharedComponents,
    }),
  },

  cypherpunk: {
    label: "Cypherpunk",
    swatch: "#050D05",
    accentSwatch: "#00FF41",
    theme: createTheme({
      palette: {
        mode: "dark",
        primary: { main: "#00FF41" },
        secondary: { main: "#00CC33" },
        background: { default: "#050D05", paper: "#0A160A" },
        text: { primary: "#00FF41", secondary: "#00AA22" },
      },
      typography: { fontFamily: `"Fira Code", "Cascadia Code", monospace` },
      shape: { borderRadius: 4 },
      components: sharedComponents,
    }),
  },

  dracula: {
    label: "Dracula",
    swatch: "#282A36",
    accentSwatch: "#BD93F9",
    theme: createTheme({
      palette: {
        mode: "dark",
        primary: { main: "#BD93F9" },
        secondary: { main: "#FF79C6" },
        background: { default: "#1E1F29", paper: "#282A36" },
        text: { primary: "#F8F8F2", secondary: "#6272A4" },
      },
      typography: { fontFamily: `"Inter", sans-serif` },
      shape: { borderRadius: 12 },
      components: sharedComponents,
    }),
  },

  nord: {
    label: "Nord",
    swatch: "#2E3440",
    accentSwatch: "#88C0D0",
    theme: createTheme({
      palette: {
        mode: "dark",
        primary: { main: "#88C0D0" },
        secondary: { main: "#5E81AC" },
        background: { default: "#242933", paper: "#2E3440" },
        text: { primary: "#ECEFF4", secondary: "#D8DEE9" },
      },
      typography: { fontFamily: `"Inter", sans-serif` },
      shape: { borderRadius: 8 },
      components: sharedComponents,
    }),
  },
};

// Legacy exports
export const darkTheme = themes.candlelit.theme;
export const lightTheme = themes.warmPaper.theme;
