// src/App.tsx
import DocEditor from "./components/DocEditor";
import DocumentList from "./components/DocumentList";
import { CssBaseline, Typography, Box, Tabs, Tab } from "@mui/material";
import { DEFAULT_RELAYS } from "./nostr/relayPool";
import React from "react";

function App() {
  const [docId, setDocId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"editor" | "list">("editor");

  const onTitleChange = (title: string) => {
    const titleWords = title.split(" ");
    const id = titleWords.join("-").substring(0, 15);
    setDocId(id);
  };

  return (
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
          <DocumentList
            onEdit={(id) => {
              console.log("Setting docId as", id);
              setDocId(id);
              setView("editor");
            }}
          />
        ) : (
          <>
            {/* Document Title (auto-generated from first line) */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Document Title (auto-generated from first line):
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  alignItems: "center",
                  background: "white",
                  p: 1.5,
                  borderRadius: 2,
                  border: "1px solid #ccc",
                }}
              >
                <Typography>{docId}</Typography>
              </Box>
            </Box>

            <DocEditor
              docId={docId || ""}
              relays={DEFAULT_RELAYS}
              onTitleChange={docId ? onTitleChange : undefined}
            />
          </>
        )}
      </Box>
    </>
  );
}

export default App;
