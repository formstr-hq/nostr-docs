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
import { getEventAddress } from "../utils/helpers.ts";

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
    selectedDocumentId,
  } = useDocumentContext();

  const { sharedDocuments, getKeys } = useSharedPages();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"personal" | "shared">("personal");
  const { user } = useUser();
  const { relays } = useRelays();

  const navigate = useNavigate();

  const handleDocumentSelect = (doc: Event) => {
    const dTag = doc.tags.find((t) => t[0] === "d")?.[1];
    const address = getEventAddress(doc);
    if (!address) {
      alert("Invalid Doc");
      return;
    }

    const naddr = nip19.naddrEncode({
      identifier: dTag!,
      pubkey: doc.pubkey,
      kind: doc.kind,
    });
    const keys = getKeys(`${doc.kind}:${doc.pubkey}:${dTag}`);

    // Only include keys that exist
    let path = `/doc/${naddr}`;
    if (keys.length > 0 && keys[0]) {
      const nkeysObj: Record<string, string> = { viewKey: keys[0] };
      if (keys[1]) {
        nkeysObj.editKey = keys[1];
      }
      path = `/doc/${naddr}#${encodeNKeys(nkeysObj)}`;
    }

    setSelectedDocumentId(address);
    navigate(path);
  };

  useEffect(() => {
    (async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      const signer = await signerManager.getSigner();
      if (!signer) {
        setLoading(false);
        return;
      }
      try {
        const pubkey = await signer.getPublicKey();
        await fetchAllDocuments(
          relays,
          (doc: Event) => {
            addDocument(doc);
          },
          pubkey,
        );
        await fetchDeleteRequests(relays, addDeletionRequest);
      } catch (err) {
        console.error("Failed to fetch documents:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) {
    return (
      <>
        {/* <Typography>Loading documents...</Typography> */}
        <Button
          color="secondary"
          variant="contained"
          style={{ marginTop: 30 }}
          onClick={() => {
            setSelectedDocumentId(null);
            onEdit(null);
            console.log("navigationg to home");
            navigate("/");
          }}
        >
          Create a new private page
        </Button>
      </>
    );
  }
  const docsToShow = view === "personal" ? visibleDocuments : sharedDocuments;

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
          navigate("/");
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
            {Array.from(docsToShow.entries()).map(([address, history]) => {
              const latest = history.versions.at(-1);
              if (!latest) return null;

              const { event, decryptedContent } = latest;

              return (
                <ListItemButton
                  key={address}
                  onClick={() => handleDocumentSelect(event)}
                  sx={{
                    borderRadius: 2,
                    mb: 1,
                    bgcolor:
                      selectedDocumentId === address
                        ? "rgba(255, 165, 0, 0.3)"
                        : "rgba(255,255,255,0.03)",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.08)" },
                  }}
                >
                  <ListItemText
                    primary={
                      (decryptedContent ?? "").slice(0, 40) +
                      ((decryptedContent ?? "").length > 40 ? "..." : "")
                    }
                    secondary={new Date(
                      event.created_at * 1000,
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
