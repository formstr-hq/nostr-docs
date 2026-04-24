import React from "react";
import "./App.css";
import {
  CssBaseline,
  GlobalStyles,
  Box,
  Drawer,
  IconButton,
  AppBar,
  Toolbar,
  Typography,
  useMediaQuery,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { ThemeProvider } from "@mui/material/styles";
import {
  createBrowserRouter,
  createHashRouter,
  RouterProvider,
  Outlet,
  useLocation,
} from "react-router-dom";

import DocumentList from "./components/DocumentList";
import UserMenu from "./components/UserMenu";
import { DocumentProvider } from "./contexts/DocumentContext";
import { UserProvider } from "./contexts/UserContext";
import { themes } from "./theme";
import type { ThemeId } from "./theme";
import FormstrLogo from "./assets/formstr-pages-logo.png";
import DocPage from "./components/DocPage";
import DriveImportPage from "./components/DriveImportPage";
import { SharedPagesProvider } from "./contexts/SharedDocsContext";
import { RelayProvider } from "./contexts/RelayContext";
import { DocMetadataProvider } from "./contexts/DocMetadataContext";
import { BlossomProvider } from "./contexts/BlossomContext";

const drawerWidth = 320;

/* ── Route components ───────────────────────────────────── */

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

/* ── Router ─────────────────────────────────────────────── */
// createBrowserRouter (a "data router") is required for useBlocker to work.
// AppLayout wraps all routes via <Outlet /> so the shell renders once.
// In Tauri (desktop), use createHashRouter since file:// doesn't support history API.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isCapacitor = typeof window !== "undefined" && "Capacitor" in window;
const createRouter = (isTauri || isCapacitor) ? createHashRouter : createBrowserRouter;
const router = createRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "doc/:naddr", element: <DocPageWrapper /> },
      { path: "drive-import", element: <DriveImportPage /> },
      { path: "about", element: <AboutPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

/* ── App root — providers only, no router JSX ───────────── */
export default function App() {
  return (
    <UserProvider>
      <RelayProvider>
        <BlossomProvider>
          <DocumentProvider>
            <SharedPagesProvider>
              <DocMetadataProvider>
                <RouterProvider router={router} />
              </DocMetadataProvider>
            </SharedPagesProvider>
          </DocumentProvider>
        </BlossomProvider>
      </RelayProvider>
    </UserProvider>
  );
}

/* ── Layout shell ───────────────────────────────────────── */
// Lives inside the router so hooks like useLocation / useBlocker work here
// and in any descendant. ThemeProvider + CssBaseline also live here because
// darkMode state needs to be co-located with the toggle handler.
function AppLayout() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [themeId, setThemeId] = React.useState<ThemeId>(() => {
    const stored = localStorage.getItem("formstr:theme") as ThemeId | null;
    if (stored) return stored;
    const ids = Object.keys(themes) as ThemeId[];
    return ids[Math.floor(Math.random() * ids.length)];
  });
  const isDesktop = useMediaQuery("(min-width:900px)");

  const theme = themes[themeId].theme;

  const handleSelectTheme = (id: ThemeId) => {
    setThemeId(id);
    localStorage.setItem("formstr:theme", id);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={(t) => ({
        ".tiptap a": { color: t.palette.secondary.main },
      })} />

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
        <Toolbar sx={{ display: "flex", justifyContent: "space-between" }}>
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

            <img
              src={FormstrLogo}
              alt="Formstr Pages"
              style={{ height: 36, width: "auto", borderRadius: 10 }}
            />
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <UserMenu
              themeId={themeId}
              onSelectTheme={handleSelectTheme}
            />
          </Box>
        </Toolbar>
      </AppBar>

      {/* ===== SIDEBAR + MAIN CONTENT ===== */}
      <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>
        {/* MOBILE DRAWER */}
        {!isDesktop && (
          <Drawer
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            keepMounted
            sx={{
              "& .MuiDrawer-paper": {
                width: drawerWidth,
                bgcolor: "background.paper",
                display: "flex",
                flexDirection: "column",
              },
            }}
          >
            <Box
              sx={{
                mt: "64px",
                flex: 1,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
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
              flexShrink: 0,
              "& .MuiDrawer-paper": {
                width: drawerWidth,
                boxSizing: "border-box",
                bgcolor: "background.paper",
                display: "flex",
                flexDirection: "column",
              },
            }}
          >
            <Box
              sx={{
                mt: "64px",
                flex: 1,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <DocumentList onEdit={() => {}} />
            </Box>
          </Drawer>
        )}

        {/* MAIN CONTENT */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            mt: "64px",
            height: "calc(100% - 64px)",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </ThemeProvider>
  );
}
