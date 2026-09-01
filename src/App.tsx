import React from "react";
import "./App.css";
import {
  Box,
  Drawer,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  createBrowserRouter,
  createHashRouter,
  RouterProvider,
  Outlet,
  useLocation,
} from "react-router-dom";

import DocumentList from "./components/DocumentList";
import { DocumentProvider } from "./contexts/DocumentContext";
import { UserProvider, useUser } from "./contexts/UserContext";
import { ThemeModeProvider } from "./contexts/ThemeModeContext";
import DocPage from "./components/DocPage";
import ArticleView from "./components/ArticleView";
import { SharedPagesProvider } from "./contexts/SharedDocsContext";
import { RelayProvider } from "./contexts/RelayContext";
import { DocMetadataProvider } from "./contexts/DocMetadataContext";
import { PublishedProvider } from "./contexts/PublishedContext";
import { BlossomProvider } from "./contexts/BlossomContext";
import { MyFormsProvider } from "./contexts/MyFormsContext";
import { useTextSuggest } from "./hooks/useTextSuggest";

import AllPagesView from "./components/AllPagesView";

const drawerWidth = 264;

/* ── Route components ───────────────────────────────────── */

function DocPageWrapper() {
  const location = useLocation();
  return <DocPage key={location.pathname + location.hash} />;
}

function ArticleViewWrapper() {
  const location = useLocation();
  return <ArticleView key={location.pathname} />;
}

export function HomePage() {
  return <AllPagesView />;
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
      { path: "new", element: <DocPageWrapper /> },
      { path: "doc/new", element: <DocPageWrapper /> },
      { path: "doc/:naddr", element: <DocPageWrapper /> },
      { path: "article/:naddr", element: <ArticleViewWrapper /> },
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
  return (
    <DocumentProvider key={activeAccount?.pubkey ?? "anon"}>
      <SharedPagesProvider>
        <DocMetadataProvider>
          <PublishedProvider>
            <RouterProvider router={router} />
          </PublishedProvider>
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
  const isDesktop = useMediaQuery("(min-width:900px)");
  const textSuggest = useTextSuggest();

  const outletContext = React.useMemo(
    () => ({
      textSuggest,
      onOpenSidebar: () => setMobileOpen(true),
    }),
    [textSuggest],
  );

  return (
    <>
      {/* ===== SIDEBAR + MAIN CONTENT ===== */}
      <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>
        {/* MOBILE DRAWER */}
        {!isDesktop && (
          <Drawer
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            keepMounted
            sx={{
              zIndex: 1600,
              "& .MuiDrawer-paper": {
                width: drawerWidth,
                bgcolor: "background.paper",
                borderRadius: 0,
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid",
                borderColor: "divider",
                backgroundImage: "none",
                zIndex: 1600,
              },
            }}
          >
            <Box
              sx={{
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
                borderRadius: 0,
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid",
                borderColor: "divider",
                backgroundImage: "none",
              },
            }}
          >
            <Box
              sx={{
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
            p: 0,
            height: "100%",
            overflow: "hidden",
            boxSizing: "border-box",
            bgcolor: "background.default",
          }}
        >
          <Outlet context={outletContext} />
        </Box>
      </Box>
    </>
  );
}
