import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Divider,
} from "@mui/material";
import RestoreIcon from "@mui/icons-material/Restore";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { nip44, nip19, getPublicKey } from "nostr-tools";
import { getConversationKey } from "nostr-tools/nip44";
import { hexToBytes } from "nostr-tools/utils";
import { useNavigate } from "react-router-dom";
import {
  loadTrashedEvents,
  restoreLocalEvent,
  removeLocalEvent,
  type LocalStoredEvent,
} from "../lib/localStore";
import { useDocumentContext } from "../contexts/DocumentContext";
import { useRelays } from "../contexts/RelayContext";
import { publishEvent } from "../nostr/publish";
import { signerManager } from "../signer";
import { encodeNKeys } from "../utils/nkeys";
import ConfirmModal from "./common/ConfirmModal";

type TrashItem = LocalStoredEvent & { title: string };

async function decryptTitle(entry: LocalStoredEvent): Promise<string> {
  try {
    let content: string;
    if (entry.viewKey) {
      const conversationKey = getConversationKey(
        hexToBytes(entry.viewKey),
        getPublicKey(hexToBytes(entry.viewKey)),
      );
      content = nip44.decrypt(entry.event.content, conversationKey);
    } else {
      const signer = await signerManager.getSigner();
      if (!signer) return "Untitled";
      const pubkey = await signer.getPublicKey();
      content = await signer.nip44Decrypt!(pubkey, entry.event.content);
    }
    const firstLine = content.split("\n").find((l) => l.trim()) ?? "";
    return firstLine.replace(/^#+\s*/, "").slice(0, 60).trim() || "Untitled";
  } catch {
    return "Untitled";
  }
}

export default function TrashDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<TrashItem | null>(null);

  const { addDocument, clearDeletionRecord } = useDocumentContext();
  const { relays } = useRelays();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadTrashedEvents()
      .then(async (entries) => {
        const withTitles = await Promise.all(
          entries.map(async (e) => ({ ...e, title: await decryptTitle(e) })),
        );
        withTitles.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
        setItems(withTitles);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const handleRestore = async (item: TrashItem) => {
    setRestoring(item.address);
    try {
      await restoreLocalEvent(item.address);
      clearDeletionRecord(item.address);
      await addDocument(item.event, {
        viewKey: item.viewKey,
        editKey: item.editKey,
      });
      // Best-effort re-broadcast — relays that already honoured the NIP-09
      // deletion may reject this, but others will accept it.
      publishEvent(item.event, relays).catch(() => {});
      setItems((prev) => prev.filter((i) => i.address !== item.address));
      onClose();
      const dTag = item.event.tags.find((t) => t[0] === "d")?.[1];
      if (dTag) {
        const naddr = nip19.naddrEncode({
          kind: item.event.kind,
          pubkey: item.event.pubkey,
          identifier: dTag,
        });
        let url = `/doc/${naddr}`;
        if (item.viewKey || item.editKey) {
          const keys: Record<string, string> = {};
          if (item.viewKey) keys.viewKey = item.viewKey;
          if (item.editKey) keys.editKey = item.editKey;
          url += `#${encodeNKeys(keys)}`;
        }
        navigate(url);
      }
    } finally {
      setRestoring(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!confirmItem) return;
    await removeLocalEvent(confirmItem.address);
    setItems((prev) => prev.filter((i) => i.address !== confirmItem.address));
    setConfirmItem(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Trash</DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : items.length === 0 ? (
            <Typography
              color="text.secondary"
              sx={{ px: 3, py: 4, textAlign: "center" }}
            >
              Trash is empty.
            </Typography>
          ) : (
            <List disablePadding>
              {items.map((item, idx) => (
                <Box key={item.address}>
                  {idx > 0 && <Divider />}
                  <ListItem
                    sx={{ px: 3, py: 1.5, alignItems: "flex-start" }}
                    secondaryAction={
                      <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                        <Tooltip title="Restore">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => handleRestore(item)}
                              disabled={restoring === item.address}
                              color="secondary"
                            >
                              {restoring === item.address ? (
                                <CircularProgress size={16} />
                              ) : (
                                <RestoreIcon fontSize="small" />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Delete permanently">
                          <IconButton
                            size="small"
                            onClick={() => setConfirmItem(item)}
                            color="error"
                          >
                            <DeleteForeverIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                          <Typography variant="body2" fontWeight={500}>
                            {item.title}
                          </Typography>
                          {item.pendingBroadcast && (
                            <Chip
                              icon={<WarningAmberIcon />}
                              label="Only local copy"
                              size="small"
                              color="warning"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          Deleted{" "}
                          {new Date(item.trashedAt!).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", year: "numeric" },
                          )}
                        </Typography>
                      }
                    />
                  </ListItem>
                </Box>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="secondary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmModal
        open={!!confirmItem}
        title="Delete permanently?"
        description={
          confirmItem?.pendingBroadcast
            ? "This document was never synced to a relay — it exists only on this device. Permanently deleting it will destroy it with no way to recover."
            : "A deletion was sent to your relays when this document was trashed. This local copy may be the only remaining copy. Permanently deleting it here may leave no way to recover the content."
        }
        confirmText="Delete Forever"
        cancelText="Cancel"
        onConfirm={handlePermanentDelete}
        onCancel={() => setConfirmItem(null)}
      />
    </>
  );
}
