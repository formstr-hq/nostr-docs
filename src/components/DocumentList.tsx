import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { alpha } from "@mui/material/styles";
import { fetchAllDocuments } from "../nostr/fetchFile.ts";
import {
  loadAllLocalEvents,
  loadTrashedEvents,
  storeLocalEvent,
  markBroadcast,
} from "../lib/localStore.ts";
import { publishEvent } from "../nostr/publish.ts";
import {
  useDocSearch,
  buildSnippet,
  heuristicTitle,
  type DocOrigin,
  type DocumentHistory,
} from "../lib/docSearch.ts";
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
  Tooltip,
  InputAdornment,
  TextField,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import { useDocumentContext } from "../contexts/DocumentContext.tsx";
import { signerManager } from "../signer/index.ts";
import { useRelays } from "../contexts/RelayContext.tsx";
import { nip19, type Event } from "nostr-tools";
import { fetchDeleteRequests } from "../nostr/fetchDelete.ts";
import { useUser } from "../contexts/UserContext.tsx";
import { useNavigate } from "react-router-dom";
import { useSharedPages } from "../contexts/SharedDocsContext.tsx";
import TrashDialog from "./TrashDialog.tsx";
import { encodeNKeys } from "../utils/nkeys.ts";
import { buildSharedDocPath } from "./editor/utils.ts";
import { getEventAddress } from "../utils/helpers.ts";
import { useDocMetadata } from "../contexts/DocMetadataContext.tsx";
import RenameDialog from "./RenameDialog.tsx";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { IconButton } from "@mui/material";

/** Deterministic hue (0–359) from a tag string. */
function tagHue(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function useTagColor(tag: string) {
  const theme = useTheme();
  const hue = tagHue(tag);
  const dark = theme.palette.mode === "dark";
  return {
    bg: `hsla(${hue}, 60%, ${dark ? 55 : 45}%, 0.18)`,
    text: `hsl(${hue}, ${dark ? 75 : 55}%, ${dark ? 78 : 32}%)`,
  };
}

function TagChip({
  tag,
  selected,
  onClick,
  size = "filter",
}: {
  tag: string;
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  size?: "filter" | "inline";
}) {
  const { bg, text } = useTagColor(tag);
  return (
    <Chip
      label={tag}
      size="small"
      onClick={onClick}
      sx={{
        height: size === "filter" ? 22 : 16,
        fontSize: size === "filter" ? "0.72rem" : "0.6rem",
        bgcolor: selected ? `${text}33` : bg,
        color: text,
        border: selected ? `1px solid ${text}` : "none",
        fontWeight: selected ? 700 : 400,
        cursor: onClick ? "pointer" : "default",
        "& .MuiChip-label": { px: size === "filter" ? 1 : 0.75 },
        "&:hover": onClick ? { bgcolor: `${text}33` } : {},
      }}
    />
  );
}


export default function DocumentList({
  onEdit,
}: {
  onEdit: (docId: string | null) => void;
}) {
  const {
    setSelectedDocumentId,
    visibleDocuments,
    visitedDocuments,
    addDocument,
    addDeletionRequest,
    selectedDocumentId,
    localOnlyAddresses,
    markLocalOnly,
    docRelays,
    setDocRelays,
  } = useDocumentContext();

  const { sharedDocuments, getKeys } = useSharedPages();
  const { docTags, docTitles, setDocTitle, docSharedAs, allTags, selectedTag, setSelectedTag } = useDocMetadata();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"personal" | "shared" | "visited">("personal");
  const [trashOpen, setTrashOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamingAddress, setRenamingAddress] = useState<string | null>(null);
  const [renamingInitialTitle, setRenamingInitialTitle] = useState("");
  const [trashCount, setTrashCount] = useState(0);
  const [query, setQuery] = useState("");
  const { user } = useUser();
  const { relays } = useRelays();
  const navigate = useNavigate();

  const searchHits = useDocSearch(
    visibleDocuments,
    sharedDocuments,
    visitedDocuments,
    docTitles,
    docTags,
    query,
  );
  const isSearching = searchHits !== null;

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

      // ── Phase 1: local-first hydration ──────────────────
      let localEntries: Awaited<ReturnType<typeof loadAllLocalEvents>> = [];
      try {
        localEntries = await loadAllLocalEvents();
        for (const entry of localEntries) {
          try {
            await addDocument(entry.event, {
              viewKey: entry.viewKey,
              editKey: entry.editKey,
            });
            if (entry.localOnly) {
              markLocalOnly(entry.address, true);
            }
          } catch {
            // Skip events that can't be decrypted (e.g. belong to another user)
          }
        }
      } catch (err) {
        console.warn("Failed to load local events:", err);
      }

      // ── Phase 2: relay sync ──────────────────────────────
      try {
        const pubkey = await signer.getPublicKey();
        const { relayMap } = await fetchAllDocuments(
          relays,
          async (doc: Event) => {
            const address = getEventAddress(doc);
            const localEntry = address
              ? localEntries.find((e) => e.address === address)
              : undefined;
            await addDocument(doc, {
              viewKey: localEntry?.viewKey,
              editKey: localEntry?.editKey,
            });
            if (address) {
              storeLocalEvent({
                address,
                event: doc,
                viewKey: localEntry?.viewKey,
                editKey: localEntry?.editKey,
                pendingBroadcast: false,
                savedAt: Date.now(),
              }).catch(() => {});
            }
          },
          pubkey,
        );
        setDocRelays(relayMap);
        await fetchDeleteRequests(relays, addDeletionRequest, pubkey);

        // ── Phase 3: re-broadcast any events saved while offline ──
        for (const entry of localEntries) {
          // Never re-broadcast device-only events. They are stored unsigned
          // (sig: "") so relays would reject them anyway, but skip explicitly.
          if (entry.pendingBroadcast && !entry.localOnly) {
            publishEvent(entry.event, relays)
              .then(() => markBroadcast(entry.address))
              .catch(() => {});
          }
        }
      } catch (err) {
        console.error("Failed to fetch documents:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, relays]);

  // Load trash count on mount and after the dialog closes
  const refreshTrashCount = () => {
    loadTrashedEvents().then((items) => setTrashCount(items.length)).catch(() => {});
  };
  useEffect(() => { refreshTrashCount(); }, []);

  const handleNewDoc = () => {
    setSelectedDocumentId(null);
    onEdit(null);
    navigate("/");
  };

  const allDocs =
    tab === "personal" ? visibleDocuments
    : tab === "shared"  ? sharedDocuments
    :                     visitedDocuments;

  // Auto-switch to the tab that owns the currently selected doc
  useEffect(() => {
    if (!selectedDocumentId) return;
    if (visibleDocuments.has(selectedDocumentId)) setTab("personal");
    else if (sharedDocuments.has(selectedDocumentId)) setTab("shared");
    else if (visitedDocuments.has(selectedDocumentId)) setTab("visited");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocumentId]);

  type RenderEntry = {
    address: string;
    history: DocumentHistory;
    origin: DocOrigin;
    terms?: string[];
  };

  const matchesTagFilter = (address: string) =>
    !selectedTag || (docTags.get(address) ?? []).includes(selectedTag);

  // Search spans all three maps; resolve which one an address came from.
  const resolveDoc = (
    address: string,
  ): { history: DocumentHistory; origin: DocOrigin } | null => {
    const personal = visibleDocuments.get(address);
    if (personal) return { history: personal, origin: "personal" };
    const shared = sharedDocuments.get(address);
    if (shared) return { history: shared, origin: "shared" };
    const visit = visitedDocuments.get(address);
    if (visit) return { history: visit, origin: "visited" };
    return null;
  };

  const entries: RenderEntry[] = isSearching
    ? (searchHits!
        .map((hit) => {
          if (!matchesTagFilter(hit.address)) return null;
          const resolved = resolveDoc(hit.address);
          if (!resolved) return null;
          return { address: hit.address, ...resolved, terms: hit.terms };
        })
        .filter(Boolean) as RenderEntry[])
    : [...allDocs.entries()]
        .filter(([address]) => matchesTagFilter(address))
        .sort(([, a], [, b]) => {
          const aTime = a.versions.at(-1)?.event.created_at ?? 0;
          const bTime = b.versions.at(-1)?.event.created_at ?? 0;
          return bTime - aTime;
        })
        .map(([address, history]) => ({ address, history, origin: tab }));

  const personalCount = visibleDocuments.size;
  const sharedCount = sharedDocuments.size;
  const visitedCount = visitedDocuments.size;

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

      {/* Search */}
      <Box sx={{ px: 2, pb: 1, flexShrink: 0 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search all pages"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, opacity: 0.6 }} />
              </InputAdornment>
            ),
            endAdornment: query ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setQuery("")}
                  sx={{ p: 0.25 }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </InputAdornment>
            ) : null,
            sx: { fontSize: "0.85rem", borderRadius: 2 },
          }}
        />
      </Box>

      {/* Tab switcher */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
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
        <Tab
          value="visited"
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              Visited
              {visitedCount > 0 && (
                <Chip
                  label={visitedCount}
                  size="small"
                  color="secondary"
                  sx={{ height: 18, fontSize: "0.65rem" }}
                />
              )}
            </Box>
          }
        />
      </Tabs>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            display: "flex",
            gap: 0.5,
            flexWrap: "wrap",
            flexShrink: 0,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Chip
            label="All"
            size="small"
            onClick={() => setSelectedTag(null)}
            color={selectedTag === null ? "secondary" : "default"}
            sx={{ height: 22, fontSize: "0.72rem" }}
          />
          {allTags.map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              selected={selectedTag === tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
            />
          ))}
        </Box>
      )}

      {/* List area */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, py: 1, pb: 0 }}>
        {loading ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pt: 1 }}>
            {[1, 2, 3, 4].map((i) => (
              <Box key={i} sx={{ px: 1 }}>
                <Skeleton variant="text" width="80%" height={20} />
                <Skeleton variant="text" width="50%" height={14} />
              </Box>
            ))}
          </Box>
        ) : entries.length === 0 ? (
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
              {isSearching
                ? `No matches for "${query.trim()}".`
                : tab === "personal"
                ? "No documents yet.\nCreate your first page!"
                : tab === "visited"
                ? "No visited pages yet.\nOpen a shared link to see it here."
                : "No shared documents found."}
            </Typography>
            {!isSearching && tab === "personal" && (
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
            {entries.map(({ address, history, origin, terms }, idx) => {
              const latest = history.versions.at(-1);
              if (!latest) return null;

              const { event, decryptedContent } = latest;
              const isSelected = selectedDocumentId === address;
              const tags = docTags.get(address) ?? [];
              const relays = docRelays.get(address) ?? [];

              const customTitle = docTitles.get(address);
              const displayTitle =
                customTitle || heuristicTitle(decryptedContent ?? "", 42) || "Untitled";

              const snippet =
                isSearching && terms
                  ? buildSnippet(decryptedContent ?? "", terms)
                  : null;

              return (
                <Box
                  key={address}
                  sx={{ position: "relative", "&:hover .rename-btn": { opacity: 1 } }}
                >
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
                      pr: 0.5,
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
                      primary={
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <Box
                            component="span"
                            sx={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {displayTitle}
                          </Box>
                          <IconButton
                            className="rename-btn"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingAddress(address);
                              setRenamingInitialTitle(displayTitle);
                              setRenameOpen(true);
                            }}
                            sx={{
                              opacity: isSelected ? 1 : 0,
                              transition: "opacity 0.2s",
                              p: 0.25,
                            }}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Box>
                      }
                      secondary={
                        <Box component="span" sx={{ display: "block" }}>
                          <Box component="span" sx={{ opacity: 0.6, fontSize: "0.7rem", display: "flex", alignItems: "center", gap: 0.5 }}>
                            {new Date(event.created_at * 1000).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric", year: "numeric" },
                            )}
                            {isSearching && (
                              <Box
                                component="span"
                                sx={{
                                  fontSize: "0.58rem",
                                  fontWeight: 600,
                                  textTransform: "uppercase",
                                  letterSpacing: 0.4,
                                  opacity: 0.7,
                                  bgcolor: (t) => alpha(t.palette.secondary.main, 0.15),
                                  color: "secondary.main",
                                  borderRadius: 0.75,
                                  px: 0.6,
                                  py: 0.1,
                                  lineHeight: 1.6,
                                }}
                              >
                                {origin === "personal" ? "Mine" : origin === "shared" ? "Shared" : "Visited"}
                              </Box>
                            )}
                          </Box>
                          {snippet && (
                            <Box
                              component="span"
                              sx={{
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                fontSize: "0.72rem",
                                opacity: 0.75,
                                mt: 0.35,
                                lineHeight: 1.35,
                              }}
                            >
                              {snippet.map((seg, i) =>
                                seg.match ? (
                                  <Box
                                    key={i}
                                    component="mark"
                                    sx={{
                                      bgcolor: (t) => alpha(t.palette.secondary.main, 0.35),
                                      color: "inherit",
                                      borderRadius: 0.5,
                                      px: 0.25,
                                    }}
                                  >
                                    {seg.text}
                                  </Box>
                                ) : (
                                  <span key={i}>{seg.text}</span>
                                ),
                              )}
                            </Box>
                          )}
                          {tags.length > 0 && (
                            <Box
                              component="span"
                              sx={{ display: "flex", flexWrap: "wrap", gap: 0.4, mt: 0.4 }}
                            >
                              {tags.map((tag) => (
                                <TagChip
                                  key={tag}
                                  tag={tag}
                                  size="inline"
                                  selected={selectedTag === tag}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTag(selectedTag === tag ? null : tag);
                                  }}
                                />
                              ))}
                            </Box>
                          )}
                          {docSharedAs.has(address) && (() => {
                            const sharedAddr = docSharedAs.get(address)!;
                            const sharedPath = buildSharedDocPath(sharedAddr, getKeys);
                            return (
                              <Tooltip title="Go to live shared version">
                                <Box
                                  component="span"
                                  onClick={(e) => { e.stopPropagation(); navigate(sharedPath); }}
                                  sx={{ display: "flex", alignItems: "center", gap: 0.3, mt: 0.4, cursor: "pointer" }}
                                >
                                  <ArchiveOutlinedIcon sx={{ fontSize: "0.58rem", opacity: 0.55 }} />
                                  <Box
                                    component="span"
                                    sx={{
                                      fontSize: "0.58rem",
                                      fontFamily: "monospace",
                                      opacity: 0.55,
                                      bgcolor: (t) => alpha(t.palette.text.primary, 0.07),
                                      borderRadius: 0.75,
                                      px: 0.6,
                                      py: 0.1,
                                      lineHeight: 1.6,
                                      "&:hover": { opacity: 1 },
                                    }}
                                  >
                                    backup
                                  </Box>
                                </Box>
                              </Tooltip>
                            );
                          })()}
                          {localOnlyAddresses.has(address) ? (
                            <Box
                              component="span"
                              sx={{ display: "flex", alignItems: "center", gap: 0.3, mt: 0.4 }}
                            >
                              <SmartphoneIcon sx={{ fontSize: "0.58rem", opacity: 0.45 }} />
                              <Box
                                component="span"
                                sx={{
                                  fontSize: "0.58rem",
                                  fontFamily: "monospace",
                                  opacity: 0.45,
                                  bgcolor: (t) => alpha(t.palette.text.primary, 0.07),
                                  borderRadius: 0.75,
                                  px: 0.6,
                                  py: 0.1,
                                  lineHeight: 1.6,
                                }}
                              >
                                Device only
                              </Box>
                            </Box>
                          ) : relays.length > 0 && (
                            <Box
                              component="span"
                              sx={{ display: "flex", flexWrap: "wrap", gap: 0.4, mt: 0.4 }}
                            >
                              {relays.map((r) => {
                                const host = new URL(r).hostname;
                                return (
                                  <Tooltip key={r} title={r}>
                                    <Box
                                      component="span"
                                      sx={{
                                        fontSize: "0.58rem",
                                        fontFamily: "monospace",
                                        opacity: 0.5,
                                        bgcolor: (t) => alpha(t.palette.text.primary, 0.07),
                                        borderRadius: 0.75,
                                        px: 0.6,
                                        py: 0.1,
                                        lineHeight: 1.6,
                                      }}
                                    >
                                      {host}
                                    </Box>
                                  </Tooltip>
                                );
                              })}
                            </Box>
                          )}
                        </Box>
                      }
                      primaryTypographyProps={{
                        variant: "body2",
                        fontWeight: isSelected ? 700 : 400,
                        noWrap: true,
                      }}
                      secondaryTypographyProps={{ component: "span" }}
                    />
                  </ListItemButton>
                </Box>
              );
            })}
          </List>
        )}
      </Box>

      {/* Trash link */}
      <Box
        sx={{
          px: 2,
          py: 1,
          borderTop: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Button
          size="small"
          startIcon={<DeleteForeverIcon sx={{ fontSize: 15 }} />}
          onClick={() => setTrashOpen(true)}
          sx={{
            color: "text.disabled",
            fontWeight: 400,
            fontSize: "0.75rem",
            textTransform: "none",
            "&:hover": { color: "text.secondary" },
          }}
        >
          Trash
          {trashCount > 0 && (
            <Chip
              label={trashCount}
              size="small"
              sx={{ ml: 0.75, height: 16, fontSize: "0.6rem", "& .MuiChip-label": { px: 0.75 } }}
            />
          )}
        </Button>
      </Box>

      <TrashDialog
        open={trashOpen}
        onClose={() => {
          setTrashOpen(false);
          refreshTrashCount();
        }}
      />
      {renamingAddress && (
        <RenameDialog
          open={renameOpen}
          initialTitle={renamingInitialTitle}
          onClose={() => setRenameOpen(false)}
          onSave={async (newTitle) => {
            // If they clear it, we'll save empty string to remove custom title.
            // If they didn't change it from the initial title, we don't need to save
            if (newTitle === docTitles.get(renamingAddress)) {
              return;
            }
            await setDocTitle(renamingAddress, newTitle);
          }}
        />
      )}
    </Box>
  );
}
