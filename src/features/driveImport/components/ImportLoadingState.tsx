/**
 * src/features/driveImport/components/ImportLoadingState.tsx
 * Progress for Formstr Drive deep link ingestion, download, and decryption.
 */

import React from "react";
import { Box, LinearProgress, Typography } from "@mui/material";
import type { DecryptionProgress } from "../types";

export interface ImportLoadingStateProps {
  progress?: DecryptionProgress;
  fileName?: string;
  totalSize?: number;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const STAGE_LABELS: Record<string, string> = {
  parsing: "Reading link",
  fetching: "Downloading",
  decrypting: "Decrypting",
  reassembling: "Assembling file",
  verifying: "Verifying",
  complete: "Ready",
};

export const ImportLoadingState: React.FC<ImportLoadingStateProps> = ({ progress, fileName, totalSize }) => {
  const stage = progress?.stage || "fetching";
  const received = progress?.bytesReceived || 0;
  const total = progress?.totalBytes || totalSize || 0;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        px: 3,
      }}
    >
      <Typography variant="subtitle1" color="text.primary" sx={{ fontWeight: 500 }}>
        {STAGE_LABELS[stage] ?? "Opening file"}
      </Typography>
      {fileName && (
        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 360 }}>
          {fileName}
          {total > 0 ? `  ·  ${formatBytes(total)}` : ""}
        </Typography>
      )}
      <Box sx={{ width: "100%", maxWidth: 360, mt: 1 }}>
        {total > 0 ? (
          <LinearProgress variant="determinate" value={percent} sx={{ height: 4, borderRadius: 2 }} />
        ) : (
          <LinearProgress sx={{ height: 4, borderRadius: 2 }} />
        )}
      </Box>
    </Box>
  );
};
