/**
 * src/features/driveImport/components/BinaryDownloadView.tsx
 * Standalone download card view for generic binaries, executables, and non-previewable formats.
 */

import React, { useCallback } from "react";
import type { DecryptedDriveFile } from "../types";

export interface BinaryDownloadViewProps {
  file: DecryptedDriveFile;
  onBackToDocs?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const BinaryDownloadView: React.FC<BinaryDownloadViewProps> = ({
  file,
  onBackToDocs,
}) => {
  const handleDownload = useCallback(() => {
    const blob = new Blob([file.data as BlobPart], { type: file.mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name || "downloaded-file";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [file]);

  return (
    <div
      style={{
        maxWidth: "520px",
        margin: "64px auto",
        padding: "36px 32px",
        backgroundColor: "#ffffff",
        borderRadius: "16px",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.08)",
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "16px",
          backgroundColor: "#eff6ff",
          color: "#3b82f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 20px auto",
          fontSize: "28px",
        }}
        aria-hidden="true"
      />

      <h2
        style={{
          fontSize: "20px",
          fontWeight: "600",
          color: "#111827",
          margin: "0 0 8px 0",
          wordBreak: "break-all",
        }}
      >
        {file.name}
      </h2>

      <p style={{ margin: "0 0 24px 0", fontSize: "14px", color: "#6b7280" }}>
        {formatBytes(file.size)} • {file.mimeType || "Binary file"}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <button
          onClick={handleDownload}
          style={{
            padding: "12px 24px",
            backgroundColor: "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            fontSize: "15px",
            fontWeight: "500",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            transition: "background-color 0.15s ease",
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#1d4ed8")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#2563eb")}
        >
          Download File
        </button>

        {onBackToDocs && (
          <button
            onClick={onBackToDocs}
            style={{
              padding: "10px 20px",
              backgroundColor: "transparent",
              color: "#4b5563",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              fontSize: "14px",
              cursor: "pointer",
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            Back to docs
          </button>
        )}
      </div>
    </div>
  );
};
