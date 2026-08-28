import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DifferenceIcon from "@mui/icons-material/Difference";
import {
  createTextDiffSegments,
  resolveTextDiff,
  type TextDiffSegment,
} from "../../lib/textSuggest/textDiff";

interface Props {
  before: string;
  after: string;
  instruction: string;
  onAccept: (acceptedDocument: string) => void;
  onReject: () => void;
}

type ChangeSegment = Extract<TextDiffSegment, { type: "change" }>;

function summarizeChangeText(text: string): string {
  const summary = text.replace(/\s+/g, " ").trim();
  if (!summary) return "whitespace";
  return summary.length > 60 ? `${summary.slice(0, 59)}…` : summary;
}

function describeChange(change: ChangeSegment): string {
  if (!change.before) return `add “${summarizeChangeText(change.after)}”`;
  if (!change.after) return `remove “${summarizeChangeText(change.before)}”`;
  return `replace “${summarizeChangeText(change.before)}” with “${summarizeChangeText(change.after)}”`;
}

export function ProofreadDiffView({
  before,
  after,
  instruction,
  onAccept,
  onReject,
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const segments = useMemo(
    () => createTextDiffSegments(before, after),
    [before, after],
  );
  const changes = useMemo(
    () =>
      segments.filter(
        (segment): segment is ChangeSegment => segment.type === "change",
      ),
    [segments],
  );
  const [rejectedChangeIds, setRejectedChangeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [announcement, setAnnouncement] = useState("");
  const rejectedCount = rejectedChangeIds.size;
  const remainingCount = changes.length - rejectedCount;
  const acceptedDocument = useMemo(
    () => resolveTextDiff(segments, rejectedChangeIds),
    [segments, rejectedChangeIds],
  );

  const toggleChange = (change: ChangeSegment, index: number) => {
    const next = new Set(rejectedChangeIds);
    const keepingOriginal = !next.has(change.id);
    if (keepingOriginal) next.add(change.id);
    else next.delete(change.id);
    setRejectedChangeIds(next);

    const nextRemainingCount = changes.length - next.size;
    setAnnouncement(
      `Change ${index + 1} ${keepingOriginal ? "kept as original" : "restored"}. ${nextRemainingCount} ${nextRemainingCount === 1 ? "change" : "changes"} will be applied.`,
    );
  };

  useEffect(() => headingRef.current?.focus(), []);

  return (
    <Box
      component="section"
      aria-label="Proofreading changes"
      sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          display: "flex",
          alignItems: { xs: "stretch", sm: "center" },
          flexDirection: { xs: "column", sm: "row" },
          gap: 1,
          px: { xs: 2, sm: 3 },
          py: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            ref={headingRef}
            tabIndex={-1}
            variant="subtitle1"
            sx={{ display: "flex", alignItems: "center", gap: 0.75, fontWeight: 700 }}
          >
            <DifferenceIcon fontSize="small" color="secondary" />
            Review AI changes
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {instruction}
          </Typography>
        </Box>
        <Box
          sx={{
            display: "flex",
            gap: 1,
            flexDirection: { xs: "column-reverse", sm: "row" },
            "& .MuiButton-root": { width: { xs: "100%", sm: "auto" } },
          }}
        >
          <Button onClick={onReject} startIcon={<CloseIcon />}>
            Reject
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={() => onAccept(acceptedDocument)}
            startIcon={<CheckIcon />}
          >
            {rejectedCount === 0
              ? "Accept changes"
              : remainingCount === 0
                ? "Return to editor"
                : `Accept remaining changes (${remainingCount})`}
          </Button>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
          <Chip
            size="small"
            label={`${changes.length} suggested change${changes.length === 1 ? "" : "s"}`}
            color="success"
            variant="outlined"
          />
          {rejectedCount > 0 && (
            <Chip
              size="small"
              label={`${rejectedCount} kept original`}
              variant="outlined"
            />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
            Choose Keep original on any unwanted change, then accept the rest.
            The editor is unchanged until you accept.
          </Typography>
        </Box>
        <Box
          role="status"
          aria-live="polite"
          sx={{
            position: "absolute",
            width: 1,
            height: 1,
            p: 0,
            m: -1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {announcement}
        </Box>
        <Box
          component="pre"
          aria-label="Document diff"
          sx={{
            m: 0,
            p: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "action.hover",
            color: "text.primary",
            fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
            fontSize: "0.88rem",
            lineHeight: 1.75,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {segments.map((segment, index) => {
            if (segment.type === "equal") {
              return <span key={`equal-${index}`}>{segment.text}</span>;
            }

            const changeIndex = changes.findIndex(
              (change) => change.id === segment.id,
            );
            const rejected = rejectedChangeIds.has(segment.id);
            const position = `${changeIndex + 1} of ${changes.length}`;
            return (
              <Box
                component="button"
                type="button"
                key={segment.id}
                aria-label={`${rejected ? "Restore suggestion for" : "Keep original for"} change ${position}: ${describeChange(segment)}`}
                aria-pressed={rejected}
                title={rejected ? "Use the AI suggestion" : "Keep the original text"}
                onClick={() => toggleChange(segment, changeIndex)}
                sx={{
                  appearance: "none",
                  display: "inline",
                  p: 0,
                  m: 0,
                  border: 0,
                  borderRadius: 0.5,
                  bgcolor: "transparent",
                  color: "inherit",
                  font: "inherit",
                  lineHeight: "inherit",
                  textAlign: "inherit",
                  cursor: "pointer",
                  "&:focus-visible": {
                    outline: "2px solid",
                    outlineColor: "secondary.main",
                    outlineOffset: "2px",
                  },
                  "&:hover .proofread-change-action": { opacity: 1 },
                }}
              >
                {rejected ? (
                  segment.before ? (
                    <Box
                      component="span"
                      sx={{
                        bgcolor: "action.selected",
                        borderBottom: "2px dashed",
                        borderColor: "text.secondary",
                      }}
                    >
                      {segment.before}
                    </Box>
                  ) : (
                    <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                      insertion omitted
                    </Box>
                  )
                ) : (
                  <>
                    {segment.before && (
                      <Box
                        component="del"
                        sx={{ bgcolor: "rgba(244,67,54,0.18)", color: "error.main" }}
                      >
                        {segment.before}
                      </Box>
                    )}
                    {segment.after && (
                      <Box
                        component="ins"
                        sx={{
                          bgcolor: "rgba(76,175,80,0.2)",
                          color: "success.main",
                          textDecoration: "none",
                          borderBottom: "2px solid",
                        }}
                      >
                        {segment.after}
                      </Box>
                    )}
                  </>
                )}
                <Box
                  component="span"
                  className="proofread-change-action"
                  aria-hidden="true"
                  sx={{
                    display: "inline-block",
                    ml: 0.35,
                    px: 0.45,
                    border: "1px solid currentColor",
                    borderRadius: 10,
                    fontFamily: "inherit",
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    lineHeight: 1.45,
                    verticalAlign: "middle",
                    opacity: 0.72,
                  }}
                >
                  {rejected ? "Restore" : "Keep original"}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
