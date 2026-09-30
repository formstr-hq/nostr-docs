import { Box, Button, Chip, Typography } from "@mui/material";
import { RECOMMENDED_GGUF_MODELS } from "../../../lib/textSuggest/modelCatalog";

export function RecommendedModelList() {
  return (
    <Box sx={{ display: "grid", gap: 1.25, mb: 2 }}>
      {RECOMMENDED_GGUF_MODELS.map((model) => (
        <Box
          key={model.id}
          sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.5 }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 0.75,
              mb: 0.5,
            }}
          >
            <Typography variant="subtitle2">{model.name}</Typography>
            <Chip size="small" label={model.badge} />
            <Typography variant="caption" color="text.secondary">
              {model.size}
            </Typography>
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1 }}
          >
            {model.description}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            <Button
              component="a"
              href={model.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              variant="outlined"
            >
              Download GGUF
            </Button>
            <Button
              component="a"
              href={model.detailsUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
            >
              Model details
            </Button>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
