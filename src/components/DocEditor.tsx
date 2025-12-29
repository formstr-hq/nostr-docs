import { useEffect, useState } from "react";
import {
  Box,
  Paper,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import ReactMarkdown from "react-markdown";
import { publishEvent } from "../nostr/publish";
import { useDocumentContext } from "../contexts/DocumentContext";
import { DEFAULT_RELAYS } from "../nostr/relayPool";
import { signerManager } from "../signer";

export default function DocEditor() {
  const { documents, selectedDocumentId } = useDocumentContext();
  const doc = documents.get(selectedDocumentId || "");
  const initial = doc?.decryptedContent || "";

  const [md, setMd] = useState(initial);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  const theme = useTheme(); // <-- MUI theme hook

  useEffect(() => {
    setMd(initial);
  }, [selectedDocumentId]);

  const encryptContent = async (content: string) => {
    const signer = await signerManager.getSigner();
    if (!signer) return;
    return signer.nip44Encrypt!(await signer.getPublicKey(), content);
  };

  const saveSnapshot = async () => {
    const signer = await signerManager.getSigner();
    if (!signer) return;
    let dTag = selectedDocumentId;
    if (!dTag) {
      dTag = md.split("\n")[0].split(" ").join("-").substring(0, 15);
    }

    try {
      const encryptedContent = await encryptContent(md);
      if (!encryptedContent) return;

      const event = {
        kind: 33457,
        tags: [["d", dTag]],
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: await signer.getPublicKey!(),
      };

      const signed = await signer.signEvent(event);
      await publishEvent(signed, DEFAULT_RELAYS);
      alert("Saved!");
    } catch (err) {
      console.error("Failed to save snapshot:", err);
      alert("Failed to save");
    }
  };

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {/* Toolbar */}
      <Paper
        elevation={2}
        sx={{
          p: 1.5,
          px: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          bgcolor: "background.paper",
          borderRadius: 2,
          border: "1px solid rgba(0,0,0,0.08)",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <Typography sx={{ fontWeight: 700 }}>
          {doc ? "Editing Document" : "New Document"}
        </Typography>

        <Box sx={{ display: "flex", gap: 2 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_, v) => v && setMode(v)}
            sx={{
              "& .MuiToggleButton-root": {
                color: theme.palette.text.secondary,
                borderColor:
                  theme.palette.mode === "dark"
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(0,0,0,0.1)",
              },
              "& .Mui-selected": {
                color: theme.palette.secondary.main,
                borderColor: theme.palette.secondary.main,
                background:
                  theme.palette.mode === "dark"
                    ? "rgba(255,183,3,0.08)"
                    : "rgba(255,183,3,0.2)",
              },
            }}
          >
            <ToggleButton value="edit">Editor</ToggleButton>
            <ToggleButton value="preview">Preview</ToggleButton>
          </ToggleButtonGroup>

          <Button
            variant="contained"
            color="secondary"
            onClick={saveSnapshot}
            sx={{ fontWeight: 700 }}
          >
            Save
          </Button>
        </Box>
      </Paper>

      {/* Editor Surface */}
      <Paper
        elevation={1}
        sx={{
          flex: 1, // fill remaining vertical space
          display: "flex",
          flexDirection: "column", // textarea grows correctly
          minHeight: 0, // crucial for Chrome flexbox
          p: 3,
          borderRadius: 3,
          bgcolor: "background.paper",
          border: "1px solid rgba(0,0,0,0.08)",
          overflowY: "auto",
        }}
      >
        {mode === "edit" && (
          <Box
            component="textarea"
            value={md}
            onChange={(e) => setMd(e.target.value)}
            style={{
              flex: 1, // use flex instead of height: 100%
              width: "100%",
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              color: theme.palette.text.primary,
              fontSize: "17px",
              lineHeight: 1.7,
              fontFamily:
                '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}
          />
        )}

        {mode === "preview" && (
          <Box
            sx={{
              "& h1,h2,h3,h4": {
                color: theme.palette.text.primary,
                fontWeight: 800,
              },
              "& p": { color: theme.palette.text.secondary },
            }}
          >
            {md.trim() ? (
              <ReactMarkdown>{md}</ReactMarkdown>
            ) : (
              <Typography color="text.secondary">
                Nothing to preview yet…
              </Typography>
            )}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
