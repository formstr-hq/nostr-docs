import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import {
  MAX_FONT_SIZE_PT,
  MAX_LINE_HEIGHT,
  MAX_MARGIN_IN,
  MIN_FONT_SIZE_PT,
  MIN_LINE_HEIGHT,
  MIN_MARGIN_IN,
  PAGE_SIZES,
  normalizePageLayout,
  type BlockStyle,
  type DocumentStyles,
  type PageHeaderFooter,
  type PageLayout,
  type PageMargin,
  type PageSize,
  type TextAlign,
} from "../../lib/docLayout";

const MARGIN_FIELDS: { key: PageMargin; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "right", label: "Right" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
];

const SLOT_FIELDS: { key: keyof PageHeaderFooter; label: string }[] = [
  { key: "left", label: "Left" },
  { key: "center", label: "Center" },
  { key: "right", label: "Right" },
];

const STYLE_ROWS: { key: keyof DocumentStyles; label: string }[] = [
  { key: "h1", label: "Heading 1" },
  { key: "h2", label: "Heading 2" },
  { key: "h3", label: "Heading 3" },
  { key: "paragraph", label: "Body text" },
];

const ALIGN_OPTIONS: { value: TextAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

const WEIGHT_OPTIONS = [
  { value: 400, label: "Normal" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extra bold" },
];

function SlotEditor({
  title,
  value,
  onChange,
}: {
  title: string;
  value: PageHeaderFooter | undefined;
  onChange: (next: PageHeaderFooter | undefined) => void;
}) {
  const update = (key: keyof PageHeaderFooter, text: string) => {
    const next: PageHeaderFooter = { ...(value ?? {}), [key]: text };
    onChange(normalizeSlots(next));
  };

  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {title}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1, mt: 0.75 }}>
        {SLOT_FIELDS.map(({ key, label }) => (
          <TextField
            key={key}
            size="small"
            label={`${title} ${label.toLowerCase()}`}
            value={value?.[key] ?? ""}
            onChange={(event) => update(key, event.target.value)}
            inputProps={{ maxLength: 120 }}
          />
        ))}
      </Box>
    </Box>
  );
}

function normalizeSlots(value: PageHeaderFooter): PageHeaderFooter | undefined {
  const next: PageHeaderFooter = {};
  for (const { key } of SLOT_FIELDS) {
    const text = value[key]?.trim();
    if (text) next[key] = text;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function PageSetupDialog({
  open,
  layout,
  onClose,
  onSave,
}: {
  open: boolean;
  layout: PageLayout;
  onClose: () => void;
  onSave: (layout: PageLayout) => void;
}) {
  const [draft, setDraft] = useState<PageLayout>(layout);

  useEffect(() => {
    if (open) setDraft(normalizePageLayout(layout));
  }, [open, layout]);

  const setMargin = (key: PageMargin, raw: string) => {
    const value = Number(raw);
    setDraft((current) => ({
      ...current,
      margins: {
        ...current.margins,
        [key]: Number.isFinite(value) ? value : current.margins[key],
      },
    }));
  };

  const setStyle = (key: keyof DocumentStyles, patch: Partial<BlockStyle>) => {
    setDraft((current) => ({
      ...current,
      styles: {
        ...current.styles,
        [key]: { ...(current.styles?.[key] ?? {}), ...patch },
      },
    }));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Page setup</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1.4fr 1fr" }, gap: 1.25 }}>
          <TextField
            select
            size="small"
            label="Canvas"
            value={draft.canvas}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                canvas: event.target.value === "page" ? "page" : "notes",
              }))
            }
            helperText="Page settings apply to Page canvas and exports"
          >
            <MenuItem value="notes">Notes</MenuItem>
            <MenuItem value="page">Page</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Page size"
            value={draft.pageSize}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                pageSize: event.target.value as PageSize,
              }))
            }
          >
            {(Object.keys(PAGE_SIZES) as PageSize[]).map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Orientation"
            value={draft.orientation}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                orientation: event.target.value as PageLayout["orientation"],
              }))
            }
          >
            <MenuItem value="portrait">Portrait</MenuItem>
            <MenuItem value="landscape">Landscape</MenuItem>
          </TextField>
        </Box>

        <Box>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Margins (inches)
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1, mt: 0.75 }}>
            {MARGIN_FIELDS.map(({ key, label }) => (
              <TextField
                key={key}
                size="small"
                type="number"
                label={label}
                value={draft.margins[key]}
                onChange={(event) => setMargin(key, event.target.value)}
                inputProps={{ min: MIN_MARGIN_IN, max: MAX_MARGIN_IN, step: 0.05 }}
              />
            ))}
          </Box>
        </Box>

        <Divider />

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1.5fr 1fr 1fr" }, gap: 1.25 }}>
          <TextField
            size="small"
            label="Base font"
            value={draft.fontFamily}
            onChange={(event) =>
              setDraft((current) => ({ ...current, fontFamily: event.target.value }))
            }
            helperText="Any installed or uploaded font family"
          />
          <TextField
            size="small"
            type="number"
            label="Size (pt)"
            value={draft.fontSizePt}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                fontSizePt: Number(event.target.value),
              }))
            }
            inputProps={{ min: MIN_FONT_SIZE_PT, max: MAX_FONT_SIZE_PT, step: 0.5 }}
          />
          <TextField
            size="small"
            type="number"
            label="Line height"
            value={draft.lineHeight}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                lineHeight: Number(event.target.value),
              }))
            }
            inputProps={{ min: MIN_LINE_HEIGHT, max: MAX_LINE_HEIGHT, step: 0.05 }}
          />
        </Box>

        <Divider />

        <Box>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Text styles
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 0.75 }}>
            {STYLE_ROWS.map(({ key, label }) => {
              const style = draft.styles?.[key] ?? {};
              return (
                <Box
                  key={key}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr 1fr", sm: "1.1fr 1fr 0.8fr 1fr auto" },
                    gap: 1,
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.8rem" }}>
                    {label}
                  </Typography>
                  <TextField
                    select
                    size="small"
                    label="Align"
                    value={style.align ?? "left"}
                    onChange={(event) =>
                      setStyle(key, { align: event.target.value as TextAlign })
                    }
                    inputProps={{ "aria-label": `${label} alignment` }}
                  >
                    {ALIGN_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    type="number"
                    label="Size (pt)"
                    value={style.fontSizePt ?? 11}
                    onChange={(event) =>
                      setStyle(key, { fontSizePt: Number(event.target.value) })
                    }
                    inputProps={{
                      min: MIN_FONT_SIZE_PT,
                      max: MAX_FONT_SIZE_PT,
                      step: 0.5,
                      "aria-label": `${label} size`,
                    }}
                  />
                  <TextField
                    select
                    size="small"
                    label="Weight"
                    value={style.fontWeight ?? 400}
                    onChange={(event) =>
                      setStyle(key, { fontWeight: Number(event.target.value) })
                    }
                    inputProps={{ "aria-label": `${label} weight` }}
                  >
                    {WEIGHT_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {key === "paragraph" ? (
                    <Box />
                  ) : (
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={style.textTransform === "uppercase"}
                          onChange={(event) =>
                            setStyle(key, {
                              textTransform: event.target.checked
                                ? "uppercase"
                                : "none",
                            })
                          }
                          inputProps={{
                            "aria-label": `${label} uppercase`,
                          }}
                        />
                      }
                      label="Caps"
                      sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
                    />
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>

        <Divider />

        <SlotEditor
          title="Header"
          value={draft.header}
          onChange={(header) => setDraft((current) => ({ ...current, header }))}
        />
        <SlotEditor
          title="Footer"
          value={draft.footer}
          onChange={(footer) => setDraft((current) => ({ ...current, footer }))}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => onSave(normalizePageLayout(draft))}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
