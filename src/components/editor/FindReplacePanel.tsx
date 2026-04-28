import { useState, useEffect, useRef } from "react";
import {
  Box,
  IconButton,
  InputBase,
  Tooltip,
  Typography,
  Button,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import type { Editor } from "@tiptap/react";

type Props = {
  editor: Editor | null;
  onClose: () => void;
};

export function FindReplacePanel({ editor, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [, setTick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (editor.storage as any)?.searchAndReplace;
      const newCount = s?.results?.length ?? 0;
      const newIndex = s?.resultIndex ?? 0;
      setTick((prev) => {
        if (prev === newCount * 1000 + newIndex) return prev;
        return newCount * 1000 + newIndex;
      });
    };
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setSearchTerm(search);
    editor.commands.resetIndex();
  }, [search, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setReplaceTerm(replace);
  }, [replace, editor]);

  useEffect(() => {
    return () => {
      if (!editor) return;
      editor.commands.setSearchTerm("");
      editor.commands.setReplaceTerm("");
    };
  }, [editor]);

  const scrollToCurrentMatch = () => {
    setTimeout(() => {
      const current = document.querySelector(".search-result-current");
      if (current) {
        current.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      editor?.commands.nextSearchResult();
      scrollToCurrentMatch();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      editor?.commands.previousSearchResult();
      scrollToCurrentMatch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      editor?.commands.nextSearchResult();
      scrollToCurrentMatch();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      editor?.commands.previousSearchResult();
      scrollToCurrentMatch();
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = (editor?.storage as any)?.searchAndReplace;
  const results = storage?.results ?? [];
  const resultIndex = storage?.resultIndex ?? 0;
  const matchLabel =
    results.length > 0
      ? `${resultIndex + 1} of ${results.length}`
      : search
        ? "No results"
        : "";

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        px: 1.5,
        py: 1,
        bgcolor: "background.paper",
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
      }}
      onKeyDown={handleKeyDown}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <InputBase
          inputRef={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find..."
          size="small"
          sx={{
            flex: 1,
            fontSize: "0.85rem",
            px: 1,
            py: 0.5,
            minHeight: 44,
            borderRadius: 1,
            bgcolor: "action.hover",
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 210, flexShrink: 0 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ minWidth: 60, textAlign: "center", flexShrink: 0 }}
          >
            {matchLabel}
          </Typography>
          <Tooltip title="Previous match (↑ / Shift+Enter)">
            <span>
              <IconButton
                size="small"
                onClick={() => { editor?.commands.previousSearchResult(); scrollToCurrentMatch(); }}
                disabled={results.length === 0}
                sx={{ minWidth: 44, minHeight: 44 }}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Next match (↓ / Enter)">
            <span>
              <IconButton
                size="small"
                onClick={() => { editor?.commands.nextSearchResult(); scrollToCurrentMatch(); }}
                disabled={results.length === 0}
                sx={{ minWidth: 44, minHeight: 44 }}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Close (Esc)">
            <IconButton
              size="small"
              onClick={onClose}
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <InputBase
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          placeholder="Replace..."
          size="small"
          sx={{
            flex: 1,
            fontSize: "0.85rem",
            px: 1,
            py: 0.5,
            minHeight: 44,
            borderRadius: 1,
            bgcolor: "action.hover",
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 210, flexShrink: 0 }}>
          <Button
            size="small"
            onClick={() => editor?.commands.replace()}
            disabled={results.length === 0}
            sx={{ minHeight: 44, textTransform: "none", flexShrink: 0 }}
          >
            Replace
          </Button>
          <Button
            size="small"
            onClick={() => editor?.commands.replaceAll()}
            disabled={results.length === 0}
            sx={{ minHeight: 44, textTransform: "none", flexShrink: 0 }}
          >
            All
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
