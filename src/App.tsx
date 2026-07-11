import React from "react";
import "./App.css";
import {
  Box,
  Drawer,
  IconButton,
  AppBar,
  Toolbar,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import MenuIcon from "@mui/icons-material/Menu";
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
import { UserProvider, useUser } from "./contexts/UserContext";
import { ThemeModeProvider, useThemeMode } from "./contexts/ThemeModeContext";
import FormstrLogo from "./assets/formstr-pages-logo.png";
import DocPage from "./components/DocPage";
import { SharedPagesProvider } from "./contexts/SharedDocsContext";
import { RelayProvider, useRelays } from "./contexts/RelayContext";
import { DocMetadataProvider } from "./contexts/DocMetadataContext";
import { BlossomProvider } from "./contexts/BlossomContext";
import { MyFormsProvider } from "./contexts/MyFormsContext";
import { useSyncRetrySweep } from "./hooks/useSyncRetrySweep";

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
      { path: "about", element: <AboutPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

/* ── Authed (per-account) subtree ───────────────────────── */
// Keyed on the active account's pubkey, so switching accounts tears down and
// rebuilds the entire doc/editor layer — DocumentContext, SharedDocs,
// DocMetadata, the TipTap editor, all component state — from a clean slate.
// That is what stops one account's in-memory notes/editor content from bleeding
// into the next (the previous-account-data-after-switch bug). It sits below
// User/Relay/Blossom/MyForms so the signer, relay pool, and forms list survive
// the switch; only this subtree remounts. "anon" keeps a stable key while
// logged out.
function AuthedApp() {
  const { activeAccount } = useUser();
  const { relays } = useRelays();
  // Retries locally-stored events that were never confirmed as broadcast
  // (e.g. a save made while offline). Mounted once here rather than inside
  // the editor since pending entries can belong to documents that aren't
  // currently open.
  useSyncRetrySweep(relays);
  return (
    <DocumentProvider key={activeAccount?.pubkey ?? "anon"}>
      <SharedPagesProvider>
        <DocMetadataProvider>
          <RouterProvider router={router} />
        </DocMetadataProvider>
      </SharedPagesProvider>
    </DocumentProvider>
  );
}

/* ── App root — providers only, no router JSX ───────────── */
export default function App() {
  // ThemeModeProvider sits above everything (including UserProvider) so the
  // auth modals rendered by UserProvider inherit the app theme too.
  return (
    <ThemeModeProvider>
      <UserProvider>
        <RelayProvider>
          <BlossomProvider>
            <MyFormsProvider>
              <AuthedApp />
            </MyFormsProvider>
          </BlossomProvider>
        </RelayProvider>
      </UserProvider>
    </ThemeModeProvider>
  );
}

/* ── Layout shell ───────────────────────────────────────── */
// Lives inside the router so hooks like useLocation / useBlocker work here
// and in any descendant. The theme itself is provided by ThemeModeProvider at
// the app root; here we just read/set the active theme id for the switcher.
function AppLayout() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { themeId, setThemeId } = useThemeMode();
  const isDesktop = useMediaQuery("(min-width:900px)");

  return (
    <>
      {/* ===== TOP BAR ===== */}
      <AppBar
        position="fixed"
        elevation={3}
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: "1px solid",
          borderColor: (t) => alpha(t.palette.text.primary, 0.12),
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
            <UserMenu themeId={themeId} onSelectTheme={setThemeId} />
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
    </>
  );
}
