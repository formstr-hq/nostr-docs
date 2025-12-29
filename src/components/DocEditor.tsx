// src/components/DocEditor.tsx

import React, { useEffect, useState } from "react";
import { Box, Tabs, Tab, Paper, Button } from "@mui/material";
import ReactMarkdown from "react-markdown";
import * as Y from "yjs";
import { fetchLatestFileEvent } from "../nostr/fetchFile";
import { base64ToUint8 } from "../utils/base64";
import { KIND_CRDT_OP, subscribeCRDTOps } from "../nostr/crdt";
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

  const ydocRef = React.useRef<Y.Doc | null>(null);
  const ytextRef = React.useRef<Y.Text | null>(null);
  const [md, setMd] = useState(""); // for preview only

  // Initialize Yjs
  useEffect(() => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    ydocRef.current = ydoc;
    ytextRef.current = ytext;

    // Observe for preview rendering
    const observer = () => setMd(ytext.toString());
    ytext.observe(observer);

    return () => {
      ytext.unobserve(observer);
      ydoc.destroy();
    };
  }, []);

  // Load latest snapshot
  useEffect(() => {
    if (!relays || relays.length === 0) return;
    const ydoc = ydocRef.current;
    if (!ydoc) return;

    (async () => {
      try {
        const event = await fetchLatestFileEvent(docId, relays);
        if (event) {
          const uint8 = base64ToUint8(event.content);
          // Mark as remote to avoid rebroadcast
          Y.applyUpdate(ydoc, uint8, "remote");
        }
      } catch (err) {
        console.error("Failed to load snapshot:", err);
      }
    })();
  }, [docId, relays]);

  // Subscribe to CRDT ops
  useEffect(() => {
    if (!relays || !ydocRef.current) return;
    subscribeCRDTOps(docId, relays, ydocRef.current);
  }, [docId, relays]);

  // Emit CRDT ops
  useEffect(() => {
    const ydoc = ydocRef.current;
    if (!ydoc || !relays || !window.nostr) return;

    const onUpdate = (update: Uint8Array, origin: any) => {
      if (origin === "remote") return; // prevent loops
      (async () => {
        try {
          const event = {
            kind: KIND_CRDT_OP,
            tags: [["d", docId]],
            content: btoa(String.fromCharCode(...update)),
            created_at: Math.floor(Date.now() / 1000),
            pubkey: await window.nostr!.getPublicKey!(),
            id: "",
            sig: "",
          };

          const signed = await window.nostr!.signEvent(event);
          await publishEvent(signed, relays);
        } catch (err) {
          console.error("Failed to publish CRDT op:", err);
        }
      })();
    };

    ydoc.on("update", onUpdate);
    return () => ydoc.off("update", onUpdate);
  }, [docId, relays]);

  // Local edits
  const onLocalChange = (value: string) => {
    const ytext = ytextRef.current;
    if (!ytext) return;

    // Incremental changes instead of replacing entire document
    const oldValue = ytext.toString();
    const commonPrefixLength = (() => {
      let i = 0;
      while (
        i < oldValue.length &&
        i < value.length &&
        oldValue[i] === value[i]
      )
        i++;
      return i;
    })();
    const commonSuffixLength = (() => {
      let i = 0;
      while (
        i + commonPrefixLength < oldValue.length &&
        i + commonPrefixLength < value.length &&
        oldValue[oldValue.length - 1 - i] === value[value.length - 1 - i]
      )
        i++;
      return i;
    })();

    const deleteStart = commonPrefixLength;
    const deleteLength =
      oldValue.length - commonPrefixLength - commonSuffixLength;
    const insertText = value.slice(
      commonPrefixLength,
      value.length - commonSuffixLength
    );

    ytext.doc?.transact(() => {
      if (deleteLength > 0) ytext.delete(deleteStart, deleteLength);
      if (insertText.length > 0) ytext.insert(deleteStart, insertText);
    });

    // Extract and send title to parent
    const lines = value.split("\n");
    const title = lines.length > 0 ? lines[0] : "";
    if (onTitleChange) onTitleChange(title);
  };

  // Save snapshot
  const saveSnapshot = async () => {
    const ydoc = ydocRef.current;
    if (!ydoc || !relays || !window.nostr) return;

    try {
      const update = Y.encodeStateAsUpdate(ydoc);
      const event = {
        kind: 33457,
        tags: [["d", docId]],
        content: btoa(String.fromCharCode(...update)),
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
            value={ytextRef.current?.toString() || ""}
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
