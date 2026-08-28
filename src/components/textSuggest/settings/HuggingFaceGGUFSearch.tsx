import { useState, type FormEvent } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";

function buildHuggingFaceGGUFSearchUrl(query: string): string {
  const params = new URLSearchParams({
    pipeline_tag: "text-generation",
    library: "gguf",
    sort: "downloads",
  });
  const normalizedQuery = query.trim();
  if (normalizedQuery) params.set("search", normalizedQuery);
  return `https://huggingface.co/models?${params.toString()}`;
}

export function HuggingFaceGGUFSearch() {
  const [query, setQuery] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    window.open(
      buildHuggingFaceGGUFSearchUrl(query),
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        p: 1.5,
        mb: 2,
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
        Want a different model?
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 1.25 }}
      >
        Search the Hugging Face catalog. For this editor, choose a single-file
        text-generation Instruct or Chat GGUF; Q4_K_M is a good starting point.
      </Typography>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 1,
        }}
      >
        <TextField
          placeholder="Search other GGUF models"
          size="small"
          fullWidth
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            htmlInput: { "aria-label": "Search other GGUF models" },
          }}
        />
        <Button
          type="submit"
          variant="outlined"
          sx={{
            width: { xs: "100%", sm: "auto" },
            minWidth: { sm: 150 },
            lineHeight: 1.15,
          }}
        >
          Search
        </Button>
      </Box>
    </Box>
  );
}
