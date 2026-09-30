import { useRef, useState, type ChangeEvent } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  LinearProgress,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { LoadProgress } from "../../../lib/textSuggest/wllamaService";
import { HuggingFaceGGUFSearch } from "./HuggingFaceGGUFSearch";
import { RecommendedModelList } from "./RecommendedModelList";

interface Props {
  loading: boolean;
  progress: LoadProgress | null;
  onFile: (file: File) => Promise<void>;
  onCancel: () => void;
}

export function AddGGUFModelSection({
  loading,
  progress,
  onFile,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await onFile(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const percent =
    progress && progress.total > 0
      ? (progress.bytes / progress.total) * 100
      : undefined;

  return (
    <>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: "block", mb: 0.5 }}
      >
        Choose GGUF
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 1 }}
      >
        Choose a downloaded <strong>.gguf</strong> file. It runs locally and is
        not uploaded.
      </Typography>
      <Alert severity="warning" sx={{ mb: 1.5 }}>
        Models larger than 2 GB may exhaust memory or freeze lower-end
        devices. Start with a recommended model below when possible.
      </Alert>
      <Box sx={{ display: "flex", justifyContent: "center" }}>
        <input
          ref={inputRef}
          type="file"
          accept=".gguf"
          onChange={handleFile}
          style={{ display: "none" }}
          disabled={loading}
        />
        <Button
          variant="contained"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
        >
          Choose downloaded GGUF
        </Button>
      </Box>
      {loading && progress && (
        <Box sx={{ mt: 2 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1 }}
          >
            Loading model… {Math.round(percent ?? 0)}%
          </Typography>
          <LinearProgress
            variant={percent === undefined ? "indeterminate" : "determinate"}
            value={percent}
          />
          <Button size="small" sx={{ mt: 1 }} onClick={onCancel}>
            Cancel loading
          </Button>
        </Box>
      )}
      <Accordion
        expanded={catalogExpanded}
        onChange={(_, expanded) => setCatalogExpanded(expanded)}
        disableGutters
        elevation={0}
        slotProps={{ transition: { unmountOnExit: true } }}
        sx={{
          mt: 2,
          backgroundColor: "transparent",
          color: "inherit",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
          "&:before": { display: "none" },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls="get-local-ai-model-content"
          id="get-local-ai-model-header"
          sx={{
            minHeight: 56,
            backgroundColor: "transparent !important",
            "& .MuiAccordionSummary-content": { my: 1 },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2">Get a model</Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block" }}
            >
              Browse recommendations or search Hugging Face
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails id="get-local-ai-model-content" sx={{ pt: 0 }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            Download a model, return here, then use Choose downloaded GGUF
            above.
          </Alert>
          <RecommendedModelList />
          <HuggingFaceGGUFSearch />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block" }}
          >
            Choose any compatible GGUF. The three models above are
            recommendations, not a restriction.
          </Typography>
        </AccordionDetails>
      </Accordion>
    </>
  );
}
