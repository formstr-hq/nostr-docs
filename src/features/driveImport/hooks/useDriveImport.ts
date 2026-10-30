/**
 * src/features/driveImport/hooks/useDriveImport.ts
 * Main state orchestrator hook for deep link ingestion, download, decryption,
 * and view dispatch (TipTap document import vs media preview vs download).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DriveImportError,
  type DecryptedDriveFile,
  type DecryptionProgress,
  type DocumentImportResult,
  type NormalizedDrivePayload,
  type NostrSignerLike,
} from "../types";
import { parseDrivePayload, sanitizeDriveImportUrl } from "../parsePayload";
import { fetchAndDecryptDriveFile } from "../blossom/fetchBlob";
import { convertDriveFileToDocument } from "../converters/documentConverter";
import { classifyDriveFile } from "../converters/mimeClassifier";

export type ImportStateStatus =
  | "idle"
  | "parsing"
  | "fetching"
  | "decrypting"
  | "reassembling"
  | "verifying"
  | "ready"
  | "error";

export interface UseDriveImportOptions {
  /** Optional Nostr signer for Kind 24242 protected Blossom servers */
  signer?: NostrSignerLike;
  /** Auto-clean URL credentials on successful parse (defaults to true) */
  autoSanitizeUrl?: boolean;
}

export interface UseDriveImportReturn {
  status: ImportStateStatus;
  payload: NormalizedDrivePayload | null;
  decryptedFile: DecryptedDriveFile | null;
  importedDocument: DocumentImportResult | null;
  error: DriveImportError | null;
  progress: DecryptionProgress | null;
  retry: () => void;
  downloadFile: () => void;
}

let activeImportPayload: NormalizedDrivePayload | null = null;

export function clearActiveImportPayload(): void {
  activeImportPayload = null;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem("active_drive_payload");
    } catch {}
  }
}

export function getActiveImportPayload(): NormalizedDrivePayload | null {
  if (activeImportPayload) return activeImportPayload;
  if (typeof sessionStorage !== "undefined") {
    try {
      const stored = sessionStorage.getItem("active_drive_payload");
      if (stored) {
        activeImportPayload = JSON.parse(stored) as NormalizedDrivePayload;
        return activeImportPayload;
      }
    } catch {}
  }
  return null;
}

export function useDriveImport(options?: UseDriveImportOptions): UseDriveImportReturn {
  const [status, setStatus] = useState<ImportStateStatus>("idle");
  const [payload, setPayload] = useState<NormalizedDrivePayload | null>(null);
  const [decryptedFile, setDecryptedFile] = useState<DecryptedDriveFile | null>(null);
  const [importedDocument, setImportedDocument] = useState<DocumentImportResult | null>(null);
  const [error, setError] = useState<DriveImportError | null>(null);
  const [progress, setProgress] = useState<DecryptionProgress | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const executeImport = useCallback(async () => {
    if (typeof window === "undefined") return;

    // Abort previous in-flight requests if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setStatus("parsing");
    setError(null);
    setProgress(null);

    let parsed: NormalizedDrivePayload | null = null;
    try {
      parsed = parseDrivePayload(window.location.href);
      activeImportPayload = parsed;
      if (typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.setItem("active_drive_payload", JSON.stringify(parsed));
        } catch {}
      }

      if (options?.autoSanitizeUrl !== false) {
        sanitizeDriveImportUrl();
      }
    } catch (parseErr) {
      const fallback = getActiveImportPayload();
      if (fallback) {
        parsed = fallback;
      } else {
        const err =
          parseErr instanceof DriveImportError
            ? parseErr
            : new DriveImportError(
                "MALFORMED_URL",
                parseErr instanceof Error ? parseErr.message : "Failed to parse import link",
              );
        setError(err);
        setStatus("error");
        return;
      }
    }

    setPayload(parsed);

    try {
      const decrypted = await fetchAndDecryptDriveFile(parsed, {
        signer: options?.signer,
        signal: abortController.signal,
        onProgress: (p) => {
          setProgress(p);
          if (p.stage !== "complete" && p.stage !== "error") {
            setStatus(p.stage);
          }
        },
      });

      setDecryptedFile(decrypted);

      // Check if document format for TipTap conversion
      const classification = classifyDriveFile(decrypted.mimeType, decrypted.name);
      if (classification.isDocument) {
        try {
          const doc = await convertDriveFileToDocument(decrypted);
          setImportedDocument(doc);
        } catch {
          // If document conversion fails, still provide decryptedFile for fallback preview
        }
      }

      setStatus("ready");
    } catch (fetchErr) {
      if (abortController.signal.aborted) {
        return; // Ignore aborted requests
      }
      const err =
        fetchErr instanceof DriveImportError
          ? fetchErr
          : new DriveImportError(
              "NETWORK_ERROR",
              fetchErr instanceof Error ? fetchErr.message : "Failed to download or decrypt file",
            );
      setError(err);
      setStatus("error");
    }
  }, [options?.signer, options?.autoSanitizeUrl]);

  useEffect(() => {
    executeImport();

    const handleHashChange = () => {
      executeImport();
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [executeImport]);

  const downloadFile = useCallback(() => {
    if (!decryptedFile) return;
    const blob = new Blob([decryptedFile.data as BlobPart], {
      type: decryptedFile.mimeType || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = decryptedFile.name || "downloaded-file";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [decryptedFile]);

  return {
    status,
    payload,
    decryptedFile,
    importedDocument,
    error,
    progress,
    retry: executeImport,
    downloadFile,
  };
}
