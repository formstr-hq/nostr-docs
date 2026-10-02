import { alpha, createTheme, type Theme } from "@mui/material/styles";

const defaultTypography = {
  fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
};

const sharedComponents = {
  MuiCssBaseline: {
    styleOverrides: {
      body: {
        fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      },
    },
  },
  MuiButton: {
    styleOverrides: {
      root: {
        lineHeight: 1,
        textTransform: "none" as const,
        borderRadius: "6px",
      },
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: {
        lineHeight: 1,
        textTransform: "none" as const,
        borderRadius: "6px",
      },
    },
  },
  MuiPaper: {
    styleOverrides: {
      root: {
        borderRadius: "8px",
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: "10px",
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: "5px",
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: "6px",
      },
    },
  },
  MuiMenu: {
    defaultProps: {
      elevation: 4,
    },
    styleOverrides: {
      paper: ({ theme }: { theme: Theme }) => ({
        borderRadius: "10px",
        border: `1px solid ${theme.palette.divider}`,
        backdropFilter: "blur(16px)",
        backgroundColor:
          theme.palette.mode === "dark"
            ? alpha(theme.palette.background.paper, 0.96)
            : theme.palette.background.paper,
        boxShadow:
          theme.palette.mode === "dark"
            ? "0 8px 32px rgba(0, 0, 0, 0.45)"
            : "0 8px 24px rgba(0, 0, 0, 0.12)",
      }),
      list: {
        padding: "4px",
      },
    },
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        fontSize: "0.84rem",
        fontWeight: 500,
        borderRadius: "6px",
        minHeight: "34px",
        paddingTop: "6px",
        paddingBottom: "6px",
        paddingLeft: "10px",
        paddingRight: "10px",
        gap: "6px",
        "&.Mui-selected": {
          fontWeight: 600,
        },
      },
    },
  },
  MuiListItemText: {
    styleOverrides: {
      root: {
        marginTop: 0,
        marginBottom: 0,
      },
      primary: {
        fontSize: "0.84rem",
        fontWeight: 500,
        lineHeight: 1.4,
      },
      secondary: {
        fontSize: "0.72rem",
        lineHeight: 1.3,
      },
    },
  },
  MuiListItemIcon: {
    styleOverrides: {
      root: {
        minWidth: "28px",
        color: "inherit",
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
  | "nord"
  | "corpoDocs";

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
      typography: defaultTypography,
      shape: { borderRadius: 8 },
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
      typography: defaultTypography,
      shape: { borderRadius: 8 },
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
      typography: defaultTypography,
      shape: { borderRadius: 8 },
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
      typography: defaultTypography,
      shape: { borderRadius: 8 },
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
      typography: defaultTypography,
      shape: { borderRadius: 8 },
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
      typography: { fontFamily: `"Roboto Mono", "Fira Code", "Cascadia Code", monospace` },
      shape: { borderRadius: 6 },
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
        text: { primary: "#F8F8F2", secondary: "#A0A8C3" },
      },
      typography: defaultTypography,
      shape: { borderRadius: 8 },
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
      typography: defaultTypography,
      shape: { borderRadius: 8 },
      components: sharedComponents,
    }),
  },

  corpoDocs: {
    label: "Corpo Docs",
    swatch: "#FFFFFF",
    accentSwatch: "#1A73E8",
    theme: createTheme({
      palette: {
        mode: "light",
        primary: { main: "#1A73E8" },
        secondary: { main: "#1A73E8" },
        background: { default: "#F8F9FA", paper: "#FFFFFF" },
        text: { primary: "#202124", secondary: "#5F6368" },
        divider: "#E0E0E0",
      },
      typography: defaultTypography,
      shape: { borderRadius: 8 },
      components: sharedComponents,
    }),
  },
};

// Legacy exports
export const darkTheme = themes.candlelit.theme;
export const lightTheme = themes.warmPaper.theme;
