import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Typography,
  alpha,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import { useDocumentContext } from "../contexts/DocumentContext";
import { useSharedPages } from "../contexts/SharedDocsContext";
import { usePublished } from "../contexts/PublishedContext";
import { useDocMetadata } from "../contexts/DocMetadataContext";
import { heuristicTitle, type DocOrigin, type DocumentHistory } from "../lib/docSearch";
import { exportPagesAsZip } from "../utils/exportPagesZip";

type PageItem = {
  address: string;
  title: string;
  markdown: string;
  origin: DocOrigin;
};

const ORIGIN_ORDER: DocOrigin[] = ["personal", "shared", "visited", "published"];

const ORIGIN_LABEL: Record<DocOrigin, string> = {
  personal: "My pages",
  shared: "Shared with me",
  visited: "Visited",
  published: "Published",
};

/**
 * Dialog that lets a user back up any selection of their pages as a single zip
 * of Markdown files. Pages are grouped by workspace (my/shared/visited/
 * published) with tri-state group toggles so the whole set can be picked or
 * cleared in one click.
 *
 * Selection is tracked as a set of *deselected* addresses rather than selected
 * ones, so pages that arrive asynchronously after the dialog opens (shared and
 * visited docs load over the relay) are included by default instead of silently
 * missing from the backup.
 */
export default function ExportPagesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { visibleDocuments, visitedDocuments } = useDocumentContext();
  const { sharedDocuments } = useSharedPages();
  const { publishedDocuments } = usePublished();
  const { docTitles, docTags } = useDocMetadata();

  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start each session with everything selected.
  useEffect(() => {
    if (open) {
      setDeselected(new Set());
      setError(null);
    }
  }, [open]);

  const items = useMemo<PageItem[]>(() => {
    const out = new Map<string, PageItem>();

    const addAll = (origin: DocOrigin, map: Map<string, DocumentHistory>) => {
      for (const [address, history] of map) {
        if (out.has(address)) continue;
        const latest = history.versions.at(-1);
        if (!latest) continue;
        const title =
          docTitles.get(address) ||
          latest.event.tags.find((t) => t[0] === "title")?.[1] ||
          heuristicTitle(latest.decryptedContent ?? "", 60) ||
          "Untitled";
        out.set(address, {
          address,
          title,
          markdown: latest.decryptedContent ?? "",
          origin,
        });
      }
    };

    // Priority order: a page that appears in more than one workspace is listed
    // once, under the first (most authoritative) origin — same rule the page
    // list and search index use.
    addAll("personal", visibleDocuments);
    addAll("shared", sharedDocuments);
    addAll("visited", visitedDocuments);
    addAll("published", publishedDocuments);

    return Array.from(out.values()).sort((a, b) => {
      const order = ORIGIN_ORDER.indexOf(a.origin) - ORIGIN_ORDER.indexOf(b.origin);
      return order !== 0 ? order : a.title.localeCompare(b.title);
    });
  }, [visibleDocuments, sharedDocuments, visitedDocuments, publishedDocuments, docTitles]);

  const groups = useMemo(
    () =>
      ORIGIN_ORDER.map((origin) => ({
        origin,
        items: items.filter((i) => i.origin === origin),
      })).filter((g) => g.items.length > 0),
    [items],
  );

  const selected = items.filter((i) => !deselected.has(i.address));
  const selectedCount = selected.length;

  const toggleItem = (address: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  };

  const setGroupSelected = (origin: DocOrigin, select: boolean) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (item.origin !== origin) continue;
        if (select) next.delete(item.address);
        else next.add(item.address);
      }
      return next;
    });
  };

  const handleExport = async () => {
    if (selectedCount === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await exportPagesAsZip(
        selected.map(({ address, title, markdown }) => ({ address, title, markdown })),
      );
      onClose();
    } catch (err) {
      console.error("Failed to export pages:", err);
      setError("Could not build the backup. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            backgroundImage: "none",
            bgcolor: "background.paper",
          },
        },
      }}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        <Typography variant="h6" sx={{ fontSize: "1.05rem", fontWeight: 700 }}>
          Backup pages
        </Typography>
        <IconButton size="small" aria-label="Close" onClick={onClose} disabled={busy}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 2.5, py: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Choose which pages to include. Each page is saved as a Markdown (.md) file
          inside a single .zip.
        </Typography>

        {items.length === 0 ? (
          <Typography variant="body2" sx={{ py: 3, color: "text.disabled", fontStyle: "italic" }}>
            You don&apos;t have any pages to export yet.
          </Typography>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "text.disabled",
                  fontSize: "0.68rem",
                }}
              >
                {selectedCount} of {items.length} selected
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <Button
                  size="small"
                  onClick={() => setDeselected(new Set())}
                  sx={{ textTransform: "none", fontSize: "0.72rem", minWidth: 0 }}
                >
                  Select all
                </Button>
                <Button
                  size="small"
                  onClick={() => setDeselected(new Set(items.map((i) => i.address)))}
                  sx={{ textTransform: "none", fontSize: "0.72rem", minWidth: 0 }}
                >
                  Clear
                </Button>
              </Box>
            </Box>

            <Box
              sx={{
                maxHeight: 380,
                overflowY: "auto",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
              }}
            >
              {groups.map((group, gi) => {
                const groupSelectedCount = group.items.filter(
                  (i) => !deselected.has(i.address),
                ).length;
                const allSelected = groupSelectedCount === group.items.length;
                const someSelected = groupSelectedCount > 0 && !allSelected;
                return (
                  <Box key={group.origin}>
                    {gi > 0 && <Divider />}
                    <Box sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03), px: 1.5, py: 0.5 }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={allSelected}
                            indeterminate={someSelected}
                            onChange={() => setGroupSelected(group.origin, !allSelected)}
                          />
                        }
                        label={
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.82rem" }}>
                            {ORIGIN_LABEL[group.origin]} ({group.items.length})
                          </Typography>
                        }
                      />
                    </Box>
                    {group.items.map((item) => {
                      const checked = !deselected.has(item.address);
                      const tags = docTags.get(item.address) ?? [];
                      return (
                        <Box key={item.address} sx={{ px: 1.5 }}>
                          <FormControlLabel
                            sx={{ display: "flex", alignItems: "center", width: "100%", my: 0 }}
                            control={
                              <Checkbox
                                size="small"
                                checked={checked}
                                onChange={() => toggleItem(item.address)}
                                slotProps={{ input: { "aria-label": item.title } }}
                              />
                            }
                            label={
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                                <Typography
                                  variant="body2"
                                  noWrap
                                  sx={{ fontSize: "0.84rem", color: "text.primary" }}
                                >
                                  {item.title}
                                </Typography>
                                {tags.length > 0 && (
                                  <Typography
                                    variant="caption"
                                    noWrap
                                    sx={{ color: "text.disabled", fontSize: "0.7rem" }}
                                  >
                                    {tags.slice(0, 3).map((t) => `#${t}`).join(" ")}
                                  </Typography>
                                )}
                              </Box>
                            }
                          />
                        </Box>
                      );
                    })}
                  </Box>
                );
              })}
            </Box>
          </>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleExport}
          disabled={busy || selectedCount === 0}
          startIcon={
            busy ? <CircularProgress size={16} color="inherit" /> : <DownloadOutlinedIcon />
          }
          sx={{ textTransform: "none", fontWeight: 700 }}
        >
          {busy
            ? "Zipping…"
            : `Export ${selectedCount} ${selectedCount === 1 ? "page" : "pages"}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
