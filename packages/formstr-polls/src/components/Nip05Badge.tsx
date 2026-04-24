import { Box, Tooltip, Typography } from "@mui/material";
import VerifiedIcon from "@mui/icons-material/Verified";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useNip05 } from "../hooks/useNip05";

function formatNip05(identifier: string): string {
  if (identifier.startsWith("_@")) return identifier.slice(2);
  return identifier;
}

export function Nip05Badge({
  nip05,
  pubkey,
}: {
  nip05: string | undefined;
  pubkey: string;
}) {
  const status = useNip05(nip05, pubkey);

  if (!nip05) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.45, minWidth: 0 }}>
      {status === "verified" && (
        <Tooltip title="NIP-05 verified">
          <VerifiedIcon
            sx={{
              fontSize: 14,
              color: "#FAD13F",
              flexShrink: 0,
            }}
          />
        </Tooltip>
      )}
      {status === "failed" && (
        <Tooltip title="NIP-05 could not be verified">
          <WarningAmberIcon sx={{ fontSize: 14, color: "warning.main", flexShrink: 0 }} />
        </Tooltip>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
        {formatNip05(nip05)}
      </Typography>
    </Box>
  );
}
