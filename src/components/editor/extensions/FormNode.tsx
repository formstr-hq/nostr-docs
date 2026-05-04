import { useState, useEffect, useMemo } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import {
  Box,
  IconButton,
  Tooltip,
  Typography,
  CircularProgress,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import BarChartIcon from "@mui/icons-material/BarChart";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { FormstrSDK, decodeNKeys, encodeNKeys } from "@formstr/sdk";
import { useMyForms } from "../../../contexts/MyFormsContext";
import type { NormalizedForm } from "@formstr/sdk";
import { FormFiller } from "../FormFiller";

const sdk = new FormstrSDK();

// ── Shared card UI — used in both edit and preview modes ─────

export function FormNodeCard({
  naddr,
  nkeys,
  onDelete,
  isEditable = false,
}: {
  naddr: string;
  nkeys?: string;
  onDelete?: () => void;
  isEditable?: boolean;
}) {
  const { forms } = useMyForms();
  const [form, setForm] = useState<NormalizedForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const effectiveNkeys = useMemo(() => {
    if (nkeys && decodeNKeys(nkeys).secretKey) return nkeys;
    return forms.find(f => f.naddr === naddr)?.nkeys ?? nkeys;
  }, [naddr, nkeys, forms]);

  const fieldCount = form ? Object.keys(form.fields).length : 0;
  const hasSecretKey = !!effectiveNkeys && !!decodeNKeys(effectiveNkeys).secretKey;

  useEffect(() => {
    if (!naddr) { setLoading(false); setError(true); return; }
    let cancelled = false;
    sdk.fetchForm(naddr, nkeys)
      .then((f) => { if (!cancelled) setForm(f); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [naddr]);

  return (
    <Box
      sx={{
        my: 1,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
        userSelect: "none",
        "&:hover .form-node-actions": { opacity: 1 },
      }}
    >
      <Box sx={{ height: 3, bgcolor: "secondary.main" }} />

      <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box
          sx={{
            fontSize: 22,
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 1,
            bgcolor: "secondary.main",
            color: "secondary.contrastText",
            flexShrink: 0,
          }}
        >
          📋
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {loading && <CircularProgress size={14} />}

          {!loading && !error && form && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                {form.name || "Untitled Form"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {fieldCount} {fieldCount === 1 ? "field" : "fields"} · Nostr form
              </Typography>
            </>
          )}

          {!loading && error && (
            <Typography variant="body2" color="text.secondary">
              Form · {naddr.slice(0, 16)}…
            </Typography>
          )}
        </Box>

        <Box
          className="form-node-actions"
          sx={{ display: "flex", gap: 0.5, opacity: 0, transition: "opacity 0.15s" }}
        >
          {hasSecretKey && (
            <Tooltip title="View responses">
              <IconButton
                size="small"
                onClick={() => window.open(`https://formstr.app/s/${naddr}#${effectiveNkeys}`, "_blank", "noopener")}
              >
                <BarChartIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title="Open form">
            <IconButton
              size="small"
              onClick={() => window.open(`https://formstr.app/f/${naddr}`, "_blank", "noopener")}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {isEditable && onDelete && (
            <Tooltip title="Remove">
              <IconButton
                size="small"
                onClick={onDelete}
                sx={{ "&:hover": { bgcolor: "error.light", color: "error.contrastText" } }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ── TipTap node view (wraps the full form + floating actions) ──

function FormNodeView({ node, editor, deleteNode, selected }: NodeViewProps) {
  const { naddr, nkeys } = node.attrs as { naddr: string; nkeys?: string };
  const { forms } = useMyForms();
  const [hovered, setHovered] = useState(false);
  const showActions = hovered || selected;

  const effectiveNkeys = useMemo(() => {
    if (nkeys && decodeNKeys(nkeys).secretKey) return nkeys;
    return forms.find(f => f.naddr === naddr)?.nkeys ?? nkeys;
  }, [naddr, nkeys, forms]);

  const hasSecretKey = !!effectiveNkeys && !!decodeNKeys(effectiveNkeys).secretKey;
  const nkeysHash = effectiveNkeys ? `#${effectiveNkeys}` : "";

  return (
    <NodeViewWrapper data-drag-handle>
      <Box
        contentEditable={false}
        sx={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <FormFiller naddr={naddr} nkeys={nkeys} />

        {editor.isEditable && (
          <Box
            sx={{
              position: "absolute",
              top: 8,
              right: 8,
              display: "flex",
              gap: 0.5,
              opacity: showActions ? 1 : 0,
              // Always visible on touch screens
              "@media (hover: none)": { opacity: 1 },
              transition: "opacity 0.15s",
            }}
          >
            {hasSecretKey && (
              <Tooltip title="View responses">
                <IconButton
                  size="small"
                  onClick={() => window.open(`https://formstr.app/s/${naddr}${nkeysHash}`, "_blank", "noopener")}
                  sx={{ bgcolor: "background.paper", boxShadow: 1 }}
                >
                  <BarChartIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Edit form">
              <IconButton
                size="small"
                onClick={() => window.open(`https://formstr.app/edit/${naddr}${nkeysHash}`, "_blank", "noopener")}
                sx={{ bgcolor: "background.paper", boxShadow: 1 }}
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Remove">
              <IconButton
                size="small"
                onClick={deleteNode}
                sx={{ bgcolor: "background.paper", boxShadow: 1, "&:hover": { bgcolor: "error.light", color: "error.contrastText" } }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </NodeViewWrapper>
  );
}

// ── TipTap node definition ───────────────────────────────────

export const FormNode = Node.create({
  name: "nostrForm",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addStorage() {
    return {
      markdown: {
        serialize(
          state: Record<string, (...args: unknown[]) => unknown>,
          node: { attrs: Record<string, string | null> },
        ) {
          const { naddr, nkeys } = node.attrs;
          let safeNkeys: string | null = null;
          if (nkeys) {
            const { secretKey: _sk, ...rest } = decodeNKeys(nkeys);
            if (Object.keys(rest).length) safeNkeys = encodeNKeys(rest);
          }
          (state as unknown as { write: (s: string) => void }).write(
            `<nostr-form data-naddr="${naddr || ""}"${safeNkeys ? ` data-nkeys="${safeNkeys}"` : ""}></nostr-form>`,
          );
          (state as unknown as { ensureNewLine: () => void }).ensureNewLine();
        },
      },
    };
  },

  addAttributes() {
    return {
      naddr: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-naddr"),
        renderHTML: (attrs) => ({ "data-naddr": attrs.naddr }),
      },
      nkeys: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-nkeys"),
        renderHTML: (attrs) => {
          if (!attrs.nkeys) return {};
          const { secretKey: _sk, ...rest } = decodeNKeys(attrs.nkeys);
          if (!Object.keys(rest).length) return {};
          return { "data-nkeys": encodeNKeys(rest) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "nostr-form" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["nostr-form", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormNodeView);
  },
});
