// src/components/DocEditor.tsx

import React, { useEffect, useState } from "react";
import {
  Box,
  Tabs,
  Tab,
  Paper,
  TextField,
  Typography,
  Button,
} from "@mui/material";
import ReactMarkdown from "react-markdown";
import * as Y from "yjs";
import { fetchLatestFileEvent } from "../nostr/fetchFile";
import { base64ToUint8 } from "../utils/base64";
import { KIND_CRDT_OP, subscribeCRDTOps } from "../nostr/crdt";
import { publishEvent } from "../nostr/publish";

interface DocEditorProps {
  docId: string;
  relays?: string[];
}

export default function DocEditor({ docId, relays = [] }: DocEditorProps) {
  const [md, setMd] = useState("");
  const [tab, setTab] = useState(0); // 0 = Editor, 1 = Preview

  // --- Yjs document and text ---
  const ydocRef = React.useRef<Y.Doc | null>(null);
  const ytextRef = React.useRef<Y.Text | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    ydocRef.current = ydoc;
    ytextRef.current = ytext;

    setMd(ytext.toString());

    ytext.observe(() => {
      setMd(ytext.toString());
    });

    return () => {
      ytext.unobserve(() => {});
      ydoc.destroy();
    };
  }, []);

  // --- Load latest snapshot ---
  useEffect(() => {
    console.log("Fetch file use effectr,", relays);
    if (!relays || relays.length === 0) return;
    const ytext = ytextRef.current;
    if (!ytext) return;

    (async () => {
      try {
        console.log("Calling fetchLatest file event");
        const event = await fetchLatestFileEvent(docId, relays);
        if (event) {
          const uint8 = base64ToUint8(event.content);
          Y.applyUpdate(ydocRef.current!, uint8);
        }
      } catch (err) {
        console.error("Failed to load snapshot:", err);
      }
    })();
  }, [docId, relays]);

  // --- Subscribe to ephemeral CRDT ops ---
  useEffect(() => {
    if (!relays || !ydocRef.current) return;
    subscribeCRDTOps(docId, relays, ydocRef.current);
  }, [docId, relays]);

  // --- Emit local updates as ephemeral CRDT ops ---
  useEffect(() => {
    const ydoc = ydocRef.current;
    if (!ydoc || !relays || !window.nostr) return;

    const onUpdate = (update: Uint8Array) => {
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

          const signed = await window.nostr!.signEvent!(event);
          await publishEvent(signed, relays);
        } catch (err) {
          console.error("Failed to publish CRDT op:", err);
        }
      })();
    };

    ydoc.on("update", onUpdate);
    return () => ydoc.off("update", onUpdate);
  }, [docId, relays]);

  // --- Handle local text changes ---
  const onLocalChange = (value: string) => {
    const ytext = ytextRef.current;
    if (!ytext) return;
    ytext.doc?.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, value);
    });
  };

  // --- Publish full snapshot ---
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
      const signed = await window.nostr!.signEvent!(event);
      await publishEvent(signed, relays);
      alert("Snapshot saved!");
    } catch (err) {
      console.error("Failed to save snapshot:", err);
      alert("Failed to save snapshot");
    }
  };

  return (
    <Paper
      sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Tabs value={tab} onChange={(_, newVal) => setTab(newVal)}>
        <Tab label="Editor" />
        <Tab label="Preview" />
      </Tabs>

      <Box sx={{ mt: 2, flex: 1, overflowY: "auto" }}>
        {tab === 0 && (
          <TextField
            multiline
            minRows={20}
            maxRows={40}
            fullWidth
            value={md}
            onChange={(e) => onLocalChange(e.target.value)}
            variant="outlined"
            placeholder="Start writing your markdown..."
            sx={{ height: "100%" }}
          />
        )}
        {tab === 1 && (
          <Box sx={{ overflowY: "auto", height: "100%", p: 1 }}>
            <ReactMarkdown>{md}</ReactMarkdown>
          </Box>
        )}
      </Box>

      <Box sx={{ mt: 2, textAlign: "right" }}>
        <Button variant="contained" onClick={saveSnapshot}>
          Save Snapshot
        </Button>
      </Box>
    </Paper>
  );
}
