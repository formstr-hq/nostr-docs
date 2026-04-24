import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Typography,
} from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import { signerManager } from "../signer";
import { decryptFormstrDriveFile } from "../utils/formstrDriveDecrypt";

type PreviewMode = "text" | "image" | "video" | "pdf" | "docx" | "binary";

interface DriveImportPayload {
  server: string;
  hash: string;
  encryptionKey: string;
  type?: string;
  name?: string;
}

function parsePayload(search: string): DriveImportPayload | null {
  const params = new URLSearchParams(search);
  const packed = params.get("payload");
  if (packed) {
    try {
      const decoded = JSON.parse(atob(packed));
      if (decoded?.server && decoded?.hash && decoded?.encryptionKey) {
        return decoded as DriveImportPayload;
      }
    } catch {
      return null;
    }
  }

  const server = params.get("server");
  const hash = params.get("hash");
  const encryptionKey = params.get("encryptionKey") || params.get("key");
  if (!server || !hash || !encryptionKey) return null;

  return {
    server,
    hash,
    encryptionKey,
    type: params.get("type") || undefined,
    name: params.get("name") || undefined,
  };
}

function getMode(fileType: string, filename: string): PreviewMode {
  const t = fileType.toLowerCase();
  const name = filename.toLowerCase();

  if (t.startsWith("text/") || t === "application/json" || t === "text/markdown") {
    return "text";
  }
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t === "application/pdf") return "pdf";
  if (
    t === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    return "docx";
  }
  return "binary";
}

async function createGetAuthHeader(hash: string): Promise<string | null> {
  try {
    const signer = await signerManager.getSigner();
    const pubkey = await signer.getPublicKey();
    const now = Math.floor(Date.now() / 1000);
    const eventTemplate = {
      kind: 24242,
      pubkey,
      created_at: now,
      content: `Get ${hash}`,
      tags: [
        ["t", "get"],
        ["expiration", String(now + 60)],
      ],
    };
    const signed = await signer.signEvent(eventTemplate);
    return `Nostr ${btoa(JSON.stringify(signed))}`;
  } catch {
    return null;
  }
}

export default function DriveImportPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const payload = useMemo(() => parsePayload(location.search), [location.search]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  const filename = payload?.name || "Imported file";
  const fileType = payload?.type || "application/octet-stream";
  const mode = getMode(fileType, filename);

  useEffect(() => {
    let cancelled = false;
    let urlToRevoke: string | null = null;

    const load = async () => {
      if (!payload) {
        setError("Missing or invalid drive import payload.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setTextContent(null);
      setPreviewUrl(null);

      try {
        const base = payload.server.replace(/\/$/, "");
        const fileUrl = `${base}/${payload.hash}`;

        const authHeader = await createGetAuthHeader(payload.hash);

        let res = await fetch(fileUrl, {
          headers: authHeader ? { Authorization: authHeader } : {},
        });

        if (!res.ok && authHeader) {
          res = await fetch(fileUrl);
        }

        if (!res.ok) {
          throw new Error(`Failed to fetch file: HTTP ${res.status}`);
        }

        const encryptedBytes = new Uint8Array(await res.arrayBuffer());
        const ciphertext = new TextDecoder().decode(encryptedBytes);
        const decryptedBytes = await decryptFormstrDriveFile(ciphertext, payload.encryptionKey);

        if (cancelled) return;

        if (mode === "text") {
          setTextContent(new TextDecoder().decode(decryptedBytes));
          return;
        }

        if (mode === "docx") {
          try {
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({ arrayBuffer: decryptedBytes.buffer as ArrayBuffer });
            setTextContent(result.value || "");
            return;
          } catch {
            // Fall through to binary view if mammoth is unavailable.
          }
        }

        const blob = new Blob([decryptedBytes as BlobPart], {
          type: payload.type || "application/octet-stream",
        });
        const objectUrl = URL.createObjectURL(blob);
        urlToRevoke = objectUrl;
        setPreviewUrl(objectUrl);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load file");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    };
  }, [payload, mode]);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", gap: 2 }}>
      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Drive Import</Typography>
        <Typography variant="body2" color="text.secondary">
          {filename} {payload?.type ? `(${payload.type})` : ""}
        </Typography>
      </Paper>

      <Paper sx={{ flex: 1, p: 2, borderRadius: 2, overflow: "auto" }}>
        {loading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <CircularProgress size={18} />
            <Typography>Loading file...</Typography>
          </Box>
        )}

        {!loading && error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && textContent !== null && (
          <Box
            component="pre"
            sx={{
              m: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "Consolas, 'Courier New', monospace",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {textContent || "(empty document)"}
          </Box>
        )}

        {!loading && !error && textContent === null && mode === "image" && previewUrl && (
          <Box component="img" src={previewUrl} alt={filename} sx={{ maxWidth: "100%", maxHeight: "100%", display: "block", mx: "auto" }} />
        )}

        {!loading && !error && textContent === null && mode === "video" && previewUrl && (
          <Box component="video" src={previewUrl} controls sx={{ width: "100%", maxHeight: "100%" }} />
        )}

        {!loading && !error && textContent === null && mode === "pdf" && previewUrl && (
          <Box component="iframe" src={previewUrl} title={filename} sx={{ width: "100%", height: "100%", minHeight: 520, border: 0 }} />
        )}

        {!loading && !error && textContent === null && previewUrl && mode === "binary" && (
          <Button component="a" href={previewUrl} download={filename} variant="outlined">
            Download file
          </Button>
        )}
      </Paper>

      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
        <Button variant="text" onClick={() => navigate("/")}>Back to docs</Button>
        {previewUrl && (
          <Button component="a" href={previewUrl} download={filename} variant="contained" color="secondary">
            Download
          </Button>
        )}
      </Box>
    </Box>
  );
}
