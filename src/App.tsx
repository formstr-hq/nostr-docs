import React from "react";
import {
  CssBaseline,
  Box,
  Drawer,
  IconButton,
  AppBar,
  Toolbar,
  Typography,
  useMediaQuery,
  Switch,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";

import DocEditor from "./components/DocEditor";
import DocumentList from "./components/DocumentList";
import { DocumentProvider } from "./contexts/DocumentContext";
import { darkTheme, lightTheme } from "./theme";
import { ThemeProvider } from "@mui/material/styles";
import UserMenu from "./components/UserMenu";
import { UserProvider } from "./contexts/UserContext";
import FormstrLogo from "./assets/formstr.svg";

const drawerWidth = 320;

export default function App() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(true);
  const isDesktop = useMediaQuery("(min-width:900px)");

  const theme = darkMode ? darkTheme : lightTheme;

  return (
    <UserProvider>
      <ThemeProvider theme={theme}>
        <DocumentProvider>
          <CssBaseline />

          {/* TOP BAR */}
          <AppBar
            position="fixed"
            elevation={3}
            sx={{
              zIndex: (theme) => theme.zIndex.drawer + 1, // <-- add this
              bgcolor: "background.paper",
              color: "text.primary",
              borderBottom: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <Toolbar sx={{ display: "flex", justifyContent: "space-between" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                {/* Only show hamburger on mobile */}
                {!isDesktop && (
                  <IconButton
                    color="inherit"
                    edge="start"
                    onClick={() => setMobileOpen(true)}
                  >
                    <MenuIcon />
                  </IconButton>
                )}

                {/* Logo + title — ALWAYS visible */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {/* <img
                    src={Logo}
                    alt="Formstr Pages"
                    style={{ height: 32, width: "auto", borderRadius: 8 }}
                  /> */}
                  <img
                    src={FormstrLogo}
                    alt="Formstr Pages"
                    style={{ height: 32, width: "auto", borderRadius: 8 }}
                  />
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 900,
                      letterSpacing: 1,
                      background:
                        "linear-gradient(90deg, #c7aa1aff 0%, #FFA751 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    pages
                  </Typography>
                </Box>
              </Box>
              {/* Light/Dark Toggle */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Switch
                  checked={darkMode}
                  onChange={() => setDarkMode((prev) => !prev)}
                  color="secondary"
                />
                <UserMenu />
              </Box>
            </Toolbar>
          </AppBar>

          {/* SIDEBAR + MAIN */}
          <Box sx={{ display: "flex" }}>
            {/* MOBILE DRAWER */}
            {!isDesktop && (
              <Drawer
                open={mobileOpen}
                onClose={() => setMobileOpen(false)}
                // ModalProps={{ keepMounted: true }}
                sx={{
                  "& .MuiDrawer-paper": {
                    width: drawerWidth,
                    bgcolor: "background.paper",
                  },
                }}
              >
                <DocumentList onEdit={() => setMobileOpen(false)} />
              </Drawer>
            )}

            {/* DESKTOP PERMANENT */}
            {isDesktop && (
              <Drawer
                variant="permanent"
                open
                sx={{
                  width: drawerWidth,
                  "& .MuiDrawer-paper": {
                    width: drawerWidth,
                    boxSizing: "border-box",
                    bgcolor: "background.paper",
                  },
                }}
              >
                <Box sx={{ mt: 8 }}>
                  <DocumentList onEdit={() => {}} />
                </Box>
              </Drawer>
            )}

            {/* MAIN CONTENT */}
            <Box
              component="main"
              sx={{
                flexGrow: 1,
                p: 4,
                mt: 8,
                minHeight: "100vh",
              }}
            >
              <DocEditor />
            </Box>
          </Box>
        </DocumentProvider>
      </ThemeProvider>
    </UserProvider>
  );
}
