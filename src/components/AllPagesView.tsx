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
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import MenuIcon from "@mui/icons-material/Menu";
import FormstrLogo from "../assets/formstr-pages-logo.svg";
import UserMenu from "./UserMenu";
import { useDocumentContext } from "../contexts/DocumentContext";
import { useSharedPages } from "../contexts/SharedDocsContext";
import { usePublished } from "../contexts/PublishedContext";
import { useDocMetadata } from "../contexts/DocMetadataContext";
import { useRelays } from "../contexts/RelayContext";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
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

export default function AllPagesView() {
  const {
    visibleDocuments,
    visitedDocuments,
    setSelectedDocumentId,
  } = useDocumentContext();
  const { sharedDocuments, getKeys } = useSharedPages();
  const { publishedDocuments } = usePublished();
  const { docTitles, docTags, selectedTag, setSelectedTag } = useDocMetadata();
  const { relays } = useRelays();
  const navigate = useNavigate();
  const location = useLocation();
  const outletCtx = useOutletContext<{ onOpenSidebar?: () => void }>() || {};
  const onOpenSidebar = outletCtx?.onOpenSidebar;

  const [activeCategory, setActiveCategory] = useState<string>("all");
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
    const tagFilter = params.get("tag");

    if (["all", "personal", "shared", "published"].includes(workspaceFilter)) {
      setActiveCategory(workspaceFilter);
    }
    if (tagFilter) {
      setSelectedTag(tagFilter.trim().toLowerCase().replace(/^#/, ""));
    } else {
      setSelectedTag(null);
    }
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

  const handleWorkspaceSelect = (catId: string) => {
    setActiveCategory(catId);
    setSelectedTag(null);
    const params = new URLSearchParams();
    if (catId !== "all") params.set("workspace", catId);
    const searchStr = params.toString();
    navigate(searchStr ? `/?${searchStr}` : "/");
  };

  const handleTagClick = (tag: string) => {
    const norm = tag.trim().toLowerCase().replace(/^#/, "");
    const currentNorm = selectedTag?.trim().toLowerCase().replace(/^#/, "");
    const nextTag = currentNorm === norm ? null : norm;
    setSelectedTag(nextTag);
    const params = new URLSearchParams(location.search);
    if (nextTag) {
      params.set("tag", nextTag);
    } else {
      params.delete("tag");
    }
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
      if (activeCategory === "personal") return item.origin === "personal";
      if (activeCategory === "shared") return item.origin === "shared" || item.origin === "visited";
      if (activeCategory === "published") return item.origin === "published";
      return true; // 'all'
    });
  }, [allItems, activeCategory]);

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

  // Filter items by tag and search query within current workspace
  const filteredItems = useMemo(() => {
    const queryMatches = new Set(
      (searchHits ?? []).map((hit) => hit.address),
    );

    const cleanSelected = selectedTag ? selectedTag.trim().toLowerCase().replace(/^#/, "") : null;

    return workspaceItems.filter((item) => {
      if (cleanSelected) {
        const itemTags = getDocumentTags(item.address, docTags, item.history);
        const cleanItemTags = itemTags.map((t) => t.trim().toLowerCase().replace(/^#/, ""));
        if (!cleanItemTags.includes(cleanSelected)) {
          return false;
        }
      }

      if (query.trim() && !queryMatches.has(item.address)) {
        return false;
      }

      return true;
    });
  }, [workspaceItems, selectedTag, docTags, query, searchHits]);

  const totalCount = filteredItems.length;

  const headerTitle =
    activeCategory === "personal"
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
        pb: { xs: 6, sm: 5 },
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
          px: { xs: 2, sm: 2.5 },
          py: 1.25,
          minHeight: 58,
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {onOpenSidebar && (
            <IconButton
              size="small"
              aria-label="Open sidebar menu"
              onClick={onOpenSidebar}
              sx={{
                p: 0.75,
                borderRadius: 1.25,
                border: "none",
                color: "text.primary",
                "&:hover": {
                  bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
                },
              }}
            >
              <MenuIcon sx={{ fontSize: 22 }} />
            </IconButton>
          )}

          <Box
            onClick={() => navigate("/")}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <img
              src={FormstrLogo}
              alt="Pages"
              style={{ height: 28, width: 28, objectFit: "contain" }}
            />
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                fontSize: "1.05rem",
                color: "text.primary",
                letterSpacing: "-0.01em",
              }}
            >
              Pages
            </Typography>
          </Box>
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

            {selectedTag && (
              <Chip
                label={`#${selectedTag}`}
                onDelete={() => handleTagClick(selectedTag)}
                color="secondary"
                size="small"
                sx={{
                  fontWeight: 700,
                  fontSize: "0.78rem",
                  borderRadius: 1,
                }}
              />
            )}
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              flexWrap: "wrap",
              mt: 0.75,
              color: "text.secondary",
              fontSize: "0.84rem",
            }}
          >
            <span>{totalCount} {totalCount === 1 ? "page" : "pages"}</span>
            <span>·</span>
            <span>synced across {relays.length} relays</span>
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.4, ml: 0.25 }}>
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  bgcolor: "#34D399",
                }}
              />
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  bgcolor: "#34D399",
                }}
              />
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  bgcolor: "#34D399",
                }}
              />
            </Box>
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
        {/* Search */}
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

        {/* Workspace Pills */}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            alignItems: "center",
            overflowX: "auto",
            flexWrap: { xs: "nowrap", sm: "wrap" },
            pb: { xs: 0.5, sm: 0 },
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
            "& > *": { flexShrink: 0 },
          }}
        >
          {[
            { id: "all", label: "All" },
            { id: "personal", label: "Personal" },
            { id: "shared", label: "Shared with me" },
            { id: "published", label: "Published" },
          ].map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <Button
                key={cat.id}
                size="small"
                onClick={() => handleWorkspaceSelect(cat.id)}
                sx={{
                  borderRadius: 1,
                  px: 1.75,
                  py: 0.5,
                  fontSize: "0.8rem",
                  fontWeight: isActive ? 700 : 500,
                  bgcolor: isActive
                    ? (t) => t.palette.secondary.main
                    : (t) => alpha(t.palette.text.primary, 0.04),
                  color: isActive ? "secondary.contrastText" : "text.primary",
                  border: "1px solid",
                  borderColor: isActive
                    ? "transparent"
                    : (t) => alpha(t.palette.text.primary, 0.08),
                  "&:hover": {
                    bgcolor: isActive
                      ? (t) => t.palette.secondary.main
                      : (t) => alpha(t.palette.text.primary, 0.08),
                  },
                }}
              >
                {cat.label}
              </Button>
            );
          })}
        </Box>

        {/* Workspace-scoped Tags */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
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
                const isSelected = selectedTag?.toLowerCase() === tag.toLowerCase();
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
          const badgeLabel = isPublic ? "PUBLIC" : isShared ? "SHARED" : "PRIVATE";
          const badgeColor = isPublic ? "#10B981" : isShared ? "#8B5CF6" : "#71717A";
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
              {/* Card Top: Icon + Badge */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: 1,
                    bgcolor: (t) => alpha(t.palette.text.primary, 0.05),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "text.secondary",
                  }}
                >
                  {isPublic ? (
                    <PublicOutlinedIcon sx={{ fontSize: 18, color: "#10B981" }} />
                  ) : (
                    <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />
                  )}
                </Box>

                <Box
                  sx={{
                    fontSize: "0.62rem",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    px: 1,
                    py: 0.25,
                    borderRadius: 0.75,
                    border: `1px solid ${alpha(badgeColor, 0.3)}`,
                    bgcolor: alpha(badgeColor, 0.08),
                    color: badgeColor,
                    textTransform: "uppercase",
                  }}
                >
                  {badgeLabel}
                </Box>
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
                      const isTagActive = selectedTag?.toLowerCase() === t.toLowerCase();
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
                <Tooltip title="Synced">
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.3 }}>
                    <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "#34D399" }} />
                    <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "#34D399" }} />
                  </Box>
                </Tooltip>
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
    </Box>
  );
}
