import { useState, useRef, useEffect } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import {
  Box,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Tooltip,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { useDecryptedBlob, EncryptedFilePreview } from "../EncryptedFilePreview";
import type { EncryptedFileAttrs } from "../EncryptedFilePreview";
import { useBlossomServers } from "../../../contexts/BlossomContext";
import { deleteFromBlossom } from "../../../blossom/client";

// ── Resize handle ───────────────────────────────────────────

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  visible: boolean;
}

function ResizeHandle({ onMouseDown, onTouchStart, visible }: ResizeHandleProps) {
  return (
    <Box
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      sx={{
        position: "absolute",
        bottom: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: "3px 0 3px 0",
        bgcolor: "secondary.main",
        cursor: "nwse-resize",
        touchAction: "none",
        opacity: visible ? 0.75 : 0,
        transition: "opacity 0.15s",
        "&:hover": { opacity: 1 },
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(255,255,255,0.6) 2px, rgba(255,255,255,0.6) 3px)",
      }}
    />
  );
}

// ── Node view rendered inside TipTap (edit mode) ────────────

function EncryptedFileNodeView({ node, editor, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const { src, decryptionKey, decryptionNonce, mimeType, filename, x, width } =
    node.attrs as EncryptedFileAttrs & { x?: string; width?: number | null };

  const { servers: blossomServers } = useBlossomServers();
  const { blobUrl, loading, error, renderAs, mimeMismatch } = useDecryptedBlob({
    src, decryptionKey, decryptionNonce, mimeType, filename,
  });

  const [hovered, setHovered] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Live width during drag (avoids committing every mousemove to the doc)
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const isEditable = editor.isEditable;
  const isImage = renderAs === "image";
  const displayWidth = liveWidth ?? width ?? null;
  // Show controls on hover (desktop) OR when the node is selected (tap on mobile)
  const showControls = hovered || selected;

  // Clear liveWidth once TipTap has committed the new width to node.attrs.
  // We can't clear it in the drag-end handler because updateAttributes is
  // asynchronous — node.attrs.width hasn't updated yet at that point, so
  // clearing liveWidth immediately would snap the image back to its old size.
  useEffect(() => {
    setLiveWidth(null);
  }, [width]);

  // ── Delete ──────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      if (x) await deleteFromBlossom(blossomServers, x).catch(console.warn);
      deleteNode();
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  // ── Resize ──────────────────────────────────────────────
  const startResize = (startX: number) => {
    const startWidth = imgRef.current?.offsetWidth ?? (width ?? 400);

    const onMouseMove = (e: MouseEvent) => {
      setLiveWidth(Math.max(80, startWidth + (e.clientX - startX)));
    };
    const onMouseUp = (e: MouseEvent) => {
      updateAttributes({ width: Math.max(80, startWidth + (e.clientX - startX)) });
      // liveWidth cleared by the useEffect watching node.attrs.width
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startResize(e.clientX);
  };

  const handleResizeTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const startX = e.touches[0].clientX;
    const startWidth = imgRef.current?.offsetWidth ?? (width ?? 400);

    const onTouchMove = (e: TouchEvent) => {
      setLiveWidth(Math.max(80, startWidth + (e.touches[0].clientX - startX)));
    };
    const onTouchEnd = (e: TouchEvent) => {
      updateAttributes({ width: Math.max(80, startWidth + (e.changedTouches[0].clientX - startX)) });
      // liveWidth cleared by the useEffect watching node.attrs.width
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
  };

  return (
    <NodeViewWrapper>
      <Box
        sx={{ my: 1, position: "relative", display: "inline-block", maxWidth: "100%" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* ── Loading / error / mismatch states ── */}
        {(loading || error || mimeMismatch) && (
          <EncryptedFilePreview
            src={src}
            decryptionKey={decryptionKey}
            decryptionNonce={decryptionNonce}
            mimeType={mimeType}
            filename={filename}
            width={displayWidth}
          />
        )}

        {/* ── Image ── */}
        {blobUrl && isImage && (
          <img
            ref={imgRef}
            src={blobUrl}
            alt={filename}
            style={{
              width: displayWidth ? `${displayWidth}px` : "100%",
              maxWidth: "100%",
              borderRadius: 8,
              display: "block",
              userSelect: "none",
              outline: showControls && isEditable ? "2px solid rgba(128,128,128,0.3)" : "none",
            }}
            draggable={false}
          />
        )}

        {/* ── Video ── */}
        {blobUrl && renderAs === "video" && (
          <EncryptedFilePreview
            src={src}
            decryptionKey={decryptionKey}
            decryptionNonce={decryptionNonce}
            mimeType={mimeType}
            filename={filename}
          />
        )}

        {/* ── File download ── */}
        {blobUrl && renderAs === "file" && (
          <EncryptedFilePreview
            src={src}
            decryptionKey={decryptionKey}
            decryptionNonce={decryptionNonce}
            mimeType={mimeType}
            filename={filename}
          />
        )}

        {/* ── Edit-mode controls ── */}
        {isEditable && (
          <>
            {/* Delete button */}
            <Tooltip title="Remove file">
              <IconButton
                size="small"
                onClick={() => setConfirmOpen(true)}
                sx={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  bgcolor: "background.paper",
                  boxShadow: 1,
                  opacity: showControls ? 1 : 0,
                  transition: "opacity 0.15s",
                  "&:hover": { bgcolor: "error.light", color: "error.contrastText" },
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            {/* Resize handle — only when an image has loaded */}
            {isImage && blobUrl && (
              <ResizeHandle
                onMouseDown={handleResizeMouseDown}
                onTouchStart={handleResizeTouchStart}
                visible={showControls}
              />
            )}
          </>
        )}
      </Box>

      {/* ── Confirm delete dialog ── */}
      <Dialog open={confirmOpen} onClose={() => !deleting && setConfirmOpen(false)} maxWidth="xs">
        <DialogTitle>Remove file?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            <strong>{filename}</strong> will be deleted from the blossom server
            and removed from this document. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </NodeViewWrapper>
  );
}

// ── TipTap node definition ──────────────────────────────────

export const EncryptedFileNode = Node.create({
  name: "encryptedFile",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      markdown: {
        serialize(state: Record<string, (...args: unknown[]) => unknown>, node: { attrs: Record<string, string | number | null> }) {
          const { src, decryptionKey, decryptionNonce, mimeType, filename, x, width } =
            node.attrs;
          state.write(
            `<encrypted-file` +
              ` data-src="${src || ""}"` +
              ` data-key="${decryptionKey || ""}"` +
              ` data-nonce="${decryptionNonce || ""}"` +
              ` data-mime="${mimeType || ""}"` +
              ` data-filename="${encodeURIComponent(String(filename || "file"))}"` +
              ` data-x="${x || ""}"` +
              (width ? ` data-width="${width}"` : "") +
              `></encrypted-file>`,
          );
          (state as unknown as { ensureNewLine: () => void }).ensureNewLine();
        },
      },
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-src"),
        renderHTML: (attrs) => ({ "data-src": attrs.src }),
      },
      decryptionKey: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-key"),
        renderHTML: (attrs) => ({ "data-key": attrs.decryptionKey }),
      },
      decryptionNonce: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-nonce"),
        renderHTML: (attrs) => ({ "data-nonce": attrs.decryptionNonce }),
      },
      mimeType: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-mime"),
        renderHTML: (attrs) => ({ "data-mime": attrs.mimeType }),
      },
      filename: {
        default: "file",
        parseHTML: (el) =>
          decodeURIComponent(el.getAttribute("data-filename") || "file"),
        renderHTML: (attrs) => ({
          "data-filename": encodeURIComponent(attrs.filename || "file"),
        }),
      },
      x: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-x"),
        renderHTML: (attrs) => ({ "data-x": attrs.x }),
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-width");
          return v ? Number(v) : null;
        },
        renderHTML: (attrs) =>
          attrs.width ? { "data-width": String(attrs.width) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "encrypted-file" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["encrypted-file", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EncryptedFileNodeView);
  },
});
