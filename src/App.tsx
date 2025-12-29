// src/App.tsx
import DocEditor from "./components/DocEditor";
import DocumentList from "./components/DocumentList";
import { CssBaseline, Typography, Box, Tabs, Tab } from "@mui/material";
import { DEFAULT_RELAYS } from "./nostr/relayPool";
import React from "react";
import { DocumentProvider } from "./contexts/DocumentContext.tsx";

function App() {
  const [view, setView] = React.useState<"editor" | "list">("editor");

  return (
    <DocumentProvider>
      <>
        <CssBaseline />
        <Box sx={{ height: "100vh", p: 4, maxWidth: "100%" }}>
          {/* Navigation Tabs */}
          <Box sx={{ mb: 3 }}>
            <Tabs value={view} onChange={(_, v) => setView(v)}>
              <Tab label="Documents" value="list" />
              <Tab label="Editor" value="editor" />
            </Tabs>
          </Box>

          {/* Conditional Rendering */}
          {view === "list" ? (
            <DocumentList onEdit={(id) => setView("editor")} />
          ) : (
            <DocEditor />
          )}
        </Box>
      </>
    </DocumentProvider>
  );
}

export default App;
