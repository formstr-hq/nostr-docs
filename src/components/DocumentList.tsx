// src/components/DocumentList.tsx
import React, { useEffect, useState } from "react";
import { fetchAllDocuments } from "../nostr/fetchFile.ts";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Button,
  ListItemButton,
} from "@mui/material";
import { DEFAULT_RELAYS } from "../nostr/relayPool";
import type { Event } from "nostr-tools";

export default function DocumentList({
  onEdit,
}: {
  onEdit: (docId: string) => void;
}) {
  const [documents, setDocuments] = useState<Event[]>([]);
  const [documentMap, setDocumentMap] = useState<Map<
    string,
    { event: Event; content: string }
  > | null>(null);
  const [loading, setLoading] = useState(true);

  const getDecryptedContent = async (event: Event): Promise<string> => {
    try {
      return (
        (await window.nostr?.nip44?.decrypt(
          await window.nostr?.getPublicKey(),
          event.content
        )) ?? ""
      );
    } catch (err) {
      console.error("Failed to decrypt content:", err);
      return "";
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const docs = await fetchAllDocuments(DEFAULT_RELAYS);
        setDocuments(docs);
        setLoading(false);

        // Decrypt content for each document and populate documentMap
        const decryptedDocs = await Promise.all(
          docs.map(async (doc) => {
            const content = await getDecryptedContent(doc);
            return { event: doc, content };
          })
        );

        const map = new Map<string, { event: Event; content: string }>();
        decryptedDocs.forEach((item) => {
          map.set(item.event.id, item);
        });

        setDocumentMap(map);
      } catch (err) {
        console.error("Failed to fetch documents:", err);
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <Typography>Loading documents...</Typography>;
  }

  if (!documentMap) {
    return <Typography>Loading content...</Typography>;
  }

  return (
    <Box sx={{ maxWidth: "800px", width: "100%", p: 2 }}>
      <Typography variant="h5" gutterBottom>
        My Documents
      </Typography>
      {documents.length === 0 ? (
        <Typography>
          No documents found. Create one using the editor!
        </Typography>
      ) : (
        <Paper elevation={2} sx={{ p: 2 }}>
          <List>
            {documents.map((doc) => {
              const content = documentMap.get(doc.id)?.content || "No content";
              return (
                <ListItem
                  key={doc.id}
                  component={ListItemButton}
                  onClick={() => {
                    const dTag = doc.tags.find((t) => t[0] === "d");
                    console.log("Open Dtag", dTag);
                    onEdit(dTag![1]);
                  }}
                  sx={{ display: "flex", justifyContent: "space-between" }}
                >
                  <ListItemText
                    primary={
                      content.substring(0, 40) +
                      (content.length > 40 ? "..." : "")
                    }
                    secondary={`Created: ${new Date(
                      doc.created_at * 1000
                    ).toLocaleString()}`}
                  />
                  <Button variant="contained" size="small">
                    Edit
                  </Button>
                </ListItem>
              );
            })}
          </List>
        </Paper>
      )}
    </Box>
  );
}
