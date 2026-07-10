// src/contexts/ThemeModeContext.tsx
//
// Owns the active theme and provides the MUI ThemeProvider at the very top of
// the app — above UserProvider — so that EVERYTHING, including the auth modals
// UserProvider renders (login / unlock / migration), inherits the app theme
// (Inter font, palette, button casing, border radius). Previously the only
// ThemeProvider lived in AppLayout, inside the router and below UserProvider,
// so those modals fell back to MUI's default theme.
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";
import { ThemeProvider, alpha } from "@mui/material/styles";
import { CssBaseline, GlobalStyles } from "@mui/material";
import { themes } from "../theme";
import type { ThemeId } from "../theme";

interface ThemeModeContextType {
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
}

const ThemeModeContext = createContext<ThemeModeContextType | undefined>(
  undefined,
);

const STORAGE_KEY = "formstr:theme";

export const ThemeModeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    // Guard against a stale/removed theme id lingering in localStorage.
    if (stored && themes[stored]) return stored;
    const ids = Object.keys(themes) as ThemeId[];
    return ids[Math.floor(Math.random() * ids.length)];
  });

  const setThemeId = (id: ThemeId) => {
    setThemeIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const theme = themes[themeId].theme;
  const value = useMemo(() => ({ themeId, setThemeId }), [themeId]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GlobalStyles
          styles={(t) => ({
            ":root": {
              "--comment-highlight-color": alpha(t.palette.secondary.main, 0.4),
            },
            ".tiptap a": { color: t.palette.secondary.main },
            // One-shot pulse used when a sidebar comment is clicked, to draw the
            // eye to its highlighted span after scrolling. Theme-token driven so it
            // reads correctly across every theme. Starts as a stronger tint + ring
            // and settles back to the resting highlight colour.
            "@keyframes commentHighlightPulse": {
              "0%": {
                backgroundColor: alpha(t.palette.secondary.main, 0.85),
                boxShadow: `0 0 0 3px ${alpha(t.palette.secondary.main, 0.85)}`,
              },
              "100%": {
                backgroundColor: alpha(t.palette.secondary.main, 0.4),
                boxShadow: `0 0 0 0 ${alpha(t.palette.secondary.main, 0)}`,
              },
            },
            ".comment-highlight-pulse": {
              animation: "commentHighlightPulse 1.4s ease-out",
              borderRadius: "2px",
            },
          })}
        />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeModeProvider");
  return ctx;
};
