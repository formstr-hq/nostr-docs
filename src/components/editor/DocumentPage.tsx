import React from "react";
import { Box, useTheme } from "@mui/material";
import {
  blockStyleToCss,
  getBaseTypography,
  getPageDimensions,
  type PageHeaderFooter,
  type PageLayout,
} from "../../lib/docLayout";

function HeaderFooter({
  slots,
  position,
}: {
  slots: PageHeaderFooter;
  position: "header" | "footer";
}) {
  const values = [slots.left, slots.center, slots.right];
  if (values.every((value) => !value)) return null;

  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        alignItems: "baseline",
        flexShrink: 0,
        fontSize: "0.72em",
        letterSpacing: "0.01em",
        color: "text.secondary",
        pb: position === "header" ? 1 : 0,
        mb: position === "header" ? 1.5 : 0,
        mt: position === "footer" ? 1.5 : 0,
        pt: position === "footer" ? 1 : 0,
        borderBottom: position === "header" ? "1px solid" : "none",
        borderTop: position === "footer" ? "1px solid" : "none",
        borderColor: "divider",
      }}
    >
      <Box sx={{ flex: 1, textAlign: "left" }}>{slots.left}</Box>
      <Box sx={{ flex: 1, textAlign: "center" }}>{slots.center}</Box>
      <Box sx={{ flex: 1, textAlign: "right" }}>{slots.right}</Box>
    </Box>
  );
}

/** Typography and block rules shared by both canvases. */
function contentStyle(layout: PageLayout) {
  const typography = getBaseTypography(layout);
  return {
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSizePx,
    lineHeight: typography.lineHeight,
    "& p, & li": { lineHeight: typography.lineHeight },
    "& h1": blockStyleToCss(layout.styles?.h1),
    "& h2": blockStyleToCss(layout.styles?.h2),
    "& h3": blockStyleToCss(layout.styles?.h3),
    "& h4": blockStyleToCss(layout.styles?.h4),
    "& p": blockStyleToCss(layout.styles?.paragraph),
    "& blockquote": blockStyleToCss(layout.styles?.blockquote),
  };
}

export function DocumentPage({
  layout,
  children,
  contentRef,
}: {
  layout: PageLayout;
  children: React.ReactNode;
  contentRef?: React.Ref<HTMLDivElement>;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const typography = contentStyle(layout);

  // ── Notes canvas (default): continuous, borderless, theme-native ──
  if (layout.canvas !== "page") {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          width: "100%",
          py: { xs: 2, sm: 3 },
          px: { xs: 2, sm: 3 },
          bgcolor: "background.default",
        }}
      >
        <Box
          data-pages-content
          ref={contentRef}
          sx={{
            width: "100%",
            maxWidth: 760,
            color: "text.primary",
            ...typography,
          }}
        >
          {children}
        </Box>
      </Box>
    );
  }

  // ── Page canvas: paginated document / letterhead / resume ──
  const dims = getPageDimensions(layout);
  const margin = (inches: number) => ({
    xs: `${Math.max(16, Math.round(inches * 96 * 0.5))}px`,
    sm: `${Math.max(16, Math.round(inches * 96))}px`,
  });

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        width: "100%",
        py: { xs: 1, sm: 2 },
        px: { xs: 0.5, sm: 2 },
        bgcolor: isDark ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.045)",
      }}
    >
      <Box
        data-pages-page
        sx={{
          width: `${dims.widthPx}px`,
          maxWidth: "100%",
          minHeight: `${dims.heightPx}px`,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          bgcolor: isDark ? "#1d1d21" : "#ffffff",
          color: isDark ? "#ececec" : "#1a1a1a",
          borderRadius: 0.5,
          boxShadow: isDark
            ? "0 10px 32px rgba(0,0,0,0.45)"
            : "0 10px 32px rgba(15, 23, 42, 0.12)",
          pt: margin(layout.margins.top),
          pr: margin(layout.margins.right),
          pb: margin(layout.margins.bottom),
          pl: margin(layout.margins.left),
          ...typography,
          "& h1, & h2, & h3, & h4": { color: "inherit" },
        }}
      >
        {layout.header && <HeaderFooter slots={layout.header} position="header" />}
        <Box
          data-pages-content
          ref={contentRef}
          sx={{
            flex: 1,
            minWidth: 0,
          }}
        >
          {children}
        </Box>
        {layout.footer && <HeaderFooter slots={layout.footer} position="footer" />}
      </Box>
    </Box>
  );
}
