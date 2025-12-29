// src/components/DocEditor.tsx

import { useEffect, useState } from "react";
import { Box, Tabs, Tab, Paper, Button } from "@mui/material";
import ReactMarkdown from "react-markdown";
import { publishEvent } from "../nostr/publish";
import { useDocumentContext } from "../contexts/DocumentContext.tsx";
import { DEFAULT_RELAYS } from "../nostr/relayPool.ts";

interface DocEditorProps {
  onTitleChange?: (title: string) => void;
}

export default function DocEditor({ onTitleChange }: DocEditorProps) {
  const { documents, selectedDocumentId } = useDocumentContext();
  const document =
    documents.get(selectedDocumentId || "")?.decryptedContent || "";
  const [tab, setTab] = useState(0);
  const [md, setMd] = useState(document);
  const [docId, setDocId] = useState(selectedDocumentId || "");
  const encryptContent = async (content: string) => {
    return await window.nostr?.nip44?.encrypt(
      await window.nostr?.getPublicKey(),
      content
    );
  };

  // // Local edits
  const onLocalChange = (value: string) => {
    setMd(value);
    const lines = value.split("\n");
    const title = lines.length > 0 ? lines[0] : "";
    if (onTitleChange && !selectedDocumentId) onTitleChange(title);
  };

  // Save snapshot
  const saveSnapshot = async () => {
    if (!window.nostr) return;

    try {
      const encryptedContent = await encryptContent(md);
      if (!encryptedContent) return;

      const event = {
        kind: 33457,
        tags: [["d", docId]],
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: await window.nostr!.getPublicKey!(),
        id: "",
        sig: "",
      };

      const signed = await window.nostr.signEvent(event);
      await publishEvent(signed, DEFAULT_RELAYS);
      alert("Snapshot saved!");
    } catch (err) {
      console.error("Failed to save snapshot:", err);
      alert("Failed to save snapshot");
    }
  };

  return (
    <Box
      sx={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: "#f0f0f0",
        overflowY: "auto",
        p: 2,
      }}
    >
      {/* Toolbar */}
      <Paper
        elevation={1}
        sx={{
          mb: 2,
          p: 1.5,
          background: "white",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderRadius: 2,
          position: "sticky",
          top: 0,
          zIndex: 10,
          width: "100%",
          maxWidth: "900px",
        }}
      >
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label="Editor" />
          <Tab label="Preview" />
        </Tabs>

        <Button variant="contained" onClick={saveSnapshot}>
          Save
        </Button>
      </Paper>

      {/* Paper sheet */}
      <Paper
        elevation={2}
        sx={{
          margin: "0 auto",
          background: "white",
          maxWidth: "800px",
          width: "100%",
          minHeight: "calc(100% - 60px)",
          p: 4,
          borderRadius: 2,
        }}
      >
        {tab === 0 && (
          <Box
            component="textarea"
            value={md}
            onChange={(e) => onLocalChange(e.target.value)}
            placeholder="Start writing..."
            style={{
              width: "100%",
              height: "80vh",
              border: "none",
              outline: "none",
              resize: "none",
              fontSize: "16px",
              lineHeight: 1.6,
              fontFamily: "Georgia, serif",
              background: "transparent",
              color: "#222",
            }}
          />
        )}

        {tab === 1 && (
          <Box sx={{ "& *": { fontFamily: "Georgia, serif", color: "#222" } }}>
            <ReactMarkdown>{md}</ReactMarkdown>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
