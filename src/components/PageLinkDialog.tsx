import { useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import LinkIcon from "@mui/icons-material/Link";
import { useDocumentContext } from "../contexts/DocumentContext";
import { useDocMetadata } from "../contexts/DocMetadataContext";
import { heuristicTitle } from "../lib/docSearch";

interface PageItem {
  address: string;
  title: string;
}

/**
 * Pick an existing page to link, or create a new page and link it. Links are
 * stored as Markdown links with a `page:<address>` href, so they survive the
 * rich/Markdown adapters and remain portable inside the document.
 */
export function PageLinkDialog({
  open,
  onClose,
  currentAddress,
  onSelect,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  currentAddress?: string | null;
  onSelect: (address: string, title: string) => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const { visibleDocuments } = useDocumentContext();
  const { docTitles } = useDocMetadata();
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo<PageItem[]>(() => {
    const list: PageItem[] = [];
    for (const [address, history] of visibleDocuments) {
      if (address === currentAddress) continue;
      const latest = history.versions.at(-1);
      const title =
        docTitles.get(address) ||
        heuristicTitle(latest?.decryptedContent ?? "", 80) ||
        "Untitled";
      list.push({
        address,
        title,
      });
    }
    return list.sort((a, b) => a.title.localeCompare(b.title));
  }, [visibleDocuments, docTitles, currentAddress]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.address.toLowerCase().includes(q),
    );
  }, [items, query]);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(title);
      setNewTitle("");
      onClose();
    } catch (err) {
      console.error("Failed to create linked page:", err);
      setError("Could not create the page. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Link to another page</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Link one of your pages, or create a new page and link it. Cmd/Ctrl-click
          a link in the editor to open it.
        </Typography>

        <TextField
          size="small"
          fullWidth
          placeholder="Search your pages…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18 }} />
              </InputAdornment>
            ),
          }}
        />

        <List
          dense
          sx={{
            mt: 1,
            maxHeight: 260,
            overflowY: "auto",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {filtered.length === 0 ? (
            <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                {items.length === 0
                  ? "No other pages yet. Create one below."
                  : "No pages match that search."}
              </Typography>
            </Box>
          ) : (
            filtered.map((item) => (
              <ListItemButton
                key={item.address}
                onClick={() => {
                  onSelect(item.address, item.title);
                  onClose();
                }}
              >
                <ListItemText
                  primary={item.title}
                  primaryTypographyProps={{ fontSize: "0.88rem", fontWeight: 600 }}
                />
              </ListItemButton>
            ))
          )}
        </List>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Create a new page
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            size="small"
            fullWidth
            label="Page title"
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleCreate();
              }
            }}
            disabled={busy}
          />
          <Button
            variant="contained"
            color="secondary"
            onClick={() => void handleCreate()}
            disabled={!newTitle.trim() || busy}
            startIcon={busy ? <CircularProgress size={14} /> : <LinkIcon />}
            sx={{ textTransform: "none", fontWeight: 700, whiteSpace: "nowrap" }}
          >
            Create & link
          </Button>
        </Box>
        {error && (
          <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
