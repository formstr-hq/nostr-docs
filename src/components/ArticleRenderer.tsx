import { Box, Typography, Chip, Stack, alpha } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  title: string;
  content: string;
  banner?: string;
  topics?: string[];
  isNip?: boolean;
  /** Tighter spacing/typography for the in-dialog preview. */
  compact?: boolean;
};

/**
 * Presentational renderer for a published page — banner, kind label, title,
 * hashtags and the markdown body. Shared by the in-app reader (ArticleView) and
 * the publish dialog's live preview so the preview is a true WYSIWYG of what
 * gets published.
 */
export default function ArticleRenderer({
  title,
  content,
  banner,
  topics = [],
  isNip = false,
  compact = false,
}: Props) {
  return (
    <Box>
      {banner && (
        <Box
          component="img"
          src={banner}
          alt=""
          sx={{
            width: "100%",
            maxHeight: compact ? 180 : 320,
            objectFit: "cover",
            borderRadius: 2,
            mb: 2,
          }}
        />
      )}
      <Typography variant="overline" color="text.secondary">
        {isNip ? "Community NIP" : "Article"}
      </Typography>
      <Typography variant={compact ? "h5" : "h4"} fontWeight={800} gutterBottom>
        {title || "Untitled"}
      </Typography>
      {topics.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mb: 2 }}>
          {topics.map((t) => (
            <Chip key={t} label={`#${t}`} size="small" />
          ))}
        </Stack>
      )}
      <Box
        sx={{
          fontSize: compact ? "0.9rem" : "1rem",
          lineHeight: 1.7,
          "& h1, & h2, & h3": { mt: 2.5, mb: 1, lineHeight: 1.25 },
          "& p": { my: 1 },
          "& img": { maxWidth: "100%", borderRadius: 1 },
          "& pre": {
            p: 1.5,
            borderRadius: "12px",
            overflow: "auto",
            bgcolor: (t) => (t.palette.mode === "dark" ? alpha(t.palette.primary.main, 0.04) : "rgba(0,0,0,0.06)"),
            border: "1px solid rgba(255,255,255,0.06)",
          },
          "& code": { fontSize: "0.9em" },
          "& table": { borderCollapse: "collapse", width: "100%" },
          "& th, & td": { border: "1px solid rgba(255,255,255,0.06)", p: 1 },
          "& a": { color: "secondary.main" },
          "& blockquote": {
            borderLeft: "4px solid",
            borderColor: "secondary.main",
            pl: 2,
            ml: 0,
            color: "text.secondary",
            bgcolor: (t) => alpha(t.palette.secondary.main, 0.04),
            py: 1,
            borderRadius: "0 8px 8px 0",
          },
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </Box>
    </Box>
  );
}
