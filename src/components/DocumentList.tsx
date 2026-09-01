import { useEffect, useMemo, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Typography, ListItemButton, Chip, Tooltip, IconButton } from "@mui/material";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import { useDocumentContext } from "../contexts/DocumentContext.tsx";
import { useSharedPages } from "../contexts/SharedDocsContext.tsx";
import { usePublished } from "../contexts/PublishedContext.tsx";
import { useNavigate, useLocation } from "react-router-dom";
import { loadTrashedEvents } from "../lib/localStore.ts";
import { useDocMetadata } from "../contexts/DocMetadataContext.tsx";
import { getDocumentTags } from "./AllPagesView.tsx";
import type { DocumentHistory } from "../lib/docSearch";
import TrashDialog from "./TrashDialog.tsx";
import UserMenu from "./UserMenu";
import FormstrLogo from "../assets/formstr-pages-logo.svg";

export default function DocumentList({
  onEdit,
}: {
  onEdit: (docId: string | null) => void;
}) {
  const { visibleDocuments, visitedDocuments, setSelectedDocumentId } = useDocumentContext();
  const { sharedDocuments } = useSharedPages();
  const { publishedDocuments } = usePublished();
  const { docTags, selectedTag, setSelectedTag } = useDocMetadata();
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/";
  const workspaceFilter = new URLSearchParams(location.search).get("workspace") ?? "all";
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0);

  // Tags belonging to currently selected workspace
  const currentWorkspaceTags = useMemo(() => {
    const tagSet = new Set<string>();
    const list: { address: string; history?: DocumentHistory }[] = [];

    if (workspaceFilter === "all") {
      visibleDocuments.forEach((history, address) => list.push({ address, history }));
      sharedDocuments.forEach((history, address) => list.push({ address, history }));
      visitedDocuments.forEach((history, address) => {
        if (!sharedDocuments.has(address)) list.push({ address, history });
      });
      publishedDocuments.forEach((history, address) => list.push({ address, history }));
    } else if (workspaceFilter === "personal") {
      visibleDocuments.forEach((history, address) => list.push({ address, history }));
    } else if (workspaceFilter === "shared") {
      sharedDocuments.forEach((history, address) => list.push({ address, history }));
      visitedDocuments.forEach((history, address) => {
        if (!sharedDocuments.has(address)) list.push({ address, history });
      });
    } else if (workspaceFilter === "published") {
      publishedDocuments.forEach((history, address) => list.push({ address, history }));
    }

    for (const item of list) {
      const tags = getDocumentTags(item.address, docTags, item.history);
      for (const t of tags) tagSet.add(t);
    }

    return Array.from(tagSet).filter(Boolean).sort();
  }, [workspaceFilter, visibleDocuments, sharedDocuments, visitedDocuments, publishedDocuments, docTags]);

  const selectWorkspace = (filter: "all" | "personal" | "shared" | "published") => {
    setSelectedDocumentId(null);
    setSelectedTag(null);
    onEdit(null);
    const nextUrl = filter === "all" ? "/" : `/?workspace=${filter}`;
    navigate(nextUrl);
  };

  const selectTag = (tag: string) => {
    setSelectedDocumentId(null);
    onEdit(null);
    const norm = tag.trim().toLowerCase().replace(/^#/, "");
    const currentNorm = selectedTag?.trim().toLowerCase().replace(/^#/, "");
    const nextTag = currentNorm === norm ? null : norm;
    setSelectedTag(nextTag);
    const params = new URLSearchParams();
    if (workspaceFilter !== "all") params.set("workspace", workspaceFilter);
    if (nextTag) params.set("tag", nextTag);
    const searchStr = params.toString();
    navigate(searchStr ? `/?${searchStr}` : "/");
  };

  const refreshTrashCount = () => {
    loadTrashedEvents().then((items) => setTrashCount(items.length)).catch(() => {});
  };

  useEffect(() => {
    refreshTrashCount();
  }, []);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        pt: 3,
        pl: 1,
      }}
    >
      <Box
        onClick={() => {
          setSelectedDocumentId(null);
          setSelectedTag(null);
          onEdit(null);
          navigate("/");
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 2,
          pt: 1,
          pb: 1.5,
          flexShrink: 0,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <img
          src={FormstrLogo}
          alt="Pages"
          style={{ height: 60, width: 60, objectFit: "contain" }}
        />
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            fontSize: "1.15rem",
            letterSpacing: "-0.01em",
            color: "text.primary",
          }}
        >
          Pages
        </Typography>
      </Box>

      <Box sx={{ px: 1.5, pb: 0.5, flexShrink: 0 }}>
        <Typography
          variant="caption"
          sx={{
            display: "block",
            px: 1,
            pt: 0.5,
            pb: 0.75,
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "text.disabled",
            textTransform: "uppercase",
          }}
        >
          Workspace
        </Typography>

        <ListItemButton
          onClick={() => selectWorkspace("all")}
          sx={{
            borderRadius: 1,
            py: 0.65,
            px: 1.25,
            mb: 0.4,
            bgcolor: isHome && workspaceFilter === "all" && !selectedTag ? "secondary.main" : "transparent",
            color: isHome && workspaceFilter === "all" && !selectedTag ? "secondary.contrastText" : "text.primary",
            "&:hover": {
              bgcolor: isHome && workspaceFilter === "all" && !selectedTag ? "secondary.main" : (t) => alpha(t.palette.secondary.main, 0.08),
            },
            transition: "all 0.15s ease",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: isHome && !selectedTag ? "currentColor" : "secondary.main",
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: isHome && !selectedTag ? 700 : 500, fontSize: "0.82rem" }}>
              All pages
            </Typography>
          </Box>
        </ListItemButton>

        <ListItemButton
          onClick={() => selectWorkspace("personal")}
          sx={{
            borderRadius: 1,
            py: 0.55,
            px: 1.25,
            mb: 0.3,
            bgcolor: workspaceFilter === "personal" && !selectedTag ? (t) => alpha(t.palette.secondary.main, 0.18) : "transparent",
            color: workspaceFilter === "personal" && !selectedTag ? "secondary.main" : "text.secondary",
            "&:hover": {
              bgcolor: (t) => alpha(t.palette.secondary.main, 0.08),
              color: "text.primary",
            },
            transition: "all 0.15s ease",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: workspaceFilter === "personal" && !selectedTag ? "secondary.main" : (t) => alpha(t.palette.text.primary, 0.35),
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: workspaceFilter === "personal" && !selectedTag ? 700 : 500, fontSize: "0.82rem" }}>
              Personal
            </Typography>
          </Box>
        </ListItemButton>

        <ListItemButton
          onClick={() => selectWorkspace("shared")}
          sx={{
            borderRadius: 1,
            py: 0.55,
            px: 1.25,
            mb: 0.3,
            bgcolor: workspaceFilter === "shared" && !selectedTag ? (t) => alpha(t.palette.secondary.main, 0.18) : "transparent",
            color: workspaceFilter === "shared" && !selectedTag ? "secondary.main" : "text.secondary",
            "&:hover": {
              bgcolor: (t) => alpha(t.palette.secondary.main, 0.08),
              color: "text.primary",
            },
            transition: "all 0.15s ease",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: workspaceFilter === "shared" && !selectedTag ? "secondary.main" : (t) => alpha(t.palette.text.primary, 0.35),
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: workspaceFilter === "shared" && !selectedTag ? 700 : 500, fontSize: "0.82rem" }}>
              Shared with me
            </Typography>
          </Box>
        </ListItemButton>

        <ListItemButton
          onClick={() => selectWorkspace("published")}
          sx={{
            borderRadius: 1,
            py: 0.55,
            px: 1.25,
            mb: 0.3,
            bgcolor: workspaceFilter === "published" && !selectedTag ? (t) => alpha(t.palette.secondary.main, 0.18) : "transparent",
            color: workspaceFilter === "published" && !selectedTag ? "secondary.main" : "text.secondary",
            "&:hover": {
              bgcolor: (t) => alpha(t.palette.secondary.main, 0.08),
              color: "text.primary",
            },
            transition: "all 0.15s ease",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: workspaceFilter === "published" && !selectedTag ? "secondary.main" : (t) => alpha(t.palette.text.primary, 0.35),
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: workspaceFilter === "published" && !selectedTag ? 700 : 500, fontSize: "0.82rem" }}>
              Published
            </Typography>
          </Box>
        </ListItemButton>
      </Box>

      {/* ── Workspace Tags in Sidebar ── */}
      {currentWorkspaceTags.length > 0 && (
        <Box sx={{ px: 1.5, pt: 1, pb: 0.5, flexShrink: 0 }}>
          <Typography
            variant="caption"
            sx={{
              display: "block",
              px: 1,
              pt: 0.5,
              pb: 0.5,
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "text.disabled",
              textTransform: "uppercase",
            }}
          >
            Tags ({currentWorkspaceTags.length})
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, maxHeight: 180, overflowY: "auto" }}>
            {currentWorkspaceTags.map((tag) => {
              const isTagActive = selectedTag?.toLowerCase() === tag.toLowerCase();
              return (
                <ListItemButton
                  key={tag}
                  onClick={() => selectTag(tag)}
                  sx={{
                    borderRadius: 1,
                    py: 0.4,
                    px: 1.25,
                    bgcolor: isTagActive ? (t) => alpha(t.palette.secondary.main, 0.18) : "transparent",
                    color: isTagActive ? "secondary.main" : "text.secondary",
                    "&:hover": {
                      bgcolor: (t) => alpha(t.palette.secondary.main, 0.08),
                      color: "text.primary",
                    },
                    transition: "all 0.15s ease",
                  }}
                >
                  <Typography variant="body2" sx={{ fontSize: "0.8rem", fontWeight: isTagActive ? 700 : 500 }}>
                    #{tag}
                  </Typography>
                </ListItemButton>
              );
            })}
          </Box>
        </Box>
      )}

      <Box sx={{ flex: 1 }} />

      <Box
        sx={{
          px: 1.75,
          py: 1.25,
          minHeight: 54,
          boxSizing: "border-box",
          borderTop: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <UserMenu triggerMode="pill" />
        </Box>

        <Tooltip title="Trash">
          <IconButton
            size="small"
            onClick={() => setTrashOpen(true)}
            sx={{
              p: 0.5,
              color: "text.disabled",
              "&:hover": { color: "text.secondary" },
            }}
          >
            <DeleteForeverIcon sx={{ fontSize: 16 }} />
            {trashCount > 0 && (
              <Chip
                label={trashCount}
                size="small"
                sx={{ ml: 0.5, height: 14, fontSize: "0.55rem", "& .MuiChip-label": { px: 0.4 } }}
              />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      <TrashDialog
        open={trashOpen}
        onClose={() => {
          setTrashOpen(false);
          refreshTrashCount();
        }}
      />
    </Box>
  );
}
