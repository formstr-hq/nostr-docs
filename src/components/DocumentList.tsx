// src/components/DocumentList.tsx
import { useEffect, useState } from "react";
import { fetchAllDocuments } from "../nostr/fetchFile.ts";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItemText,
  ListItemButton,
  Button,
} from "@mui/material";
import { useDocumentContext } from "../contexts/DocumentContext.tsx";
import { signerManager } from "../signer/index.ts";
import { useRelays } from "../contexts/RelayContext.tsx";
import type { Event } from "nostr-tools";
import { fetchDeleteRequests } from "../nostr/fetchDelete.ts";
import { useUser } from "../contexts/UserContext.tsx";
export default function DocumentList({
  onEdit,
}: {
  onEdit: (docId: string | null) => void;
}) {
  const {
    setSelectedDocumentId,
    visibleDocuments,
    addDocument,
    addDeletionRequest,
  } = useDocumentContext();
  const [loading, setLoading] = useState(true);
  const { user } = useUser();
  const { relays } = useRelays();

  // Replace onEdit with context update
  const handleDocumentSelect = (docId: string) => {
    setSelectedDocumentId(docId);
    onEdit(docId); // Maintain backward compatibility if needed
  };

  useEffect(() => {
    (async () => {
      if (!user) return;
      const signer = await signerManager.getSigner();
      try {
        fetchAllDocuments(
          relays,
          (doc: Event) => {
            setLoading(false);
            addDocument(doc);
          },
          await signer.getPublicKey()
        );
        fetchDeleteRequests(relays, addDeletionRequest);
      } catch (err) {
        console.error("Failed to fetch documents:", err);
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) {
    return (
      <>
        <Typography>Loading documents...</Typography>
        <Button
          color="secondary"
          variant="contained"
          style={{ marginTop: 30 }}
          onClick={() => {
            setSelectedDocumentId(null);
            onEdit(null);
          }}
        >
          {" "}
          Create a new private page{" "}
        </Button>
      </>
    );
  }

  return (
    <Box sx={{ maxWidth: "800px", width: "100%", p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Personal Pages
      </Typography>
      <Button
        color="secondary"
        variant="contained"
        style={{ marginTop: 30 }}
        onClick={() => {
          setSelectedDocumentId(null);
          onEdit(null);
        }}
      >
        {" "}
        Create a new private page{" "}
      </Button>
      {visibleDocuments.size === 0 ? (
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
            {Array.from(visibleDocuments.entries()).map(([id, doc]) => {
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
