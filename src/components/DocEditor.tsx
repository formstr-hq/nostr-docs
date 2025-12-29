// src/components/DocEditor.tsx

import React, { useEffect, useState } from "react";
import { Box, Tabs, Tab, Paper, Button } from "@mui/material";
import ReactMarkdown from "react-markdown";
import * as Y from "yjs";
import { fetchLatestFileEvent } from "../nostr/fetchFile";
import { publishEvent } from "../nostr/publish";

interface DocEditorProps {
  docId: string;
  relays?: string[];
  onTitleChange?: (title: string) => void;
}

export default function DocEditor({
  docId,
  relays = [],
  onTitleChange,
}: DocEditorProps) {
  const [tab, setTab] = useState(0);
  const [md, setMd] = useState("");

  const encryptContent = async (content: string) => {
    return await window.nostr?.nip44?.encrypt(
      await window.nostr?.getPublicKey(),
      content
    );
  };

  const decryptEventContent = async (content: string) => {
    return await window.nostr?.nip44?.decrypt(
      await window.nostr?.getPublicKey(),
      content
    );
  };

  // Load latest snapshot
  useEffect(() => {
    if (!relays || relays.length === 0) return;
    if (!docId) return;
    console.log("GOt md as ", md);
    if (md) return;
    (async () => {
      try {
        const event = await fetchLatestFileEvent(docId, relays);
        console.log("Got latest event as", event);
        if (event) {
          const mdText = await decryptEventContent(event.content);
          if (!mdText) return;
          setMd(mdText);
        }
      } catch (err) {
        console.error("Failed to load snapshot:", err);
      }
    })();
  }, [docId, relays]);

  // // Local edits
  const onLocalChange = (value: string) => {
    setMd(value);
    const lines = value.split("\n");
    const title = lines.length > 0 ? lines[0] : "";
    if (onTitleChange) onTitleChange(title);
  };

  // Save snapshot
  const saveSnapshot = async () => {
    if (!relays || !window.nostr) return;

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
      await publishEvent(signed, relays);
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
