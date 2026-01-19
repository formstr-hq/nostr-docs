import { Box, Typography, useTheme } from "@mui/material";
import { useRef } from "react";
import ReactMarkdown from "react-markdown";

type Props = {
  value: string;
  mode: "edit" | "preview";
  onChange: (value: string) => void;
  onToggleMode: () => void;
  isMobile: boolean;
};

export function DocEditorSurface({
  value,
  mode,
  onChange,
  onToggleMode,
  isMobile,
}: Props) {
  const theme = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (mode === "edit") {
    return (
      <Box
        component="textarea"
        ref={textareaRef}
        value={value}
        placeholder="Start typing your page here (Markdown supported)"
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          color: theme.palette.text.primary,
          fontSize: "17px",
          lineHeight: 1.7,
          fontFamily:
            '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      />
    );
  }

  return (
    <Box
      title="Double-click to edit"
      onDoubleClick={onToggleMode}
      sx={{
        cursor: "text",
        "& h1,h2,h3,h4": {
          color: theme.palette.text.primary,
          fontWeight: 800,
        },
        "& p": { color: theme.palette.text.secondary },
      }}
    >
      {value.trim() ? (
        <ReactMarkdown>{value}</ReactMarkdown>
      ) : (
        <Typography color="text.secondary">
          Nothing to preview yet,{" "}
          {isMobile
            ? "double tap this text to edit"
            : "double click this text to edit"}
        </Typography>
      )}
    </Box>
  );
}
