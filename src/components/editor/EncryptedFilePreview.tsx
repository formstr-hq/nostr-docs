import { useState, useEffect } from "react";
import { Box, CircularProgress, Typography, Button } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import BrokenImageIcon from "@mui/icons-material/BrokenImage";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { decryptFile } from "../../utils/fileEncryption";

export interface EncryptedFileAttrs {
  src: string;
  decryptionKey: string;
  decryptionNonce: string;
  mimeType: string;
  filename: string;
  width?: number | null; // pixel width; null/undefined = 100%
}

// Module-level cache: blossom URL → { blob object URL, verified render type }
// Avoids re-downloading, re-decrypting, and re-probing on every re-render/mode switch.
const blobCache = new Map<string, { url: string; renderAs: RenderAs; mimeMismatch: boolean }>();

type RenderAs = "image" | "video" | "file";

// Verify an image blob URL actually decodes as a valid image.
function probeImage(blobUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = blobUrl;
  });
}

// Verify a video blob URL can be played by the browser.
function probeVideo(blobUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.oncanplay = () => { video.src = ""; resolve(true); };
    video.onerror = () => resolve(false);
    video.preload = "metadata";
    video.src = blobUrl;
  });
}

export function useDecryptedBlob({ src, decryptionKey, decryptionNonce, mimeType }: EncryptedFileAttrs) {
  const cached = blobCache.get(src);
  const [blobUrl, setBlobUrl] = useState<string | null>(() => cached?.url ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  // What the content actually is after browser verification (may differ from claimed mimeType)
  const [renderAs, setRenderAs] = useState<RenderAs>(() => cached?.renderAs ?? "file");
  const [mimeMismatch, setMimeMismatch] = useState(() => cached?.mimeMismatch ?? false);

  useEffect(() => {
    if (blobCache.has(src)) {
      const c = blobCache.get(src)!;
      setBlobUrl(c.url);
      setRenderAs(c.renderAs);
      setMimeMismatch(c.mimeMismatch);
      setLoading(false);
      return;
    }

    // Validate URL scheme before fetching
    let url: URL;
    try {
      url = new URL(src);
    } catch {
      setError("Invalid file URL");
      setLoading(false);
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      setError("Unsupported URL scheme");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const encryptedData = await res.arrayBuffer();
        const decrypted = await decryptFile(encryptedData, decryptionKey, decryptionNonce);
        if (cancelled) return;

        // Use a neutral content-type for the blob — we verify the actual
        // format ourselves rather than trusting the attacker-supplied mimeType.
        const blob = new Blob([decrypted], { type: "application/octet-stream" });
        const objectUrl = URL.createObjectURL(blob);

        // Verify the decrypted content actually matches the claimed MIME type
        // before deciding how to render it. This prevents a malicious editor
        // from labelling an EXE as image/png to disguise it.
        const claimedImage = mimeType?.startsWith("image/");
        const claimedVideo = mimeType?.startsWith("video/");

        let actualRenderAs: RenderAs = "file";
        let mismatch = false;

        if (claimedImage) {
          const valid = await probeImage(objectUrl);
          if (valid) {
            actualRenderAs = "image";
          } else {
            actualRenderAs = "file";
            mismatch = true; // claimed image but content is not a valid image
          }
        } else if (claimedVideo) {
          const valid = await probeVideo(objectUrl);
          if (valid) {
            actualRenderAs = "video";
          } else {
            actualRenderAs = "file";
            mismatch = true;
          }
        }

        if (cancelled) { URL.revokeObjectURL(objectUrl); return; }

        blobCache.set(src, { url: objectUrl, renderAs: actualRenderAs, mimeMismatch: mismatch });
        setBlobUrl(objectUrl);
        setRenderAs(actualRenderAs);
        setMimeMismatch(mismatch);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [src, decryptionKey, decryptionNonce, mimeType]);

  return { blobUrl, loading, error, renderAs, mimeMismatch };
}

export function EncryptedFilePreview(attrs: EncryptedFileAttrs) {
  const { filename, mimeType, width } = attrs;
  const { blobUrl, loading, error, renderAs, mimeMismatch } = useDecryptedBlob(attrs);

  return (
    <Box sx={{ display: "inline-block", verticalAlign: "bottom", maxWidth: "100%" }}>
      {loading && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">
            Decrypting {filename}…
          </Typography>
        </Box>
      )}

      {error && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, color: "error.main" }}>
          <BrokenImageIcon fontSize="small" />
          <Typography variant="caption">
            {filename}: {error}
          </Typography>
        </Box>
      )}

      {/* MIME type mismatch warning — claimed image/video but content doesn't match */}
      {mimeMismatch && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, color: "warning.main" }}>
          <WarningAmberIcon fontSize="small" />
          <Typography variant="caption">
            File was labelled as <strong>{mimeType}</strong> but content does not match. Showing as download instead.
          </Typography>
        </Box>
      )}

      {blobUrl && renderAs === "image" && (
        <img
          src={blobUrl}
          alt={filename}
          style={{
            width: width ? `${width}px` : "100%",
            maxWidth: "100%",
            borderRadius: 8,
            display: "block",
          }}
        />
      )}

      {blobUrl && renderAs === "video" && (
        <video
          src={blobUrl}
          controls
          style={{
            width: width ? `${width}px` : "100%",
            maxWidth: "100%",
            borderRadius: 8,
            display: "block",
          }}
        />
      )}

      {blobUrl && renderAs === "file" && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          href={blobUrl}
          download={filename}
          component="a"
          title={`Type: ${mimeType || "unknown"}`}
        >
          {filename}
          {mimeType && (
            <Typography
              component="span"
              variant="caption"
              sx={{ ml: 1, opacity: 0.6, fontWeight: 400 }}
            >
              ({mimeType})
            </Typography>
          )}
        </Button>
      )}
    </Box>
  );
}
