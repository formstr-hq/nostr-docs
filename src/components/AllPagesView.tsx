import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Typography,
  Button,
  Chip,
  Tooltip,
  alpha,
  TextField,
  InputAdornment,
  IconButton,
  Menu,
  MenuItem,
  SwipeableDrawer,
  ListItemButton,
  Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import SmartphoneOutlinedIcon from "@mui/icons-material/SmartphoneOutlined";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import SortIcon from "@mui/icons-material/Sort";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import CheckIcon from "@mui/icons-material/Check";
import FormstrLogo from "../assets/formstr-pages-logo.png";
import UserMenu from "./UserMenu";
import TrashDialog from "./TrashDialog";
import { loadTrashedEvents } from "../lib/localStore";
import { useDocumentContext } from "../contexts/DocumentContext";
import { useSharedPages } from "../contexts/SharedDocsContext";
import { usePublished } from "../contexts/PublishedContext";
import { useDocMetadata } from "../contexts/DocMetadataContext";
import { useLocation, useNavigate } from "react-router-dom";
import { nip19, type Event } from "nostr-tools";
import { encodeNKeys } from "../utils/nkeys";
import { getEventAddress } from "../utils/helpers";
import {
  heuristicTitle,
  useDocSearch,
  type DocumentHistory,
} from "../lib/docSearch";
import { KIND_LONGFORM, KIND_COMMUNITY_NIP } from "../utils/publishArticle";

function formatRelativeTime(timestampSeconds: number): string {
  const diffMs = Date.now() - timestampSeconds * 1000;
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 1) return "Edited just now";
  if (diffMinutes < 60) return `Edited ${diffMinutes}m ago`;
  if (diffHours < 24) return `Edited ${diffHours}h ago`;
  if (diffDays === 1) return "Edited yesterday";
  if (diffDays < 7) return `Edited ${diffDays}d ago`;
  if (diffDays < 30) return `Edited ${Math.floor(diffDays / 7)}w ago`;
  return `Edited ${new Date(timestampSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

// Helper to get normalized, multi-source tags for a document
export function getDocumentTags(
  address: string,
  docTags: Map<string, string[]>,
  history?: DocumentHistory
): string[] {
  const tagSet = new Set<string>();

  const addTag = (t: string | undefined | null) => {
    if (!t) return;
    const clean = t.trim().toLowerCase().replace(/^#/, "");
    if (clean) tagSet.add(clean);
  };

  // Extract dTag identifier from address
  const parts = address.split(":");
  const dTag = parts.length >= 3 ? parts.slice(2).join(":") : address;

  // 1. Direct match on address
  const directTags = docTags.get(address);
  if (directTags) {
    for (const t of directTags) addTag(t);
  }

  // 2. Direct match on dTag
  const dTagTags = docTags.get(dTag);
  if (dTagTags) {
    for (const t of dTagTags) addTag(t);
  }

  // 3. Scan docTags map for any key that shares the same dTag or address suffix
  for (const [key, tags] of docTags.entries()) {
    const keyParts = key.split(":");
    const keyDTag = keyParts.length >= 3 ? keyParts.slice(2).join(":") : key;

    if (key === address || key === dTag || keyDTag === dTag || key.endsWith(`:${dTag}`)) {
      for (const t of tags) addTag(t);
    }
  }

  // 4. Scan all versions in history for event tags (t, tag, label, l)
  if (history?.versions) {
    for (const version of history.versions) {
      const event = version.event;
      if (!event?.tags) continue;

      for (const tagEntry of event.tags) {
        if (!tagEntry || tagEntry.length < 2) continue;
        const tagName = tagEntry[0].toLowerCase();
        if (tagName === "t" || tagName === "tag" || tagName === "label" || tagName === "l") {
          addTag(tagEntry[1]);
        }
      }
    }
  }

  return Array.from(tagSet);
}

type SortOption = "last_edited" | "title" | "date_created";

export default function AllPagesView() {
  const {
    visibleDocuments,
    visitedDocuments,
    setSelectedDocumentId,
    localOnlyAddresses,
  } = useDocumentContext();
  const { sharedDocuments, getKeys } = useSharedPages();
  const { publishedDocuments } = usePublished();
  const { docTitles, docTags, selectedTag, setSelectedTag } = useDocMetadata();
  const navigate = useNavigate();
  const location = useLocation();

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0);

  useEffect(() => {
    loadTrashedEvents().then((items) => setTrashCount(items.length)).catch(() => {});
  }, []);

  const [sortBy, setSortBy] = useState<SortOption>("last_edited");
  const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Global ⌘K shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        searchRef.current?.blur();
        setQuery("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sync workspace and tag with URL query params
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const workspaceFilter = params.get("workspace") ?? "all";
    const rawTag = params.get("tag") ?? params.get("tags") ?? null;
    const cleanTag = rawTag ? rawTag.trim().toLowerCase().replace(/^#/, "") : null;

    if (["all", "device", "personal", "shared", "published"].includes(workspaceFilter)) {
      setActiveCategory(workspaceFilter);
    }
    setSelectedTag(cleanTag);
  }, [location.search, setSelectedTag]);

  const visitedOnly = useMemo(() => {
    if (sharedDocuments.size === 0) return visitedDocuments;
    const next = new Map(visitedDocuments);
    for (const addr of sharedDocuments.keys()) next.delete(addr);
    return next;
  }, [visitedDocuments, sharedDocuments]);

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

    if (doc.kind === KIND_LONGFORM || doc.kind === KIND_COMMUNITY_NIP) {
      navigate(`/article/${naddr}`);
      return;
    }

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

  const handleNewDoc = () => {
    setSelectedDocumentId(null);
    navigate("/new");
  };

  const handleTagClick = (tag: string) => {
    const norm = tag.trim().toLowerCase().replace(/^#/, "");
    const nextTag = selectedTag?.toLowerCase() === norm ? null : norm;
    setSelectedTag(nextTag);
    const params = new URLSearchParams(location.search);
    if (nextTag) {
      params.set("tag", nextTag);
    } else {
      params.delete("tag");
    }
    params.delete("tags");
    const searchStr = params.toString();
    navigate(searchStr ? `/?${searchStr}` : "/", { replace: true });
  };

  const handleClearTag = () => {
    setSelectedTag(null);
    const params = new URLSearchParams(location.search);
    params.delete("tag");
    params.delete("tags");
    const searchStr = params.toString();
    navigate(searchStr ? `/?${searchStr}` : "/", { replace: true });
  };

  // Combine documents based on active category
  type DocItem = {
    address: string;
    history: DocumentHistory;
    origin: "personal" | "shared" | "visited" | "published";
  };

  const allItems: DocItem[] = useMemo(() => {
    const list: DocItem[] = [];
    visibleDocuments.forEach((history, address) => {
      list.push({ address, history, origin: "personal" });
    });
    sharedDocuments.forEach((history, address) => {
      list.push({ address, history, origin: "shared" });
    });
    visitedOnly.forEach((history, address) => {
      list.push({ address, history, origin: "visited" });
    });
    publishedDocuments.forEach((history, address) => {
      list.push({ address, history, origin: "published" });
    });

    return list.sort((a, b) => {
      const aTime = a.history.versions.at(-1)?.event.created_at ?? 0;
      const bTime = b.history.versions.at(-1)?.event.created_at ?? 0;
      return bTime - aTime;
    });
  }, [visibleDocuments, sharedDocuments, visitedOnly, publishedDocuments]);

  // Documents belonging to the current workspace
  const workspaceItems = useMemo(() => {
    return allItems.filter((item) => {
      const isLocal =
        item.origin === "personal" &&
        (localOnlyAddresses.has(item.address) || !item.history.versions.at(-1)?.event.sig);
      if (activeCategory === "device") return isLocal;
      if (activeCategory === "personal") return item.origin === "personal" && !isLocal;
      if (activeCategory === "shared") return item.origin === "shared" || item.origin === "visited";
      if (activeCategory === "published") return item.origin === "published";
      return true; // 'all'
    });
  }, [allItems, activeCategory, localOnlyAddresses]);

  // Workspace-specific tags only!
  const workspaceTags = useMemo(() => {
    const tagSet = new Set<string>();

    for (const item of workspaceItems) {
      const tags = getDocumentTags(item.address, docTags, item.history);
      for (const t of tags) tagSet.add(t);
    }

    return Array.from(tagSet).filter(Boolean).sort();
  }, [workspaceItems, docTags]);

  const searchHits = useDocSearch(
    visibleDocuments,
    sharedDocuments,
    visitedOnly,
    docTitles,
    docTags,
    query,
  );

  // Filter items by tag and search query within current workspace, and apply sort
  const filteredItems = useMemo(() => {
    const queryMatches = new Set(
      (searchHits ?? []).map((hit) => hit.address),
    );

    const items = workspaceItems.filter((item) => {
      if (selectedTag) {
        const itemTags = getDocumentTags(item.address, docTags, item.history);
        const cleanItemTags = itemTags.map((t) => t.trim().toLowerCase().replace(/^#/, ""));
        if (!cleanItemTags.includes(selectedTag.toLowerCase())) {
          return false;
        }
      }

      if (query.trim() && !queryMatches.has(item.address)) {
        return false;
      }

      return true;
    });

    return items.sort((a, b) => {
      if (sortBy === "title") {
        const getTitle = (item: DocItem) => {
          const latest = item.history.versions.at(-1);
          if (!latest) return "";
          const customTitle = docTitles.get(item.address);
          const titleTag = latest.event.tags.find((t) => t[0] === "title")?.[1];
          return (
            customTitle ||
            titleTag ||
            heuristicTitle(latest.decryptedContent ?? "", 40) ||
            "Untitled"
          ).toLowerCase();
        };
        return getTitle(a).localeCompare(getTitle(b));
      }

      if (sortBy === "date_created") {
        const aFirst = a.history.versions.at(0)?.event.created_at ?? 0;
        const bFirst = b.history.versions.at(0)?.event.created_at ?? 0;
        return bFirst - aFirst;
      }

      // Default: "last_edited" (newest update first)
      const aTime = a.history.versions.at(-1)?.event.created_at ?? 0;
      const bTime = b.history.versions.at(-1)?.event.created_at ?? 0;
      return bTime - aTime;
    });
  }, [workspaceItems, selectedTag, docTags, query, searchHits, sortBy, docTitles]);

  const totalCount = filteredItems.length;

  const headerTitle =
    activeCategory === "device"
      ? "Device"
      : activeCategory === "personal"
      ? "Personal"
      : activeCategory === "shared"
      ? "Shared with me"
      : activeCategory === "published"
      ? "Published"
      : "All pages";

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
        pt: { xs: 0, md: 6 },
        px: { xs: 2.5, sm: 3, md: 4 },
        pb: { xs: 12, md: 5 },
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: { xs: 2.5, sm: 3 },
      }}
    >
      {/* ── Fixed Mobile Header (All Pages Section) ── */}
      <Box
        sx={{
          display: { xs: "flex", md: "none" },
          alignItems: "center",
          justifyContent: "space-between",
          px: { xs: 2.5, sm: 3 },
          py: 1.5,
          minHeight: 66,
          position: "sticky",
          top: 0,
          zIndex: 100,
          bgcolor: (t) => alpha(t.palette.background.default, 0.94),
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid",
          borderColor: "divider",
          mx: { xs: -2.5, sm: -3, md: -4 },
          mb: { xs: 0.5, md: 0 },
        }}
      >
        <Box
          onClick={() => navigate("/")}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <img
            src={FormstrLogo}
            alt="Pages"
            style={{ height: 34, width: 34, objectFit: "contain" }}
          />
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700,
              fontSize: "1.18rem",
              color: "text.primary",
              letterSpacing: "-0.015em",
            }}
          >
            Pages
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center" }}>
          <UserMenu triggerMode="avatar" />
        </Box>
      </Box>

      {/* ── Top Header ────────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          alignItems: { xs: "stretch", sm: "flex-start" },
          justifyContent: "space-between",
          flexDirection: { xs: "column", sm: "row" },
          gap: { xs: 2, sm: 2 },
        }}
      >
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 800,
                fontSize: { xs: "1.6rem", sm: "2.1rem" },
                letterSpacing: "-0.02em",
                color: "text.primary",
              }}
            >
              {headerTitle}
            </Typography>
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              mt: 0.75,
              color: "text.secondary",
              fontSize: "0.84rem",
            }}
          >
            <span>{totalCount} {totalCount === 1 ? "page" : "pages"}</span>
          </Box>
        </Box>

        <Button
          variant="contained"
          color="secondary"
          startIcon={<AddIcon />}
          onClick={handleNewDoc}
          sx={{
            fontWeight: 700,
            borderRadius: 1,
            px: 2.5,
            py: { xs: 1, sm: 0.85 },
            fontSize: "0.85rem",
            width: { xs: "100%", sm: "auto" },
            justifyContent: "center",
            boxShadow: "none",
            "&:hover": { boxShadow: "none" },
          }}
        >
          New page
        </Button>
      </Box>

      {/* ── Search & Workspace-scoped Tags ────────────────── */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {/* Search & Sort Filters */}
        <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
          <TextField
            inputRef={searchRef}
            fullWidth
            placeholder="Search pages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start" sx={{ mr: 1.25, ml: 0.5 }}>
                  <SearchIcon
                    sx={{
                      fontSize: 20,
                      color: query ? "secondary.main" : "text.secondary",
                      opacity: query ? 1 : 0.65,
                      transition: "color 0.15s ease, opacity 0.15s ease",
                    }}
                  />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end" sx={{ mr: 0.5 }}>
                  <IconButton
                    size="small"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                    sx={{
                      p: 0.35,
                      color: "text.secondary",
                      "&:hover": { color: "text.primary" },
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </InputAdornment>
              ) : null,
              sx: {
                fontSize: "0.88rem",
                borderRadius: 1.5,
                bgcolor: (t) => alpha(t.palette.background.paper, 0.6),
                backdropFilter: "blur(8px)",
                "& fieldset": {
                  borderColor: (t) => alpha(t.palette.text.primary, 0.08),
                  transition: "all 0.18s ease",
                },
                "&:hover fieldset": {
                  borderColor: (t) => `${alpha(t.palette.secondary.main, 0.35)} !important`,
                },
                "&.Mui-focused": {
                  boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.secondary.main, 0.15)}`,
                },
                "&.Mui-focused fieldset": {
                  borderColor: (t) => `${t.palette.secondary.main} !important`,
                  borderWidth: "1px !important",
                },
                py: 0,
                height: 48,
                transition: "box-shadow 0.18s ease",
              },
            }}
          />

          {/* Sort Filter Dropdown */}
          <Button
            variant="outlined"
            onClick={(e) => setSortAnchorEl(e.currentTarget)}
            startIcon={<SortIcon sx={{ fontSize: 18 }} />}
            endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
            sx={{
              height: 48,
              px: { xs: 1.5, sm: 2 },
              borderRadius: 1.5,
              borderColor: (t) => alpha(t.palette.text.primary, 0.08),
              bgcolor: (t) => alpha(t.palette.background.paper, 0.6),
              backdropFilter: "blur(8px)",
              color: "text.primary",
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.84rem",
              whiteSpace: "nowrap",
              flexShrink: 0,
              "&:hover": {
                borderColor: (t) => `${alpha(t.palette.secondary.main, 0.35)} !important`,
                bgcolor: (t) => alpha(t.palette.background.paper, 0.8),
              },
            }}
          >
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {sortBy === "last_edited"
                ? "Last edited"
                : sortBy === "title"
                ? "Title, A–Z"
                : "Date created"}
            </Box>
          </Button>

          <Menu
            anchorEl={sortAnchorEl}
            open={Boolean(sortAnchorEl)}
            onClose={() => setSortAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{
              paper: {
                sx: {
                  mt: 1,
                  minWidth: 170,
                  borderRadius: 2,
                  bgcolor: (t) =>
                    t.palette.mode === "dark"
                      ? alpha(t.palette.background.paper, 0.95)
                      : t.palette.background.paper,
                  backdropFilter: "blur(16px)",
                  border: "1px solid",
                  borderColor: "divider",
                  boxShadow: (t) => `0 8px 32px ${alpha(t.palette.common.black, 0.35)}`,
                  p: 0.75,
                },
              },
            }}
          >
            {[
              { id: "last_edited", label: "Last edited" },
              { id: "title", label: "Title, A–Z" },
              { id: "date_created", label: "Date created" },
            ].map((option) => {
              const isSelected = sortBy === option.id;
              return (
                <MenuItem
                  key={option.id}
                  onClick={() => {
                    setSortBy(option.id as SortOption);
                    setSortAnchorEl(null);
                  }}
                  sx={{
                    borderRadius: 1.25,
                    py: 1,
                    px: 1.5,
                    my: 0.25,
                    fontSize: "0.84rem",
                    fontWeight: isSelected ? 700 : 500,
                    bgcolor: isSelected
                      ? (t) => t.palette.secondary.main
                      : "transparent",
                    color: isSelected ? "secondary.contrastText" : "text.primary",
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    "&:hover": {
                      bgcolor: isSelected
                        ? (t) => t.palette.secondary.main
                        : (t) => alpha(t.palette.text.primary, 0.06),
                    },
                  }}
                >
                  {isSelected ? (
                    <CheckIcon sx={{ fontSize: 16, color: "inherit" }} />
                  ) : (
                    <Box sx={{ width: 16 }} />
                  )}
                  {option.label}
                </MenuItem>
              );
            })}
          </Menu>
        </Box>

        {/* Workspace-scoped Tags */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
              Tags {workspaceTags.length > 0 ? `(${workspaceTags.length})` : ""}
            </Typography>
            {selectedTag && (
              <Button
                size="small"
                onClick={handleClearTag}
                sx={{
                  fontSize: "0.68rem",
                  py: 0,
                  px: 0.75,
                  minWidth: 0,
                  height: 20,
                  textTransform: "none",
                  fontWeight: 600,
                  color: "text.secondary",
                  "&:hover": { color: "secondary.main" },
                }}
              >
                Clear
              </Button>
            )}
          </Box>
          {workspaceTags.length > 0 ? (
            <Box
              sx={{
                display: "flex",
                gap: 0.75,
                alignItems: "center",
                overflowX: "auto",
                flexWrap: { xs: "nowrap", sm: "wrap" },
                pb: 0.5,
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": { display: "none" },
                "& > *": { flexShrink: 0 },
              }}
            >
              {workspaceTags.map((tag) => {
                const normTag = tag.trim().toLowerCase().replace(/^#/, "");
                const isSelected = selectedTag?.toLowerCase() === normTag;
                return (
                  <Chip
                    key={tag}
                    label={`#${tag}`}
                    size="small"
                    onClick={() => handleTagClick(tag)}
                    sx={{
                      height: 26,
                      fontSize: "0.74rem",
                      borderRadius: 0.75,
                      bgcolor: isSelected
                        ? (t) => alpha(t.palette.secondary.main, 0.25)
                        : (t) => alpha(t.palette.text.primary, 0.04),
                      color: isSelected ? "secondary.main" : "text.secondary",
                      border: isSelected
                        ? (t) => `1px solid ${t.palette.secondary.main}`
                        : (t) => `1px solid ${alpha(t.palette.text.primary, 0.06)}`,
                      fontWeight: isSelected ? 700 : 500,
                      cursor: "pointer",
                      "&:hover": {
                        bgcolor: (t) => alpha(t.palette.secondary.main, 0.15),
                      },
                    }}
                  />
                );
              })}
            </Box>
          ) : (
            <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
              No tags on {headerTitle.toLowerCase()} pages yet.
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── Cards Grid ────────────────────────────────────── */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(auto-fill, minmax(280px, 1fr))",
          },
          gap: { xs: 2, sm: 2.5 },
          pb: 4,
        }}
      >
        {filteredItems.map(({ address, history, origin }) => {
          const latest = history.versions.at(-1);
          if (!latest) return null;

          const { event, decryptedContent } = latest;
          const customTitle = docTitles.get(address);
          const titleTag = event.tags.find((t) => t[0] === "title")?.[1];
          const displayTitle =
            customTitle || titleTag || heuristicTitle(decryptedContent ?? "", 40) || "Untitled";

          const isPublic = origin === "published";
          const isShared = origin === "shared" || origin === "visited";
          const isLocal =
            origin === "personal" &&
            (localOnlyAddresses.has(address) || !event.sig);
          const isRelaySynced = !isLocal;
          const itemTags = getDocumentTags(address, docTags, history);

          return (
            <Box
              key={address}
              onClick={() => handleDocumentSelect(event)}
              sx={{
                borderRadius: 2,
                bgcolor: "background.paper",
                border: "1px solid",
                borderColor: "divider",
                p: { xs: 2.25, sm: 2.5 },
                minHeight: { xs: 160, sm: 190 },
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                cursor: "pointer",
                transition: "transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
                "&:hover": {
                  transform: "translateY(-3px)",
                  borderColor: "secondary.main",
                  boxShadow: (t) => `0 8px 24px ${alpha(t.palette.common.black, 0.25)}`,
                },
              }}
            >
              {/* Card Top: Status Icon */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Tooltip
                  title={
                    isPublic
                      ? "Public"
                      : isShared
                      ? "Shared with me"
                      : isLocal
                      ? "Device only"
                      : "Private"
                  }
                >
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1,
                      bgcolor: (t) =>
                        isPublic
                          ? alpha("#10B981", 0.08)
                          : isShared
                          ? alpha(t.palette.secondary.main, 0.08)
                          : alpha(t.palette.text.primary, 0.05),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isPublic
                        ? "#10B981"
                        : isShared
                        ? "secondary.main"
                        : "text.secondary",
                    }}
                  >
                    {isPublic ? (
                      <PublicOutlinedIcon sx={{ fontSize: 18, color: "inherit" }} />
                    ) : isShared ? (
                      <GroupOutlinedIcon sx={{ fontSize: 18, color: "inherit" }} />
                    ) : isLocal ? (
                      <SmartphoneOutlinedIcon sx={{ fontSize: 18, color: "inherit" }} />
                    ) : (
                      <LockOutlinedIcon sx={{ fontSize: 18, color: "inherit" }} />
                    )}
                  </Box>
                </Tooltip>
              </Box>

              {/* Card Middle: Title & Tags */}
              <Box sx={{ my: 1.5 }}>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700,
                    fontSize: "1.02rem",
                    lineHeight: 1.35,
                    color: "text.primary",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    mb: 1,
                  }}
                >
                  {displayTitle}
                </Typography>

                {itemTags.length > 0 && (
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                    {itemTags.slice(0, 3).map((t) => {
                      const normT = t.trim().toLowerCase().replace(/^#/, "");
                      const isTagActive = selectedTag?.toLowerCase() === normT;
                      return (
                        <Chip
                          key={t}
                          label={`#${t}`}
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTagClick(t);
                          }}
                          sx={{
                            height: 20,
                            fontSize: "0.68rem",
                            borderRadius: 0.5,
                            bgcolor: isTagActive
                              ? (tTheme) => alpha(tTheme.palette.secondary.main, 0.25)
                              : (tTheme) => alpha(tTheme.palette.text.primary, 0.05),
                            color: isTagActive ? "secondary.main" : "text.secondary",
                            fontWeight: isTagActive ? 700 : 400,
                            cursor: "pointer",
                            "&:hover": {
                              bgcolor: (tTheme) => alpha(tTheme.palette.secondary.main, 0.18),
                            },
                          }}
                        />
                      );
                    })}
                  </Box>
                )}
              </Box>

              {/* Card Bottom: Relative date + relay dots */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "text.secondary",
                  fontSize: "0.72rem",
                  pt: 1,
                  borderTop: "1px solid",
                  borderColor: (t) => alpha(t.palette.text.primary, 0.04),
                }}
              >
                <span>{formatRelativeTime(event.created_at)}</span>
                {isRelaySynced && (
                  <Tooltip title="Synced to relays">
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.3 }}>
                      <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "#34D399" }} />
                      <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "#34D399" }} />
                    </Box>
                  </Tooltip>
                )}
              </Box>
            </Box>
          );
        })}

        {/* ── "+ New page" Card ── */}
        <Box
          onClick={handleNewDoc}
          sx={{
            borderRadius: 1.5,
            border: "1.5px dashed",
            borderColor: (t) => alpha(t.palette.text.primary, 0.12),
            bgcolor: (t) => alpha(t.palette.text.primary, 0.02),
            minHeight: 190,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1.5,
            cursor: "pointer",
            transition: "all 0.18s ease",
            "&:hover": {
              borderColor: "secondary.main",
              bgcolor: (t) => alpha(t.palette.secondary.main, 0.04),
              transform: "translateY(-3px)",
            },
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1,
              bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "text.secondary",
            }}
          >
            <AddIcon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, color: "text.secondary" }}>
            New page
          </Typography>
        </Box>
      </Box>

      {/* ── Mobile Persistent Bottom Workspace Bar (Tap or swipe up to switch workspace) ── */}
      <Box
        onClick={() => setWorkspaceDrawerOpen(true)}
        sx={{
          display: { xs: "flex", md: "none" },
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          bgcolor: (t) => alpha(t.palette.background.paper, 0.96),
          backdropFilter: "blur(16px)",
          borderTop: "1px solid",
          borderColor: "divider",
          px: 2.5,
          pt: 1.5,
          pb: "calc(12px + env(safe-area-inset-bottom, 0px))",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          userSelect: "none",
          transition: "background-color 0.15s ease",
          "&:active": {
            bgcolor: (t) => alpha(t.palette.background.paper, 0.8),
          },
        }}
      >
        {/* Grab handle indicator */}
        <Box
          sx={{
            position: "absolute",
            top: 5,
            left: "50%",
            transform: "translateX(-50%)",
            width: 36,
            height: 3.5,
            borderRadius: 2,
            bgcolor: (t) => alpha(t.palette.text.primary, 0.25),
          }}
        />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              bgcolor: "secondary.main",
            }}
          />
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              fontSize: "0.85rem",
              color: "text.primary",
            }}
          >
            {headerTitle}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 500,
              fontSize: "0.78rem",
            }}
          >
            ({totalCount})
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}>
          <Typography variant="caption" sx={{ fontSize: "0.78rem", fontWeight: 600 }}>
            Workspaces
          </Typography>
          <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />
        </Box>
      </Box>

      {/* ── Mobile Workspace Bottom Sheet ── */}
      <SwipeableDrawer
        anchor="bottom"
        open={workspaceDrawerOpen}
        onClose={() => setWorkspaceDrawerOpen(false)}
        onOpen={() => setWorkspaceDrawerOpen(true)}
        disableSwipeToOpen={false}
        slotProps={{
          paper: {
            sx: {
              borderRadius: "20px 20px 0 0",
              borderTopLeftRadius: "20px",
              borderTopRightRadius: "20px",
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              borderTop: "1px solid",
              borderColor: "divider",
              backgroundImage: "none",
              bgcolor: "background.paper",
              p: 2.5,
              pb: "calc(20px + env(safe-area-inset-bottom, 0px))",
              maxHeight: "80vh",
              boxSizing: "border-box",
            },
          },
        }}
      >
        {/* Pull handle indicator */}
        <Box
          sx={{
            width: 36,
            height: 4,
            borderRadius: 2,
            bgcolor: (t) => alpha(t.palette.text.primary, 0.2),
            mx: "auto",
            mb: 2,
          }}
        />

        {/* Drawer Title */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1,
            mb: 1.5,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "text.disabled",
            }}
          >
            Workspace
          </Typography>
          <IconButton
            size="small"
            onClick={() => setWorkspaceDrawerOpen(false)}
            sx={{ color: "text.secondary", p: 0.5 }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        {/* Workspace Items */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {[
            { id: "all", label: "All pages" },
            { id: "device", label: "Device" },
            { id: "personal", label: "Personal" },
            { id: "shared", label: "Shared with me" },
            { id: "published", label: "Published" },
          ].map((item) => {
            const isSelected = activeCategory === item.id && !selectedTag;
            return (
              <ListItemButton
                key={item.id}
                onClick={() => {
                  setActiveCategory(item.id);
                  setSelectedTag(null);
                  const params = new URLSearchParams(location.search);
                  if (item.id === "all") {
                    params.delete("workspace");
                  } else {
                    params.set("workspace", item.id);
                  }
                  params.delete("tag");
                  params.delete("tags");
                  const searchStr = params.toString();
                  navigate(searchStr ? `/?${searchStr}` : "/", { replace: true });
                  setWorkspaceDrawerOpen(false);
                }}
                sx={{
                  borderRadius: 1.5,
                  py: 1,
                  px: 1.5,
                  bgcolor: isSelected
                    ? (t) => alpha(t.palette.secondary.main, 0.15)
                    : "transparent",
                  color: isSelected ? "secondary.main" : "text.primary",
                  "&:hover": {
                    bgcolor: (t) => alpha(t.palette.secondary.main, 0.08),
                  },
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: isSelected
                          ? "secondary.main"
                          : (t) => alpha(t.palette.text.primary, 0.3),
                      }}
                    />
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: isSelected ? 700 : 500, fontSize: "0.9rem" }}
                    >
                      {item.label}
                    </Typography>
                  </Box>

                  {isSelected && (
                    <CheckIcon sx={{ fontSize: 18, color: "secondary.main" }} />
                  )}
                </Box>
              </ListItemButton>
            );
          })}

          <Divider sx={{ my: 1, borderColor: "divider" }} />

          {/* Trash option */}
          <ListItemButton
            onClick={() => {
              setWorkspaceDrawerOpen(false);
              setTrashOpen(true);
            }}
            sx={{
              borderRadius: 1.5,
              py: 1,
              px: 1.5,
              color: "text.secondary",
              "&:hover": {
                bgcolor: (t) => alpha(t.palette.secondary.main, 0.08),
                color: "text.primary",
              },
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: (t) => alpha(t.palette.text.primary, 0.3),
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.9rem" }}>
                  Trash
                </Typography>
              </Box>

              {trashCount > 0 && (
                <Chip
                  label={trashCount}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: "0.68rem",
                    bgcolor: (t) => alpha(t.palette.text.primary, 0.08),
                    color: "text.secondary",
                    fontWeight: 600,
                  }}
                />
              )}
            </Box>
          </ListItemButton>
        </Box>
      </SwipeableDrawer>

      {/* ── Trash Dialog ── */}
      <TrashDialog
        open={trashOpen}
        onClose={() => {
          setTrashOpen(false);
          loadTrashedEvents()
            .then((items) => setTrashCount(items.length))
            .catch(() => {});
        }}
      />
    </Box>
  );
}
