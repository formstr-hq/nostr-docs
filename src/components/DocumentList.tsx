import { useEffect, useState } from "react";
import { alpha } from "@mui/material/styles";
import { fetchAllDocuments } from "../nostr/fetchFile.ts";
import {
  Box,
  Typography,
  List,
  ListItemText,
  ListItemButton,
  Button,
  Skeleton,
  Tab,
  Tabs,
  Chip,
  Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
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
  const [tab, setTab] = useState<"personal" | "shared">("personal");
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

    let path = `/doc/${naddr}`;
    if (keys.length > 0 && keys[0]) {
      const nkeysObj: Record<string, string> = { viewKey: keys[0] };
      if (keys[1]) nkeysObj.editKey = keys[1];
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
      setLoading(true);
      try {
        const pubkey = await signer.getPublicKey();
        await fetchAllDocuments(
          relays,
          (doc: Event) => addDocument(doc),
          pubkey,
        );
        await fetchDeleteRequests(relays, addDeletionRequest);
      } catch (err) {
        console.error("Failed to fetch documents:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, relays]);

  const handleNewDoc = () => {
    setSelectedDocumentId(null);
    onEdit(null);
    navigate("/");
  };

  const docsToShow = tab === "personal" ? visibleDocuments : sharedDocuments;
  const personalCount = visibleDocuments.size;
  const sharedCount = sharedDocuments.size;

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* New document button */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1, flexShrink: 0 }}>
        <Button
          fullWidth
          variant="contained"
          color="secondary"
          startIcon={<AddIcon />}
          onClick={handleNewDoc}
          sx={{ fontWeight: 700, borderRadius: 2 }}
        >
          New Document
        </Button>
      </Box>

      {/* Tab switcher */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
        sx={{ flexShrink: 0, borderBottom: "1px solid", borderColor: "divider" }}
        textColor="secondary"
        indicatorColor="secondary"
      >
        <Tab
          value="personal"
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              My Pages
              {personalCount > 0 && (
                <Chip
                  label={personalCount}
                  size="small"
                  color="secondary"
                  sx={{ height: 18, fontSize: "0.65rem" }}
                />
              )}
            </Box>
          }
        />
        <Tab
          value="shared"
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              Shared
              {sharedCount > 0 && (
                <Chip
                  label={sharedCount}
                  size="small"
                  color="secondary"
                  sx={{ height: 18, fontSize: "0.65rem" }}
                />
              )}
            </Box>
          }
        />
      </Tabs>

      {/* List area */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, py: 1 }}>
        {loading ? (
          /* Skeleton placeholders */
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pt: 1 }}>
            {[1, 2, 3, 4].map((i) => (
              <Box key={i} sx={{ px: 1 }}>
                <Skeleton variant="text" width="80%" height={20} />
                <Skeleton variant="text" width="50%" height={14} />
              </Box>
            ))}
          </Box>
        ) : docsToShow.size === 0 ? (
          <Box
            sx={{
              pt: 4,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              textAlign="center"
            >
              {tab === "personal"
                ? "No documents yet.\nCreate your first page!"
                : "No shared documents found."}
            </Typography>
            {tab === "personal" && (
              <Button
                variant="outlined"
                color="secondary"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleNewDoc}
                sx={{ mt: 1 }}
              >
                Create page
              </Button>
            )}
          </Box>
        ) : (
          <List disablePadding>
            {Array.from(docsToShow.entries()).map(([address, history], idx) => {
              const latest = history.versions.at(-1);
              if (!latest) return null;

              const { event, decryptedContent } = latest;
              const isSelected = selectedDocumentId === address;

              // Extract a title-like preview from the first line
              const firstLine =
                (decryptedContent ?? "").split("\n").find((l) => l.trim()) ??
                "Untitled";
              const title = firstLine
                .replace(/^#+\s*/, "") // strip heading markers
                .slice(0, 42)
                .trim();
              const displayTitle = title || "Untitled";

              return (
                <Box key={address}>
                  {idx > 0 && (
                    <Divider
                      sx={{ my: 0.25, borderColor: "rgba(255,255,255,0.05)" }}
                    />
                  )}
                  <ListItemButton
                    onClick={() => handleDocumentSelect(event)}
                    sx={{
                      borderRadius: 2,
                      py: 1,
                      bgcolor: isSelected
                        ? (t) => alpha(t.palette.secondary.main, 0.12)
                        : "transparent",
                      borderLeft: "3px solid",
                      borderLeftColor: isSelected
                        ? "secondary.main"
                        : "transparent",
                      "&:hover": {
                        bgcolor: (t) =>
                          alpha(
                            t.palette.secondary.main,
                            isSelected ? 0.18 : 0.06,
                          ),
                      },
                      transition: "background-color 0.15s",
                    }}
                  >
                    <ListItemText
                      primary={displayTitle}
                      secondary={new Date(
                        event.created_at * 1000,
                      ).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      primaryTypographyProps={{
                        variant: "body2",
                        fontWeight: isSelected ? 700 : 400,
                        noWrap: true,
                      }}
                      secondaryTypographyProps={{
                        variant: "caption",
                        sx: { opacity: 0.6 },
                      }}
                    />
                  </ListItemButton>
                </Box>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
}
