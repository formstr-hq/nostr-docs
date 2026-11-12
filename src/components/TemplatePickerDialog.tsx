import {
  Box,
  ButtonBase,
  Dialog,
  DialogContent,
  DialogTitle,
  Typography,
  alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import WorkOutlineIcon from "@mui/icons-material/WorkOutline";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import type { DocumentTemplate } from "../lib/docTemplates";
import { DOCUMENT_TEMPLATES } from "../lib/docTemplates";

const KIND_ICONS: Record<DocumentTemplate["kind"], typeof WorkOutlineIcon> = {
  resume: WorkOutlineIcon,
  letterhead: DescriptionOutlinedIcon,
  "cover-letter": MailOutlineIcon,
  invoice: ReceiptLongOutlinedIcon,
};

function Bar({ width, height = 3, opacity = 0.18 }: { width: string; height?: number; opacity?: number }) {
  return (
    <Box
      sx={{
        width,
        height,
        borderRadius: 0.5,
        bgcolor: (theme) => alpha(theme.palette.text.primary, opacity),
      }}
    />
  );
}

function MiniPreview({ template }: { template?: DocumentTemplate }) {
  if (!template) {
    return (
      <Box
        sx={{
          width: 92,
          aspectRatio: "8.5 / 11",
          borderRadius: 0.75,
          border: "1.5px dashed",
          borderColor: (theme) => alpha(theme.palette.text.primary, 0.2),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.secondary",
        }}
      >
        <AddIcon sx={{ fontSize: 26 }} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: 92,
        aspectRatio: "8.5 / 11",
        bgcolor: "background.paper",
        borderRadius: 0.75,
        boxShadow: 2,
        borderTop: `3px solid ${template.accent}`,
        p: 0.9,
        display: "flex",
        flexDirection: "column",
        gap: 0.45,
        overflow: "hidden",
      }}
    >
      {template.kind === "resume" && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "1.6fr 1fr",
            gap: 0.6,
            flex: 1,
            minHeight: 0,
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.45, minWidth: 0 }}>
            <Bar width="68%" height={5} opacity={0.55} />
            <Bar width="92%" height={2} />
            <Box sx={{ height: 3 }} />
            <Bar width="34%" height={3} opacity={0.3} />
            <Bar width="100%" height={2} />
            <Bar width="94%" height={2} />
            <Bar width="88%" height={2} />
            <Box sx={{ height: 3 }} />
            <Bar width="42%" height={3} opacity={0.3} />
            <Bar width="100%" height={2} />
            <Bar width="90%" height={2} />
          </Box>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.45,
              borderLeft: "1px solid",
              borderColor: (theme) => alpha(theme.palette.text.primary, 0.1),
              bgcolor: (theme) => alpha(theme.palette.text.primary, 0.04),
              borderRadius: 0.5,
              p: 0.45,
              minWidth: 0,
            }}
          >
            <Bar width="74%" height={3} opacity={0.35} />
            <Bar width="92%" height={2} />
            <Bar width="82%" height={2} />
            <Box sx={{ height: 3 }} />
            <Bar width="58%" height={3} opacity={0.35} />
            <Bar width="90%" height={2} />
            <Bar width="70%" height={2} />
          </Box>
        </Box>
      )}

      {template.kind === "letterhead" && (
        <>
          <Bar width="46%" height={4} opacity={0.5} />
          <Bar width="64%" height={2} />
          <Box sx={{ height: 6 }} />
          <Bar width="30%" height={2} />
          <Box sx={{ height: 3 }} />
          <Bar width="100%" height={2} />
          <Bar width="96%" height={2} />
          <Bar width="90%" height={2} />
          <Bar width="98%" height={2} />
          <Bar width="72%" height={2} />
          <Box sx={{ height: 6 }} />
          <Bar width="34%" height={2} opacity={0.3} />
        </>
      )}

      {template.kind === "cover-letter" && (
        <>
          <Bar width="42%" height={5} opacity={0.5} />
          <Bar width="58%" height={2} />
          <Box sx={{ height: 5 }} />
          <Bar width="36%" height={2} />
          <Box sx={{ height: 6 }} />
          <Bar width="100%" height={2} />
          <Bar width="95%" height={2} />
          <Bar width="100%" height={2} />
          <Bar width="88%" height={2} />
          <Box sx={{ height: 5 }} />
          <Bar width="100%" height={2} />
          <Bar width="82%" height={2} />
        </>
      )}

      {template.kind === "invoice" && (
        <>
          <Bar width="38%" height={5} opacity={0.55} />
          <Bar width="54%" height={2} />
          <Box sx={{ height: 5 }} />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 14px 20px", gap: 0.4 }}>
            <Bar width="100%" height={2} opacity={0.35} />
            <Bar width="100%" height={2} opacity={0.35} />
            <Bar width="100%" height={2} opacity={0.35} />
            <Bar width="100%" height={2} />
            <Bar width="100%" height={2} />
            <Bar width="100%" height={2} />
            <Bar width="100%" height={2} />
            <Bar width="100%" height={2} />
            <Bar width="100%" height={2} />
            <Bar width="100%" height={2} />
            <Bar width="100%" height={2} />
            <Bar width="100%" height={2} />
          </Box>
          <Box sx={{ height: 4 }} />
          <Bar width="40%" height={3} opacity={0.35} />
        </>
      )}
    </Box>
  );
}

function TemplateCard({
  template,
  onClick,
}: {
  template?: DocumentTemplate;
  onClick: () => void;
}) {
  const Icon = template ? KIND_ICONS[template.kind] : AddIcon;
  const title = template?.name ?? "Blank page";
  const description =
    template?.description ?? "Start with an empty page and build it your way.";

  return (
    <ButtonBase
      onClick={onClick}
      aria-label={`Start with ${title}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        textAlign: "left",
        p: 1.4,
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        transition: "transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease",
        "&:hover": {
          borderColor: template?.accent ?? "secondary.main",
          transform: "translateY(-2px)",
          boxShadow: 3,
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          py: 1.4,
          borderRadius: 1,
          bgcolor: (theme) => alpha(theme.palette.text.primary, 0.03),
        }}
      >
        <MiniPreview template={template} />
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 1.25 }}>
        <Icon sx={{ fontSize: 17, color: template?.accent ?? "text.secondary" }} />
        <Typography sx={{ fontWeight: 700, fontSize: "0.83rem" }}>{title}</Typography>
      </Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.35, fontSize: "0.72rem", lineHeight: 1.35 }}
      >
        {description}
      </Typography>
    </ButtonBase>
  );
}

export function TemplatePickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` selects a blank page. */
  onSelect: (template: DocumentTemplate | null) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Start a new page</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Pick a template or start blank. You can change the page setup, fonts and
          styles at any time.
        </Typography>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              sm: "repeat(3, minmax(0, 1fr))",
            },
            gap: 1.5,
          }}
        >
          <TemplateCard onClick={() => onSelect(null)} />
          {DOCUMENT_TEMPLATES.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onClick={() => onSelect(template)}
            />
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
