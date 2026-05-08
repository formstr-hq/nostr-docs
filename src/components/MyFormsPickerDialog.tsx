import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  Box,
  Typography,
  TextField,
  InputAdornment,
  CircularProgress,
  ButtonBase,
  Divider,
  Chip,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ArticleIcon from "@mui/icons-material/Article";
import { useMyForms } from "../contexts/MyFormsContext";
import type { MyFormSummary } from "@formstr/sdk";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (naddr: string, nkeys?: string) => void;
}

export default function MyFormsPickerDialog({ open, onClose, onPick }: Props) {
  const { forms, loading } = useMyForms();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => searchRef.current?.focus(), 80);
    }
  }, [open]);

  const filtered = query.trim()
    ? forms.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : forms;

  const handlePick = (form: MyFormSummary) => {
    onPick(form.naddr, form.nkeys);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          overflow: "hidden",
        },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        {/* ── Search bar ───────────────────────────────── */}
        <Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
          <TextField
            inputRef={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your forms…"
            fullWidth
            size="small"
            variant="outlined"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
                </InputAdornment>
              ),
              sx: {
                borderRadius: 2,
                bgcolor: "action.hover",
                "& fieldset": { border: "none" },
              },
            }}
          />
        </Box>

        <Divider />

        {/* ── List ─────────────────────────────────────── */}
        <Box sx={{ maxHeight: 340, overflowY: "auto", py: 0.5 }}>
          {loading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {!loading && filtered.length === 0 && (
            <Box sx={{ py: 4, px: 2, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                {forms.length === 0
                  ? "You haven't created any forms yet."
                  : "No forms match your search."}
              </Typography>
            </Box>
          )}

          {!loading &&
            filtered.map((form) => (
              <ButtonBase
                key={form.formId}
                onClick={() => handlePick(form)}
                sx={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 1,
                  textAlign: "left",
                  borderRadius: 1,
                  mx: 0.5,
                  "&:hover": { bgcolor: "action.hover" },
                  transition: "background-color 0.1s",
                }}
              >
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: 1,
                    bgcolor: "secondary.main",
                    color: "secondary.contrastText",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <ArticleIcon fontSize="small" />
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 500, lineHeight: 1.3 }}
                    noWrap
                  >
                    {form.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {form.fieldCount} {form.fieldCount === 1 ? "field" : "fields"}
                  </Typography>
                </Box>

                <Chip
                  label="Insert"
                  size="small"
                  variant="outlined"
                  color="secondary"
                  sx={{ height: 20, fontSize: "0.65rem", flexShrink: 0 }}
                />
              </ButtonBase>
            ))}
        </Box>

        {!loading && forms.length > 0 && (
          <>
            <Divider />
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="caption" color="text.disabled">
                ↑↓ navigate · Enter to insert · Esc to cancel
              </Typography>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
