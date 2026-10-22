/**
 * src/features/driveImport/components/MediaPreviewModal.tsx
 * In-App Standalone Preview Viewer for Media files (Images, Video, Audio, PDF).
 */

import React, { useEffect, useMemo, useState } from "react";
import type { DecryptedDriveFile } from "../types";
import { classifyDriveFile } from "../converters/mimeClassifier";

export interface MediaPreviewModalProps {
  file: DecryptedDriveFile;
  onBackToDocs?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  file,
  onBackToDocs,
}) => {
  const [videoError, setVideoError] = useState(false);

  // Create memoized blob URL for media elements and revoke on unmount
  const blobUrl = useMemo(() => {
    const blob = new Blob([file.data as BlobPart], { type: file.mimeType });
    return URL.createObjectURL(blob);
  }, [file.data, file.mimeType]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const classification = useMemo(
    () => classifyDriveFile(file.mimeType, file.name),
    [file.mimeType, file.name],
  );

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      style={{
        maxWidth: "960px",
        margin: "32px auto",
        backgroundColor: "#ffffff",
        borderRadius: "16px",
        boxShadow: "0 10px 40px rgba(0, 0, 0, 0.1)",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          borderBottom: "1px solid #e5e7eb",
          backgroundColor: "#f9fafb",
        }}
      >
        <div>
          <h2
            style={{
              fontSize: "16px",
              fontWeight: "600",
              margin: 0,
              color: "#111827",
            }}
          >
            {file.name}
          </h2>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            {formatBytes(file.size)} • {file.mimeType}
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleDownload}
            style={{
              padding: "8px 16px",
              backgroundColor: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            Download
          </button>
          {onBackToDocs && (
            <button
              onClick={onBackToDocs}
              style={{
                padding: "8px 16px",
                backgroundColor: "#ffffff",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Back to docs
            </button>
          )}
        </div>
      </div>

      {/* Main Preview Container */}
      <div
        style={{
          padding: "24px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "420px",
          backgroundColor: "#18181b",
        }}
      >
        {/* 1. Image Preview */}
        {classification.category === "media-image" && (
          <img
            src={blobUrl}
            alt={file.name}
            style={{
              maxWidth: "100%",
              maxHeight: "75vh",
              objectFit: "contain",
              borderRadius: "8px",
            }}
          />
        )}

        {/* 2. Video Player */}
        {classification.category === "media-video" && (
          <div style={{ width: "100%", textAlign: "center" }}>
            <video
              src={blobUrl}
              controls
              playsInline
              style={{
                maxWidth: "100%",
                maxHeight: "75vh",
                borderRadius: "8px",
              }}
              onError={() => setVideoError(true)}
            >
              Your browser does not support this video format.
            </video>
            {videoError && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  backgroundColor: "#fef2f2",
                  color: "#991b1b",
                  borderRadius: "8px",
                  fontSize: "14px",
                }}
              >
                This browser cannot decode this video format or codec. Click "Download" to open in an external media player.
              </div>
            )}
          </div>
        )}

        {/* 3. Audio Player */}
        {classification.category === "media-audio" && (
          <div
            style={{
              padding: "48px 32px",
              backgroundColor: "#27272a",
              borderRadius: "12px",
              textAlign: "center",
              width: "100%",
              maxWidth: "500px",
            }}
          >
                        <p style={{ color: "#ffffff", marginBottom: "16px", fontSize: "16px" }}>
              {file.name}
            </p>
            <audio src={blobUrl} controls style={{ width: "100%" }} />
          </div>
        )}

        {/* 4. PDF Viewer */}
        {classification.category === "media-pdf" && (
          <iframe
            src={blobUrl}
            title={file.name}
            style={{
              width: "100%",
              height: "75vh",
              border: "none",
              borderRadius: "8px",
              backgroundColor: "#ffffff",
            }}
          />
        )}
      </div>
    </div>
  );
};
