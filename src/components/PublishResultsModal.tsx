import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import type { PublishResult } from "../nostr/publish";

interface Props {
  open: boolean;
  onClose: () => void;
  results: PublishResult[];
  onRetry: (relay: string) => Promise<PublishResult>;
}

export default function PublishResultsModal({
  open,
  onClose,
  results: initialResults,
  onRetry,
}: Props) {
  // Keep local state so we can update it on retry without reloading the whole editor
  const [results, setResults] = useState<PublishResult[]>(initialResults);
  const [retryingRelays, setRetryingRelays] = useState<Set<string>>(new Set());

  // Sync local state when initialResults changes (e.g. new save)
  React.useEffect(() => {
    setResults(initialResults);
  }, [initialResults]);

  const handleRetry = async (relay: string) => {
    setRetryingRelays((prev) => new Set(prev).add(relay));
    try {
      const newResult = await onRetry(relay);
      setResults((prev) =>
        prev.map((r) => (r.relay === relay ? newResult : r))
      );
    } catch (err) {
      console.error("Retry failed entirely", err);
    } finally {
      setRetryingRelays((prev) => {
        const next = new Set(prev);
        next.delete(relay);
        return next;
      });
    }
  };

  const acceptedCount = results.filter((r) => r.status === "accepted").length;
  const rejectedCount = results.filter((r) => r.status === "rejected").length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h5" component="span" fontWeight={700}>
          Publish results
        </Typography>
        {results.length > 0 && (
          <Box sx={{ display: "flex", gap: 1 }}>
            <Chip
              label={`${acceptedCount} accepted`}
              color="success"
              size="small"
              sx={{ fontWeight: 600, fontSize: "0.85rem" }}
            />
            {rejectedCount > 0 && (
              <Chip
                label={`${rejectedCount} rejected`}
                color="error"
                size="small"
                sx={{ fontWeight: 600, fontSize: "0.85rem" }}
              />
            )}
          </Box>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {results.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center", py: 8 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No publish results yet
            </Typography>
            <Typography color="text.secondary">
              Save your document to publish it to relays and view the results here.
            </Typography>
          </Box>
        ) : (
          <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 220, fontWeight: 700 }}>Relay</TableCell>
                <TableCell sx={{ width: 120, fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ width: 80, fontWeight: 700 }}>Time</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Reason</TableCell>
                <TableCell sx={{ width: 50 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {results.map((r) => {
                const isRetrying = retryingRelays.has(r.relay);
                const isAccepted = r.status === "accepted";
                return (
                  <TableRow key={r.relay} sx={{ "&:last-child td, &:last-child th": { border: 0 } }}>
                    <TableCell component="th" scope="row" sx={{ fontFamily: "monospace", fontSize: "0.9rem" }}>
                      {r.relay.replace("wss://", "")}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {isAccepted ? (
                          <CheckCircleOutlineIcon color="success" fontSize="small" />
                        ) : (
                          <ErrorOutlineIcon color="error" fontSize="small" />
                        )}
                        <Typography
                          variant="body2"
                          color={isAccepted ? "success.main" : "error.main"}
                          fontWeight={500}
                        >
                          {r.status}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>{r.time}ms</TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>
                      {r.reason || "no reason provided"}
                    </TableCell>
                    <TableCell align="center">
                      {!isAccepted && (
                        <Tooltip title="Retry publish to this relay">
                          <Box>
                            <IconButton
                              size="small"
                              onClick={() => handleRetry(r.relay)}
                              disabled={isRetrying}
                            >
                              <ReplayIcon 
                                fontSize="small" 
                                sx={isRetrying ? { 
                                  animation: "spin 1s linear infinite", 
                                  "@keyframes spin": { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(-360deg)" } } 
                                } : {}} 
                              />
                            </IconButton>
                          </Box>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" sx={{ fontWeight: 600 }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
