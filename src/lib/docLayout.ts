/**
 * Document layout + style model.
 *
 * The document body stays plain, semantic Markdown that any Nostr client can
 * parse. Page geometry and typography live in the encrypted kind-34579 metadata
 * (and, for shared v2 documents, the owner-authored roster) — never in the
 * Markdown body.
 *
 * Inline formatting that Markdown does not represent (alignment, size, line
 * height, fonts) is applied through document-level block styles. This keeps the
 * content free of `<span style=…>` noise and lets templates restyle a document
 * without rewriting its text.
 */

export const PAGE_SIZES = {
  A4: { widthIn: 8.27, heightIn: 11.69 },
  Letter: { widthIn: 8.5, heightIn: 11 },
  Legal: { widthIn: 8.5, heightIn: 14 },
} as const;

export type PageSize = keyof typeof PAGE_SIZES;
export type PageOrientation = "portrait" | "landscape";
export type PageMargin = "top" | "right" | "bottom" | "left";
export type TextAlign = "left" | "center" | "right" | "justify";
export type CanvasMode = "notes" | "page";

export interface PageHeaderFooter {
  left?: string;
  center?: string;
  right?: string;
}

/** Style applied to one semantic block type (h1/h2/p/…). */
export interface BlockStyle {
  fontFamily?: string;
  fontSizePt?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  align?: TextAlign;
  lineHeight?: number;
  color?: string;
  textTransform?: "none" | "uppercase";
  marginTopPt?: number;
  marginBottomPt?: number;
}

export interface DocumentStyles {
  h1?: BlockStyle;
  h2?: BlockStyle;
  h3?: BlockStyle;
  h4?: BlockStyle;
  paragraph?: BlockStyle;
  blockquote?: BlockStyle;
}

export interface PageLayout {
  version: 1;
  /** Screen presentation. Notes is the default continuous editor; page is the
   *  paginated document canvas used by letterheads/resumes. Print/export always
   *  uses the page geometry below. */
  canvas: CanvasMode;
  pageSize: PageSize;
  orientation: PageOrientation;
  /** Page margins in inches. */
  margins: Record<PageMargin, number>;
  fontFamily: string;
  /** Base body font size in points. */
  fontSizePt: number;
  /** Unitless line height (e.g. 1.5). */
  lineHeight: number;
  /** Optional per-block overrides; templates use these for letterheads/resumes. */
  styles?: DocumentStyles;
  /** Accent colour for horizontal rules and template dividers. */
  ruleColor?: string;
  header?: PageHeaderFooter;
  footer?: PageHeaderFooter;
}

export const DEFAULT_STYLES: DocumentStyles = {
  h1: { fontSizePt: 22, fontWeight: 800, align: "left", marginTopPt: 6, marginBottomPt: 4 },
  h2: { fontSizePt: 16.5, fontWeight: 700, align: "left", marginTopPt: 14, marginBottomPt: 4 },
  h3: { fontSizePt: 12.9, fontWeight: 600, align: "left", marginTopPt: 10, marginBottomPt: 3 },
  h4: { fontSizePt: 11, fontWeight: 700, align: "left", marginTopPt: 8, marginBottomPt: 2 },
  paragraph: { align: "left", lineHeight: 1.6 },
  blockquote: { fontStyle: "italic" },
};

export const DEFAULT_PAGE_LAYOUT: PageLayout = {
  version: 1,
  canvas: "notes",
  pageSize: "A4",
  orientation: "portrait",
  margins: { top: 1, right: 1, bottom: 1, left: 1 },
  fontFamily: "Inter",
  fontSizePt: 11,
  lineHeight: 1.6,
  styles: DEFAULT_STYLES,
};

export const MIN_MARGIN_IN = 0;
export const MAX_MARGIN_IN = 3;
export const MIN_FONT_SIZE_PT = 6;
export const MAX_FONT_SIZE_PT = 72;
export const MIN_LINE_HEIGHT = 1;
export const MAX_LINE_HEIGHT = 3;

const BLOCK_KEYS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "paragraph",
  "blockquote",
] as const;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function cleanHeaderFooter(
  value: PageHeaderFooter | undefined,
): PageHeaderFooter | undefined {
  if (!value) return undefined;
  const cleaned: PageHeaderFooter = {};
  for (const key of ["left", "center", "right"] as const) {
    const text = value[key];
    if (typeof text === "string" && text.trim()) cleaned[key] = text.trim();
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function cleanColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed) ? trimmed : undefined;
}

function normalizeBlockStyle(
  input: BlockStyle | undefined,
  fallback: BlockStyle | undefined,
): BlockStyle | undefined {
  if (!input) return fallback;
  const base = fallback ?? {};
  const align =
    input.align === "center" ||
    input.align === "right" ||
    input.align === "justify" ||
    input.align === "left"
      ? input.align
      : base.align;
  const fontStyle =
    input.fontStyle === "italic" || input.fontStyle === "normal"
      ? input.fontStyle
      : base.fontStyle;
  const textTransform =
    input.textTransform === "uppercase" || input.textTransform === "none"
      ? input.textTransform
      : base.textTransform;

  const style: BlockStyle = {
    fontFamily:
      typeof input.fontFamily === "string" && input.fontFamily.trim()
        ? input.fontFamily.trim()
        : base.fontFamily,
    fontSizePt: clamp(
      Number(input.fontSizePt),
      MIN_FONT_SIZE_PT,
      MAX_FONT_SIZE_PT,
      base.fontSizePt ?? DEFAULT_PAGE_LAYOUT.fontSizePt,
    ),
    fontWeight:
      Number.isFinite(Number(input.fontWeight)) && Number(input.fontWeight) > 0
        ? clamp(Number(input.fontWeight), 100, 900, base.fontWeight ?? 400)
        : base.fontWeight,
    fontStyle,
    align,
    lineHeight: clamp(
      Number(input.lineHeight),
      MIN_LINE_HEIGHT,
      MAX_LINE_HEIGHT,
      base.lineHeight ?? DEFAULT_PAGE_LAYOUT.lineHeight,
    ),
    color: cleanColor(input.color) ?? base.color,
    textTransform,
    marginTopPt: clamp(
      Number(input.marginTopPt),
      0,
      200,
      base.marginTopPt ?? 0,
    ),
    marginBottomPt: clamp(
      Number(input.marginBottomPt),
      0,
      200,
      base.marginBottomPt ?? 0,
    ),
  };

  // Drop undefined values so persisted JSON stays compact and stable.
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  ) as BlockStyle;
}

function normalizeStyles(input: DocumentStyles | undefined): DocumentStyles {
  const styles: DocumentStyles = {};
  for (const key of BLOCK_KEYS) {
    const normalized = normalizeBlockStyle(input?.[key], DEFAULT_STYLES[key]);
    if (normalized) styles[key] = normalized;
  }
  return styles;
}

/** Coerce arbitrary persisted/partial data into a safe PageLayout. */
export function normalizePageLayout(input: unknown): PageLayout {
  const raw = (input ?? {}) as Partial<PageLayout> & {
    margins?: Partial<Record<PageMargin, number>>;
  };
  const pageSize: PageSize =
    raw.pageSize && raw.pageSize in PAGE_SIZES
      ? (raw.pageSize as PageSize)
      : DEFAULT_PAGE_LAYOUT.pageSize;
  const orientation: PageOrientation =
    raw.orientation === "landscape" ? "landscape" : "portrait";
  const margins = (raw.margins ?? {}) as Partial<Record<PageMargin, number>>;
  const fontFamily =
    typeof raw.fontFamily === "string" && raw.fontFamily.trim()
      ? raw.fontFamily.trim()
      : DEFAULT_PAGE_LAYOUT.fontFamily;

  return {
    version: 1,
    canvas: raw.canvas === "page" ? "page" : "notes",
    pageSize,
    orientation,
    margins: {
      top: clamp(
        Number(margins.top),
        MIN_MARGIN_IN,
        MAX_MARGIN_IN,
        DEFAULT_PAGE_LAYOUT.margins.top,
      ),
      right: clamp(
        Number(margins.right),
        MIN_MARGIN_IN,
        MAX_MARGIN_IN,
        DEFAULT_PAGE_LAYOUT.margins.right,
      ),
      bottom: clamp(
        Number(margins.bottom),
        MIN_MARGIN_IN,
        MAX_MARGIN_IN,
        DEFAULT_PAGE_LAYOUT.margins.bottom,
      ),
      left: clamp(
        Number(margins.left),
        MIN_MARGIN_IN,
        MAX_MARGIN_IN,
        DEFAULT_PAGE_LAYOUT.margins.left,
      ),
    },
    fontFamily,
    fontSizePt: clamp(
      Number(raw.fontSizePt),
      MIN_FONT_SIZE_PT,
      MAX_FONT_SIZE_PT,
      DEFAULT_PAGE_LAYOUT.fontSizePt,
    ),
    lineHeight: clamp(
      Number(raw.lineHeight),
      MIN_LINE_HEIGHT,
      MAX_LINE_HEIGHT,
      DEFAULT_PAGE_LAYOUT.lineHeight,
    ),
    styles: normalizeStyles(raw.styles),
    ruleColor: cleanColor(raw.ruleColor),
    header: cleanHeaderFooter(raw.header),
    footer: cleanHeaderFooter(raw.footer),
  };
}

export interface PageDimensions {
  widthIn: number;
  heightIn: number;
  widthPx: number;
  heightPx: number;
}

const LEGACY_LAYOUT_RE =
  /^\s*<!--pages-layout:([A-Za-z0-9+/=\s]+?)-->\s*/;

function fromBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Compatibility with the short-lived layout-in-content format. Strips the
 * comment from the Markdown body and returns the layout so it can be migrated
 * into kind-34579 metadata on first open.
 */
export function extractLegacyLayout(plaintext: string): {
  markdown: string;
  layout?: PageLayout;
} {
  const match = plaintext.match(LEGACY_LAYOUT_RE);
  if (!match) return { markdown: plaintext };

  const markdown = plaintext.slice(match[0].length);
  try {
    return {
      markdown,
      layout: normalizePageLayout(JSON.parse(fromBase64(match[1]))),
    };
  } catch {
    return { markdown };
  }
}

/** Physical + CSS-pixel page dimensions for the given layout (96dpi). */
export function getPageDimensions(layout: PageLayout): PageDimensions {
  const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.A4;
  const landscape = layout.orientation === "landscape";
  const widthIn = landscape ? base.heightIn : base.widthIn;
  const heightIn = landscape ? base.widthIn : base.heightIn;
  return {
    widthIn,
    heightIn,
    widthPx: Math.round(widthIn * 96),
    heightPx: Math.round(heightIn * 96),
  };
}

/** Base body typography in CSS units. */
export function getBaseTypography(layout: PageLayout) {
  return {
    fontFamily: layout.fontFamily,
    fontSizePx: `${(layout.fontSizePt * 96) / 72}px`,
    lineHeight: layout.lineHeight,
  };
}

/** Convert a block style to CSS properties for the on-screen page. */
export function blockStyleToCss(style: BlockStyle | undefined) {
  if (!style) return {};
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSizePt
      ? `${(style.fontSizePt * 96) / 72}px`
      : undefined,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textAlign: style.align,
    lineHeight: style.lineHeight,
    color: style.color,
    textTransform: style.textTransform,
    marginTop: style.marginTopPt
      ? `${(style.marginTopPt * 96) / 72}px`
      : undefined,
    marginBottom: style.marginBottomPt
      ? `${(style.marginBottomPt * 96) / 72}px`
      : undefined,
  };
}

export function layoutEquals(a: PageLayout, b: PageLayout): boolean {
  return JSON.stringify(normalizePageLayout(a)) === JSON.stringify(normalizePageLayout(b));
}
