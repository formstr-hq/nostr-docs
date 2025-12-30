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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import { useDocumentContext } from "../contexts/DocumentContext.tsx";
import { signerManager } from "../signer/index.ts";
import { useRelays } from "../contexts/RelayContext.tsx";
import { nip19, type Event } from "nostr-tools";
import { fetchDeleteRequests } from "../nostr/fetchDelete.ts";
import { useUser } from "../contexts/UserContext.tsx";
import { useNavigate } from "react-router-dom";
import { useSharedPages } from "../contexts/SharedDocsContext.tsx";
import { encodeNKeys } from "../utils/nkeys.ts";

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

  const { sharedDocuments, getKeys } = useSharedPages();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"personal" | "shared">("personal");
  const { user } = useUser();
  const { relays } = useRelays();

  const navigate = useNavigate();

  const handleDocumentSelect = (doc: Event) => {
    const dTag = doc.tags.find((t) => t[0] === "d")?.[1];
    if (!dTag) {
      alert("Invalid Doc");
      return;
    }

    const naddr = nip19.naddrEncode({
      identifier: dTag,
      pubkey: doc.pubkey,
      kind: doc.kind,
    });
    const keys = getKeys(`${doc.kind}:${doc.pubkey}:${dTag}`);
    let path = `/doc/${naddr}`;
    console.log("got keys for navigation", keys);
    if (keys.length > 0) {
      const keysBeforeEncoding: any = {
        viewKey: keys[0],
      };
      if (keys[1]) keysBeforeEncoding.editKey = keys[1];
      const encodedStr = encodeNKeys(keysBeforeEncoding);
      path = `${path}#${encodedStr}`;
      navigate(path);
    }
    setSelectedDocumentId(dTag);
    navigate(path);
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
          Create a new private page
        </Button>
      </>
    );
  }
  type DocEntry = { event: Event; decryptedContent: string };
  // Determine which docs to show
  const docsToShow: Map<string, DocEntry> =
    view === "personal" ? visibleDocuments : sharedDocuments;

  return (
    <Box sx={{ maxWidth: "800px", width: "100%", p: 2 }}>
      {/* Toggle between personal and shared */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel id="doc-view-label">View</InputLabel>
        <Select
          labelId="doc-view-label"
          value={view}
          label="View"
          onChange={(e) => setView(e.target.value as "personal" | "shared")}
        >
          <MenuItem value="personal">Personal Pages</MenuItem>
          <MenuItem value="shared">Shared Documents</MenuItem>
        </Select>
      </FormControl>

      <Button
        color="secondary"
        variant="contained"
        style={{ marginBottom: 20 }}
        onClick={() => {
          setSelectedDocumentId(null);
          onEdit(null);
        }}
      >
        Create a new {view === "personal" ? "private" : "shared"} page
      </Button>

      {docsToShow.size === 0 ? (
        <Typography>
          No {view === "personal" ? "personal" : "shared"} documents found.
        </Typography>
      ) : (
        <Paper elevation={0} sx={{ p: 1, bgcolor: "transparent" }}>
          <List>
            {Array.from(docsToShow.entries()).map(([id, doc]) => {
              const content = doc.decryptedContent;
              return (
                <ListItemButton
                  key={id}
                  onClick={() => handleDocumentSelect(doc.event)}
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
