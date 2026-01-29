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
import { ThemeProvider } from "@mui/material/styles";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

import DocumentList from "./components/DocumentList";
import UserMenu from "./components/UserMenu";
import { DocumentProvider } from "./contexts/DocumentContext";
import { UserProvider } from "./contexts/UserContext";
import { darkTheme, lightTheme } from "./theme";
import FormstrLogo from "./assets/formstr.svg";
import DocPage from "./components/DocPage";
import { SharedPagesProvider } from "./contexts/SharedDocsContext";

const drawerWidth = 320;

export default function App() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(true);
  const isDesktop = useMediaQuery("(min-width:900px)");

  const theme = darkMode ? darkTheme : lightTheme;

  return (
    <ThemeProvider theme={theme}>
      <UserProvider>
        <DocumentProvider>
          <SharedPagesProvider>
            <CssBaseline />
            <BrowserRouter>
              {/* ===== TOP BAR ===== */}
              <AppBar
                position="fixed"
                elevation={3}
                sx={{
                  zIndex: (theme) => theme.zIndex.drawer + 1,
                  bgcolor: "background.paper",
                  color: "text.primary",
                  borderBottom: "1px solid rgba(0,0,0,0.08)",
                }}
              >
                <Toolbar
                  sx={{ display: "flex", justifyContent: "space-between" }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    {!isDesktop && (
                      <IconButton
                        color="inherit"
                        edge="start"
                        onClick={() => setMobileOpen((prev) => !prev)}
                      >
                        <MenuIcon />
                      </IconButton>
                    )}

                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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

              {/* ===== SIDEBAR + MAIN CONTENT ===== */}
              <Box sx={{ display: "flex" }}>
                {/* MOBILE DRAWER */}
                {!isDesktop && (
                  <Drawer
                    open={mobileOpen}
                    onClose={() => setMobileOpen(false)}
                    sx={{
                      "& .MuiDrawer-paper": {
                        width: drawerWidth,
                        bgcolor: "background.paper",
                      },
                    }}
                  >
                    <Box sx={{ mt: 8 }}>
                      {" "}
                      {/* <-- add this */}
                      <DocumentList onEdit={() => setMobileOpen(false)} />
                    </Box>
                  </Drawer>
                )}

                {/* DESKTOP DRAWER */}
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
                  sx={{ flexGrow: 1, p: 4, mt: 8, minHeight: "100vh" }}
                >
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/doc/:naddr" element={<DocPageWrapper />} />
                    <Route path="/about" element={<AboutPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Box>
              </Box>
            </BrowserRouter>
          </SharedPagesProvider>
        </DocumentProvider>
      </UserProvider>
    </ThemeProvider>
  );
}

function DocPageWrapper() {
  const location = useLocation();
  return <DocPage key={location.pathname + location.hash} />;
}

export function HomePage() {
  return <DocPage />;
}

export function AboutPage() {
  return <Typography variant="h3">About Page</Typography>;
}

export function NotFoundPage() {
  return <Typography variant="h3">404 - Page Not Found</Typography>;
}
