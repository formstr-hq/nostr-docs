import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  TextField,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormControl,
  FormLabel,
  FormGroup,
  Checkbox,
  Select,
  MenuItem,
  Button,
  CircularProgress,
  Alert,
  Divider,
  InputLabel,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { FormstrSDK } from "@formstr/sdk";
import type { NormalizedForm, NormalizedField, SectionBlock }
  from "@formstr/sdk";
const sdk = new FormstrSDK();

// ── Individual field renderers ────────────────────────────────

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: NormalizedField;
  value: string | string[];
  onChange: (val: string | string[]) => void;
  disabled: boolean;
}) {
  const strVal = typeof value === "string" ? value : "";
  const arrVal = Array.isArray(value) ? value : [];

  switch (field.type) {
    case "shortText":
      return (
        <TextField
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          size="small"
          fullWidth
          disabled={disabled}
          required={field.config?.required}
          placeholder="Your answer"
        />
      );

    case "paragraph":
      return (
        <TextField
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={3}
          disabled={disabled}
          required={field.config?.required}
          placeholder="Your answer"
        />
      );

    case "number":
      return (
        <TextField
          type="number"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          size="small"
          disabled={disabled}
          required={field.config?.required}
          placeholder="0"
          sx={{ width: 200 }}
        />
      );

    case "date":
      return (
        <TextField
          type="date"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          size="small"
          disabled={disabled}
          required={field.config?.required}
          InputLabelProps={{ shrink: true }}
        />
      );

    case "time":
      return (
        <TextField
          type="time"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          size="small"
          disabled={disabled}
          required={field.config?.required}
          InputLabelProps={{ shrink: true }}
        />
      );

    case "radioButton":
      return (
        <RadioGroup
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options?.map((opt) => (
            <FormControlLabel
              key={opt.id}
              value={opt.id}
              control={<Radio size="small" disabled={disabled} />}
              label={opt.labelHtml}
            />
          ))}
        </RadioGroup>
      );

    case "checkboxes":
      return (
        <FormGroup>
          {field.options?.map((opt) => (
            <FormControlLabel
              key={opt.id}
              control={
                <Checkbox
                  size="small"
                  disabled={disabled}
                  checked={arrVal.includes(opt.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onChange([...arrVal, opt.id]);
                    } else {
                      onChange(arrVal.filter((v) => v !== opt.id));
                    }
                  }}
                />
              }
              label={opt.labelHtml}
            />
          ))}
        </FormGroup>
      );

    case "dropdown":
      return (
        <FormControl size="small" sx={{ minWidth: 220 }} disabled={disabled}>
          <InputLabel>Select…</InputLabel>
          <Select
            value={strVal}
            label="Select…"
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((opt) => (
              <MenuItem key={opt.id} value={opt.id}>
                {opt.labelHtml}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );

    case "label":
      return null;

    default:
      return (
        <TextField
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          size="small"
          fullWidth
          disabled={disabled}
          placeholder="Your answer"
        />
      );
  }
}

// ── Main form filler ──────────────────────────────────────────


export function FormFiller({
  naddr,
  nkeys
}: {
  naddr: string;
  nkeys?: string;
}) {
  const [form, setForm] = useState<NormalizedForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | false>(false);
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!naddr) { setLoading(false); setFetchError("Invalid form address."); return; }

    let cancelled = false;
    const RETRY_DELAYS = [0, 1500, 3000]; // immediate, then 1.5s, then 3s

    const attempt = async (retriesLeft: number[]): Promise<void> => {
      try {
        const f = await sdk.fetchForm(naddr, nkeys);
        if (cancelled) return;
        setForm(f);
        const initial: Record<string, string | string[]> = {};
        Object.values(f.fields).forEach((field) => {
          initial[field.id] = field.type === "checkboxes" ? [] : "";
        });
        setValues(initial);
        setFetchError(false);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[FormFiller] fetchForm failed:", msg);
        if (retriesLeft.length > 0) {
          const delay = retriesLeft[0];
          await new Promise((res) => setTimeout(res, delay));
          if (!cancelled) await attempt(retriesLeft.slice(1));
        } else {
          setFetchError(msg);
        }
      } finally {
        if (!cancelled && retriesLeft.length === 0) setLoading(false);
      }
    };

    // Run, and set loading=false once the attempt chain settles
    attempt(RETRY_DELAYS)
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [naddr, nkeys]);

  const handleSubmit = async () => {
    if (!form) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await sdk.submit(form, values);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 2 }}>
        <CircularProgress size={16} />
        <Typography variant="caption" color="text.secondary">Loading form…</Typography>
      </Box>
    );
  }

  if (fetchError || !form) {
    return (
      <Alert severity="warning" sx={{ my: 1 }}>
        Could not load this form from the relay.
      </Alert>
    );
  }

  // ── Submitted ──────────────────────────────────────────────
  if (submitted) {
    return (
      <Box
        sx={{
          my: 1,
          borderRadius: 2,
          border: "1px solid",
          borderColor: "success.light",
          bgcolor: "background.paper",
          overflow: "hidden",
        }}
      >
        <Box sx={{ height: 3, bgcolor: "success.main" }} />
        <Box sx={{ px: 3, py: 3, display: "flex", alignItems: "center", gap: 2 }}>
          <CheckCircleOutlineIcon color="success" />
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Response submitted
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Your answer has been recorded on Nostr.
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Render form ────────────────────────────────────────────
  const introBlock = form.blocks?.find((b) => b.type === "intro");
  const sectionBlocks = (form.blocks?.filter((b) => b.type === "section") ?? []) as SectionBlock[];

  return (
    <Box
      sx={{
        my: 1,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      {/* Top stripe */}
      <Box sx={{ height: 3, bgcolor: "secondary.main" }} />

      <Box sx={{ px: { xs: 2, sm: 3 }, py: 3 }}>
        {/* Intro block */}
        {introBlock && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
              {introBlock.title || form.name}
            </Typography>
            {introBlock.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {introBlock.description}
              </Typography>
            )}
          </Box>
        )}

        {/* Sections + fields */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          {sectionBlocks.map((section) => (
            <Box key={section.id}>
              {section.title && (
                <>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
                    {section.title}
                  </Typography>
                </>
              )}

              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {section.questionIds.map((fieldId) => {
                  const field = form.fields[fieldId];
                  if (!field) return null;

                  if (field.type === "label") {
                    return (
                      <Typography key={fieldId} variant="body2" color="text.secondary">
                        {field.labelHtml}
                      </Typography>
                    );
                  }

                  return (
                    <FormControl key={fieldId} fullWidth>
                      <FormLabel
                        sx={{
                          mb: 0.75,
                          fontWeight: 500,
                          fontSize: "0.9rem",
                          color: "text.primary",
                          "&.Mui-focused": { color: "text.primary" },
                        }}
                      >
                        {field.labelHtml}
                        {field.config?.required && (
                          <Box component="span" sx={{ color: "error.main", ml: 0.5 }}>*</Box>
                        )}
                      </FormLabel>
                      <FieldInput
                        field={field}
                        value={values[fieldId] ?? (field.type === "checkboxes" ? [] : "")}
                        onChange={(val) => setValues((prev) => ({ ...prev, [fieldId]: val }))}
                        disabled={submitting}
                      />
                    </FormControl>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>

        {/* Submit */}
        <Box sx={{ mt: 3, display: "flex", alignItems: "center", gap: 2 }}>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleSubmit}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : null}
            sx={{ textTransform: "none", fontWeight: 600, px: 3 }}
          >
            {submitting ? "Submitting…" : "Submit"}
          </Button>
          {submitError && (
            <Typography variant="caption" color="error">
              {submitError}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
