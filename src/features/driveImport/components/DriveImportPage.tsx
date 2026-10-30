/**
 * src/features/driveImport/components/DriveImportPage.tsx
 * Top-level route view for /drive-import and hash payload deep links.
 *
 * Dispatches to:
 * - Document reader with "Open in editor" for Markdown, Text, HTML, DOCX
 * - In-App Standalone Preview for Images, Video, Audio, PDF
 * - Binary Download View for other binary types
 * - Error state with a way back when links are malformed or missing
 */

import React from "react";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import { useDriveImport } from "../hooks/useDriveImport";
import { ImportLoadingState } from "./ImportLoadingState";
import { MediaPreviewModal } from "./MediaPreviewModal";
import { BinaryDownloadView } from "./BinaryDownloadView";
import { classifyDriveFile } from "../converters/mimeClassifier";

export interface DriveImportPageProps {
  onBackToDocs?: () => void;
  /** Called with the document converted to Markdown, the format Pages stores. */
  onOpenInEditor?: (markdown: string) => void;
}

/** Page styles for the sandboxed reader. The iframe renders on white like a printed page, in light and dark. */
const READER_CSS =
  "body{font:15px/1.65 Georgia,'Times New Roman',serif;color:#1f2937;margin:0;padding:32px 40px}" +
  "h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}" +
  "table{border-collapse:collapse;width:100%;margin:12px 0}" +
  "td,th{border:1px solid #d1d5db;padding:6px 10px;vertical-align:top}p{margin:0 0 .8em}";

export const DriveImportPage: React.FC<DriveImportPageProps> = ({
  onBackToDocs = () => {
    window.location.href = "/";
  },
  onOpenInEditor,
}) => {
  const { status, decryptedFile, importedDocument, error, progress, retry, downloadFile } = useDriveImport();

  if (
    status === "parsing" ||
    status === "fetching" ||
    status === "decrypting" ||
    status === "reassembling" ||
    status === "verifying"
  ) {
    return (
      <ImportLoadingState
        progress={progress || undefined}
        fileName={decryptedFile?.name}
        totalSize={decryptedFile?.size}
      />
    );
  }

  if (status === "error" || error) {
    const details = error?.toJSON() || {
      title: "Unable to open shared file",
      description: "An unexpected error occurred while processing the link.",
      actionGuidance: "Back to pages",
    };
    return (
      <Stack role="alert" alignItems="center" justifyContent="center" spacing={1.5} sx={{ minHeight: "60vh", px: 3, textAlign: "center" }}>
        <ErrorOutlineRoundedIcon color="error" sx={{ fontSize: 36 }} />
        <Typography variant="h6">{details.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {details.description}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
          <Button variant="outlined" onClick={onBackToDocs}>
            {details.actionGuidance || "Back to pages"}
          </Button>
          <Button variant="contained" onClick={retry}>
            Retry
          </Button>
        </Stack>
      </Stack>
    );
  }

  if (decryptedFile) {
    const classification = classifyDriveFile(decryptedFile.mimeType, decryptedFile.name);

    if (classification.isDocument && importedDocument) {
      return (
        <Box sx={{ maxWidth: 900, width: "100%", mx: "auto", px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            flexWrap="wrap"
            sx={{ gap: 1.5, mb: 2 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                {importedDocument.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {importedDocument.wordCount.toLocaleString()} words
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" color="inherit" onClick={downloadFile}>
                Download
              </Button>
              <Button
                variant="contained"
                onClick={() => onOpenInEditor?.(importedDocument.markdown)}
              >
                Open in editor
              </Button>
            </Stack>
          </Stack>

          <Paper variant="outlined" sx={{ overflow: "hidden", bgcolor: "#fff" }}>
            <iframe
              title="Document preview"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><style>${READER_CSS}</style>${importedDocument.htmlContent}`}
              style={{
                display: "block",
                width: "100%",
                height: "calc(100vh - 170px)",
                minHeight: 360,
                border: 0,
                background: "#fff",
              }}
            />
          </Paper>
        </Box>
      );
    }

    if (classification.isMedia) {
      return <MediaPreviewModal file={decryptedFile} onBackToDocs={onBackToDocs} />;
    }

    return <BinaryDownloadView file={decryptedFile} onBackToDocs={onBackToDocs} />;
  }

  return (
    <Stack alignItems="center" justifyContent="center" sx={{ minHeight: "60vh" }}>
      <Typography color="text.secondary">Waiting for link</Typography>
    </Stack>
  );
};
