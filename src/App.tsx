// src/App.tsx
import DocEditor from "./components/DocEditor";
import { CssBaseline, Typography, Box } from "@mui/material";
import { DEFAULT_RELAYS } from "./nostr/relayPool";

function App() {
  // For testing, use a fixed docId and a randomly generated private key (hex)
  // In production, replace with wallet integration
  const docId = "test-doc-001";

  return (
    <>
      <CssBaseline />
      <Box sx={{ height: "100vh", p: 4, maxWidth: "100%" }}>
        <Typography variant="h4" gutterBottom>
          Nostr Collaborative Markdown Editor
        </Typography>

        <DocEditor docId={docId} relays={DEFAULT_RELAYS} />
      </Box>
    </>
  );
}

export default App;
