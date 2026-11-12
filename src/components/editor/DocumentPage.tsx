import React from "react";
import { Box, useTheme } from "@mui/material";
import {
  blockStyleToCss,
  getBaseTypography,
  getPageDimensions,
  type PageHeaderFooter,
  type PageLayout,
} from "../../lib/docLayout";
import type { PageViewMode } from "../../lib/pageViewMode";

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
    "& hr": {
      border: "none",
      borderTop: `2px solid ${layout.ruleColor ?? "rgba(128,128,128,0.28)"}`,
      margin: "1.15em 0",
      opacity: 0.9,
    },
  };
}

export function DocumentPage({
  layout,
  viewMode,
  children,
  contentRef,
}: {
  layout: PageLayout;
  viewMode: PageViewMode;
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
  const isFixed = viewMode === "fixed";
  const margin = (inches: number) => ({
    xs: `${Math.max(16, Math.round(inches * 96 * 0.5))}px`,
    sm: `${Math.max(16, Math.round(inches * 96))}px`,
  });
  const fixedMargin = (inches: number) => `${Math.max(0, Math.round(inches * 96))}px`;
  const pagePadding = isFixed
    ? {
        pt: fixedMargin(layout.margins.top),
        pr: fixedMargin(layout.margins.right),
        pb: fixedMargin(layout.margins.bottom),
        pl: fixedMargin(layout.margins.left),
      }
    : {
        pt: margin(layout.margins.top),
        pr: margin(layout.margins.right),
        pb: margin(layout.margins.bottom),
        pl: margin(layout.margins.left),
      };

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isFixed ? "safe center" : "center",
        width: "100%",
        overflowX: isFixed ? "auto" : "visible",
        py: { xs: 1, sm: 2 },
        px: { xs: 0.5, sm: 2 },
        bgcolor: isDark ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.045)",
      }}
    >
      <Box
        data-pages-page
        data-layout-mode={viewMode}
        sx={{
          width: `${dims.widthPx}px`,
          minWidth: isFixed ? `${dims.widthPx}px` : undefined,
          maxWidth: isFixed ? "none" : "100%",
          flexShrink: 0,
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
          ...pagePadding,
          ...typography,
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
