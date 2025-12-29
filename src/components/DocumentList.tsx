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
import { useDocumentContext } from "../contexts/DocumentContext.tsx";

export default function DocumentList({
  onEdit,
}: {
  onEdit: (docId: string) => void;
}) {
  const { setSelectedDocumentId, documents, addDocument } =
    useDocumentContext();
  const [loading, setLoading] = useState(true);

  // Replace onEdit with context update
  const handleDocumentSelect = (docId: string) => {
    setSelectedDocumentId(docId);
    onEdit(docId); // Maintain backward compatibility if needed
  };

  useEffect(() => {
    (async () => {
      try {
        const docs = await fetchAllDocuments(DEFAULT_RELAYS, addDocument);
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch documents:", err);
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <Typography>Loading documents...</Typography>;
  }

  return (
    <Box sx={{ maxWidth: "800px", width: "100%", p: 2 }}>
      <Typography variant="h5" gutterBottom>
        My Documents
      </Typography>
      {documents.size === 0 ? (
        <Typography>
          No documents found. Create one using the editor!
        </Typography>
      ) : (
        <Paper
          elevation={0}
          sx={{
            p: 1,
            bgcolor: "transparent",
          }}
        >
          <List>
            {Array.from(documents.entries()).map(([id, doc]) => {
              const content = doc.decryptedContent;
              return (
                <ListItemButton
                  key={id}
                  onClick={() => handleDocumentSelect(id)}
                  sx={{
                    borderRadius: 2,
                    mb: 1,
                    bgcolor: "rgba(255,255,255,0.03)",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.08)" },
                  }}
                >
                  <ListItemText
                    primary={
                      content.substring(0, 40) +
                      (content.length > 40 ? "..." : "")
                    }
                    secondary={new Date(
                      doc.event.created_at * 1000
                    ).toLocaleString()}
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Paper>
      )}
    </Box>
  );
}
