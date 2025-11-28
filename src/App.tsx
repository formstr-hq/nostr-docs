// src/App.tsx
import React from "react";
import DocEditor from "./components/DocEditor";
import { CssBaseline, Container, Typography } from "@mui/material";
import { DEFAULT_RELAYS } from "./nostr/relayPool";

function App() {
  // For testing, use a fixed docId and a randomly generated private key (hex)
  // In production, replace with wallet integration
  const docId = "test-doc-001";

  return (
    <>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ height: "100vh", py: 4 }}>
        <Typography variant="h4" gutterBottom>
          Nostr Collaborative Markdown Editor
        </Typography>
        <DocEditor docId={docId} relays={DEFAULT_RELAYS} />
      </Container>
    </>
  );
}

export default App;
