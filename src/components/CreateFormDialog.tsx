import { useState, useRef, useEffect } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  Typography,
  TextField,
  Button,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  Tooltip,
  Divider,
  CircularProgress,
  Chip,
  Collapse,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { FormstrSDK, encodeNKeys } from "@formstr/sdk";
import type { FormsSigner, FormField, CreateFormResult } from "@formstr/sdk";
import { useRelays } from "../contexts/RelayContext";
import { pool } from "../nostr/relayPool";
import type { Event as NostrEvent } from "nostr-tools";

const sdk = new FormstrSDK();

type FieldType = "shortText" | "paragraph" | "radioButton" | "checkboxes" | "number";

const FIELD_TYPES: { value: FieldType; label: string; icon: string }[] = [
  { value: "shortText", label: "Short answer", icon: "Aa" },
  { value: "paragraph", label: "Paragraph", icon: "¶" },
  { value: "radioButton", label: "Multiple choice", icon: "◉" },
  { value: "checkboxes", label: "Checkboxes", icon: "☑" },
  { value: "number", label: "Number", icon: "#" },
];

interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
}

function makeId(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len);
}

function emptyField(): FieldDef {
  return { id: makeId(), label: "", type: "shortText", options: ["Option 1"], required: false };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (naddr: string, nkeys?: string) => void;
  signer: FormsSigner | null;
}

export default function CreateFormDialog({ open, onClose, onCreated, signer }: Props) {
  const [formName, setFormName] = useState("Untitled form");
  const [fields, setFields] = useState<FieldDef[]>([emptyField()]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateFormResult | null>(null);
  const [retrying, setRetrying] = useState<"form" | "myForms" | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const { relays } = useRelays();

  // Auto-select title on open
  useEffect(() => {
    if (open) setTimeout(() => titleRef.current?.select(), 80);
  }, [open]);

  const addField = () => setFields((prev) => [...prev, emptyField()]);

  const removeField = (idx: number) =>
    setFields((prev) => prev.filter((_, i) => i !== idx));

  const patchField = (idx: number, patch: Partial<FieldDef>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const addOption = (fi: number) =>
    setFields((prev) =>
      prev.map((f, i) =>
        i === fi ? { ...f, options: [...f.options, `Option ${f.options.length + 1}`] } : f,
      ),
    );

  const patchOption = (fi: number, oi: number, val: string) =>
    setFields((prev) =>
      prev.map((f, i) =>
        i === fi
          ? { ...f, options: f.options.map((o, j) => (j === oi ? val : o)) }
          : f,
      ),
    );

  const removeOption = (fi: number, oi: number) =>
    setFields((prev) =>
      prev.map((f, i) =>
        i === fi ? { ...f, options: f.options.filter((_, j) => j !== oi) } : f,
      ),
    );

  const rebroadcast = async (event: NostrEvent, targetRelays: string[], kind: "form" | "myForms") => {
    setRetrying(kind);
    try {
      const results = await Promise.allSettled(pool.publish(targetRelays, event));
      const accepted: string[] = [];
      const rejected: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") accepted.push(targetRelays[i]);
        else rejected.push(targetRelays[i]);
      });
      setResult((prev) => {
        if (!prev) return prev;
        if (kind === "form") return { ...prev, formRelays: { accepted: [...prev.formRelays.accepted, ...accepted], rejected } };
        return { ...prev, myFormsRelays: { accepted: [...(prev.myFormsRelays?.accepted ?? []), ...accepted], rejected } };
      });
    } finally {
      setRetrying(null);
    }
  };

  const handleCreate = async () => {
    const name = formName.trim() || "Untitled form";
    if (fields.some((f) => !f.label.trim())) {
      setError("Every question needs a label.");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const formFields: FormField[] = fields.map((f) => ({
        label: f.label,
        type: f.type,
        options: (f.type === "radioButton" || f.type === "checkboxes") ? f.options.filter(Boolean) : undefined,
        required: f.required,
      }));
      const res = await sdk.createForm(name, formFields, {
        relays: relays.length ? relays : undefined,
        signer: signer ?? undefined,
      });
      const nkeys = encodeNKeys({
        secretKey: res.signingKeyHex,
        ...(res.viewKeyHex && { viewKey: res.viewKeyHex }),
      });
      onCreated(res.naddr, nkeys);
      setResult(res);
    } catch (err) {
      setError(`Failed to publish: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    if (creating) return;
    setFormName("Untitled form");
    setFields([emptyField()]);
    setError(null);
    setResult(null);
    onClose();
  };

  const hasOptions = (type: FieldType) =>
    type === "radioButton" || type === "checkboxes";

  const RelaySection = ({
    label,
    accepted,
    rejected,
    onRetry,
    retryingNow,
    event,
  }: {
    label: string;
    accepted: string[];
    rejected: string[];
    onRetry: () => void;
    retryingNow: boolean;
    event?: NostrEvent;
  }) => {
    const [expanded, setExpanded] = useState(rejected.length > 0);
    const total = accepted.length + rejected.length;
    const allGood = rejected.length === 0;

    return (
      <Box
        sx={{
          border: "1px solid",
          borderColor: allGood ? "success.light" : "warning.light",
          borderRadius: 2,
          overflow: "hidden",
          mb: 1.5,
          opacity: total === 0 ? 0.5 : 1,
        }}
      >
        <Box
          onClick={() => setExpanded((v) => !v)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2,
            py: 1.25,
            cursor: "pointer",
            bgcolor: allGood ? "success.50" : "warning.50",
            "&:hover": { filter: "brightness(0.97)" },
            userSelect: "none",
          }}
        >
          {allGood ? (
            <CheckCircleOutlineIcon sx={{ fontSize: 18, color: "success.main", flexShrink: 0 }} />
          ) : (
            <ErrorOutlineIcon sx={{ fontSize: 18, color: "warning.main", flexShrink: 0 }} />
          )}
          <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, fontSize: "0.85rem" }}>
            {label}
          </Typography>
          <Chip
            size="small"
            label={`${accepted.length} / ${total} accepted`}
            variant="outlined"
            color={allGood ? "success" : "warning"}
            sx={{ fontSize: "0.7rem", height: 22, fontWeight: 600 }}
          />
          {expanded
            ? <ExpandLessIcon sx={{ fontSize: 17, color: "text.secondary", flexShrink: 0 }} />
            : <ExpandMoreIcon sx={{ fontSize: 17, color: "text.secondary", flexShrink: 0 }} />
          }
        </Box>

        <Collapse in={expanded}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: "background.paper" }}>
            {accepted.map((r) => (
              <Box key={r} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                <CheckCircleOutlineIcon sx={{ fontSize: 13, color: "success.main", flexShrink: 0 }} />
                <Typography variant="caption" noWrap sx={{ color: "text.secondary", flex: 1, fontFamily: "monospace" }}>{r}</Typography>
              </Box>
            ))}
            {rejected.map((r) => (
              <Box key={r} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                <ErrorOutlineIcon sx={{ fontSize: 13, color: "error.main", flexShrink: 0 }} />
                <Typography variant="caption" noWrap sx={{ color: "text.secondary", flex: 1, fontFamily: "monospace" }}>{r}</Typography>
              </Box>
            ))}
            {rejected.length > 0 && event && (
              <Button
                size="small"
                startIcon={retryingNow ? <CircularProgress size={12} color="inherit" /> : <ReplayIcon sx={{ fontSize: 13 }} />}
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                disabled={retryingNow}
                color="warning"
                sx={{ mt: 0.75, textTransform: "none", fontSize: "0.75rem", p: "2px 10px" }}
              >
                Retry {rejected.length} failed {rejected.length === 1 ? "relay" : "relays"}
              </Button>
            )}
          </Box>
        </Collapse>
      </Box>
    );
  };

  if (result) {
    return (
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" } }}>
        <DialogContent sx={{ p: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <CheckCircleOutlineIcon sx={{ fontSize: 18, color: "success.main" }} />
            <Typography variant="caption" color="success.main" sx={{ fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: "0.65rem" }}>
              Form published
            </Typography>
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2.5 }}>
            {formName}
          </Typography>

          <RelaySection
            label="Form event"
            accepted={result.formRelays.accepted}
            rejected={result.formRelays.rejected}
            event={result.formEvent}
            retryingNow={retrying === "form"}
            onRetry={() => rebroadcast(result.formEvent, result.formRelays.rejected, "form")}
          />

          {result.myFormsRelays && (
            <RelaySection
              label="My forms list"
              accepted={result.myFormsRelays.accepted}
              rejected={result.myFormsRelays.rejected}
              event={result.myFormsEvent}
              retryingNow={retrying === "myForms"}
              onRetry={() => result.myFormsEvent && rebroadcast(result.myFormsEvent, result.myFormsRelays!.rejected, "myForms")}
            />
          )}

          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="contained" color="secondary" size="small" onClick={handleClose} sx={{ textTransform: "none", fontWeight: 600 }}>
              Done
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        {/* ── Header ─────────────────────────────────── */}
        <Box
          sx={{
            px: 3,
            pt: 3,
            pb: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.65rem" }}>
            Create form
          </Typography>
          <TextField
            inputRef={titleRef}
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            onFocus={(e) => e.target.select()}
            variant="standard"
            fullWidth
            disabled={creating}
            placeholder="Untitled form"
            InputProps={{
              disableUnderline: true,
              sx: { fontSize: "1.35rem", fontWeight: 700, mt: 0.5 },
            }}
          />
          {!signer && (
            <Chip
              label="Sign in to save form to your account"
              size="small"
              variant="outlined"
              color="warning"
              sx={{ mt: 1, fontSize: "0.7rem" }}
            />
          )}
        </Box>

        {/* ── Fields ─────────────────────────────────── */}
        <Box sx={{ px: 3, py: 2, maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1.5 }}>
          {fields.map((field, fi) => (
            <Box
              key={field.id}
              sx={{
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.default",
                overflow: "hidden",
                "&:hover .field-drag": { opacity: 0.4 },
              }}
            >
              {/* Field header */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, pt: 1.5, pb: hasOptions(field.type) ? 0.5 : 1.5 }}>
                <DragIndicatorIcon
                  className="field-drag"
                  sx={{ fontSize: 16, color: "text.disabled", opacity: 0, transition: "opacity 0.15s", cursor: "grab", flexShrink: 0 }}
                />

                <TextField
                  value={field.label}
                  onChange={(e) => patchField(fi, { label: e.target.value })}
                  placeholder={`Question ${fi + 1}`}
                  variant="standard"
                  size="small"
                  fullWidth
                  disabled={creating}
                  InputProps={{
                    disableUnderline: true,
                    sx: { fontWeight: 500 },
                  }}
                />

                <FormControl variant="standard" size="small" sx={{ minWidth: 130 }} disabled={creating}>
                  <Select
                    value={field.type}
                    onChange={(e) => patchField(fi, { type: e.target.value as FieldType })}
                    disableUnderline
                    sx={{ fontSize: "0.8rem", color: "text.secondary" }}
                  >
                    {FIELD_TYPES.map((t) => (
                      <MenuItem key={t.value} value={t.value} sx={{ fontSize: "0.85rem" }}>
                        <Box component="span" sx={{ mr: 0.75, fontFamily: "monospace", fontSize: "0.8rem", opacity: 0.6 }}>
                          {t.icon}
                        </Box>
                        {t.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Tooltip title="Remove question">
                  <span>
                    <IconButton
                      size="small"
                      disabled={fields.length === 1 || creating}
                      onClick={() => removeField(fi)}
                      sx={{ color: "text.disabled" }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>

              {/* Options */}
              {hasOptions(field.type) && (
                <Box sx={{ pl: 5, pr: 1.5, pb: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {field.options.map((opt, oi) => (
                    <Box key={oi} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Box sx={{ width: 14, height: 14, borderRadius: field.type === "checkboxes" ? "3px" : "50%", border: "1.5px solid", borderColor: "text.disabled", flexShrink: 0 }} />
                      <TextField
                        value={opt}
                        onChange={(e) => patchOption(fi, oi, e.target.value)}
                        variant="standard"
                        size="small"
                        disabled={creating}
                        placeholder={`Option ${oi + 1}`}
                        InputProps={{ disableUnderline: true, sx: { fontSize: "0.85rem" } }}
                        sx={{ flex: 1 }}
                      />
                      <IconButton
                        size="small"
                        disabled={field.options.length === 1 || creating}
                        onClick={() => removeOption(fi, oi)}
                        sx={{ opacity: 0.5, "&:hover": { opacity: 1 } }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  ))}
                  <Button
                    size="small"
                    startIcon={<AddIcon sx={{ fontSize: "14px !important" }} />}
                    onClick={() => addOption(fi)}
                    disabled={creating}
                    sx={{ alignSelf: "flex-start", color: "text.secondary", fontSize: "0.8rem", textTransform: "none", pl: 0 }}
                  >
                    Add option
                  </Button>
                </Box>
              )}
            </Box>
          ))}

          <Button
            startIcon={<AddIcon />}
            onClick={addField}
            disabled={creating}
            variant="outlined"
            size="small"
            sx={{ alignSelf: "flex-start", textTransform: "none", borderStyle: "dashed" }}
          >
            Add question
          </Button>
        </Box>

        {/* ── Footer ─────────────────────────────────── */}
        <Divider />
        <Box sx={{ px: 3, py: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {error ? (
            <Typography variant="caption" color="error" sx={{ flex: 1, mr: 2 }}>
              {error}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.disabled">
              Published to Nostr · kind 30168
            </Typography>
          )}
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button size="small" onClick={handleClose} disabled={creating} sx={{ textTransform: "none" }}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              color="secondary"
              onClick={handleCreate}
              disabled={creating}
              startIcon={creating ? <CircularProgress size={12} color="inherit" /> : null}
              sx={{ textTransform: "none", fontWeight: 600, px: 2 }}
            >
              {creating ? "Publishing…" : "Create & insert"}
            </Button>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
