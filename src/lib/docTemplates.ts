import type { JSONContent } from "@tiptap/core";
import type { PageLayout } from "./docLayout";

export type DocumentTemplateKind =
  | "resume"
  | "letterhead"
  | "cover-letter"
  | "invoice";

export interface DocumentTemplate {
  id: string;
  name: string;
  kind: DocumentTemplateKind;
  description: string;
  /** Accent colour used by the picker preview. */
  accent: string;
  /** Legacy/Markdown fallback and import representation. */
  markdown: string;
  /** Canonical rich content, when the template needs structure Markdown can't express. */
  doc?: JSONContent;
  layout: PageLayout;
}

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks?.length ? { marks } : {}),
});
const bold = (value: string) => text(value, [{ type: "bold" }]);
const italic = (value: string) => text(value, [{ type: "italic" }]);
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});
const heading = (level: number, value: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const listItem = (value: string): JSONContent => ({
  type: "listItem",
  content: [paragraph(text(value))],
});
const bullets = (...items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map(listItem),
});
const column = (...content: JSONContent[]): JSONContent => ({
  type: "column",
  content,
});
const columns = (...cols: JSONContent[]): JSONContent => ({
  type: "columns",
  content: cols,
});

/**
 * The rich resume uses a canonical two-column section, so the skills sidebar is
 * real document structure (not a table or a CSS trick). This is the visible
 * difference the rich kind unlocks over the Markdown templates.
 */
const richResumeDoc: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Alex Morgan"),
    paragraph(
      text(
        "Product designer · alex@example.com · +1 (555) 010-2030 · San Francisco, CA",
      ),
    ),
    columns(
      column(
        heading(2, "Summary"),
        paragraph(
          text(
            "Product designer with eight years of experience turning complex workflows into clear, human interfaces. I lead design from research through shipped product, and build systems that help teams move faster without losing craft.",
          ),
        ),
        heading(2, "Experience"),
        paragraph(bold("Senior Product Designer · Northwind Studio")),
        paragraph(italic("2021 — Present · San Francisco, CA")),
        bullets(
          "Led the redesign of the core reporting experience, lifting weekly active usage by 34%.",
          "Built a token-based design system now used by four product teams.",
          "Partnered with research to cut onboarding time from 18 minutes to 6.",
        ),
        paragraph(bold("Product Designer · Bright Labs")),
        paragraph(italic("2018 — 2021 · Remote")),
        bullets(
          "Shipped the first version of a collaborative editor used by 40,000 people.",
          "Created the accessibility baseline adopted across the product suite.",
        ),
        heading(2, "Education"),
        paragraph(bold("BFA, Interaction Design")),
        paragraph(text("California College of the Arts · 2014 — 2018")),
      ),
      column(
        heading(2, "Skills"),
        bullets(
          "Product strategy",
          "Design systems",
          "Prototyping",
          "User research",
        ),
        heading(2, "Tools"),
        bullets("Figma", "Framer", "Linear", "Notion", "GitHub"),
        heading(2, "Contact"),
        paragraph(text("alex@example.com")),
        paragraph(text("+1 (555) 010-2030")),
        paragraph(text("San Francisco, CA")),
      ),
    ),
  ],
};

/**
 * Small starter documents that show off the page canvas, typography, page
 * header/footer and page-aware exports. Templates without a `doc` are converted
 * from Markdown at selection time; rich ones carry canonical ProseMirror JSON.
 */
export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "resume",
    name: "Resume",
    kind: "resume",
    description: "One-page resume with a right-hand skills sidebar.",
    accent: "#2563EB",
    doc: richResumeDoc,
    markdown: `# Alex Morgan
Product designer · alex@example.com · +1 (555) 010-2030 · San Francisco, CA

## Summary
Product designer with eight years of experience turning complex workflows into clear, human interfaces. I lead design from research through shipped product, and build systems that help teams move faster without losing craft.

## Experience

### Senior Product Designer · Northwind Studio
*2021 — Present · San Francisco, CA*
- Led the redesign of the core reporting experience, lifting weekly active usage by 34%.
- Built a token-based design system now used by four product teams.
- Partnered with research to cut onboarding time from 18 minutes to 6.

### Product Designer · Bright Labs
*2018 — 2021 · Remote*
- Shipped the first version of a collaborative editor used by 40,000 people.
- Created the accessibility baseline adopted across the product suite.

## Education
**BFA, Interaction Design** · California College of the Arts
*2014 — 2018*

## Skills
Product strategy · Design systems · Prototyping · User research · Figma · Webflow`,
    layout: {
      version: 1,
      canvas: "page",
      pageSize: "Letter",
      orientation: "portrait",
      margins: { top: 0.65, right: 0.7, bottom: 0.6, left: 0.7 },
      fontFamily: "Inter",
      fontSizePt: 10.5,
      lineHeight: 1.45,
      styles: {
        h1: { fontSizePt: 25, fontWeight: 800, align: "center", lineHeight: 1.1, marginBottomPt: 2 },
        h2: {
          fontSizePt: 11,
          fontWeight: 800,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 13,
          marginBottomPt: 5,
        },
        h3: { fontSizePt: 11, fontWeight: 700, marginTopPt: 7, marginBottomPt: 2 },
        paragraph: { align: "left", lineHeight: 1.45, marginBottomPt: 2 },
        blockquote: { fontStyle: "italic" },
      },
    },
  },
  {
    id: "letterhead",
    name: "Letterhead",
    kind: "letterhead",
    description: "Formal letter with a company header, footer and classic serif type.",
    accent: "#B45309",
    markdown: `# Brand partnership proposal

March 14, 2026

**Jordan Lee**
Head of Brand, Acme Inc.
500 Howard Street
San Francisco, CA 94105

Dear Jordan,

Thank you for taking the time to walk me through the next chapter for Acme. I've been thinking about the brand refresh since we met, and I'd love to help shape it.

Northwind Studio works with teams that are ready to move from a collection of assets to a coherent visual language. We start with a short audit, align on the story you want the brand to tell, and then build the identity and system around it.

For this engagement we would focus on three things:

- A refreshed visual identity, from logo to typography and colour.
- A lightweight brand book the team can actually use.
- A design-system handoff for product and marketing.

The work would run for eight weeks, with a small core team and weekly reviews. I've attached a scope and timeline, and I'm happy to adjust either before we start.

I'd love to walk you through the approach in person. Would next Tuesday or Thursday work for you?

Sincerely,

**Alex Morgan**
Founder, Northwind Studio`,
    layout: {
      version: 1,
      canvas: "page",
      pageSize: "Letter",
      orientation: "portrait",
      margins: { top: 1.35, right: 1, bottom: 0.9, left: 1 },
      fontFamily: "Georgia",
      fontSizePt: 11,
      lineHeight: 1.55,
      styles: {
        h1: { fontSizePt: 19, fontWeight: 700, align: "left", marginTopPt: 0, marginBottomPt: 10 },
        h2: { fontSizePt: 12, fontWeight: 700, align: "left", marginTopPt: 14, marginBottomPt: 4 },
        paragraph: { align: "left", lineHeight: 1.55, marginBottomPt: 6 },
        blockquote: { fontStyle: "italic" },
      },
      header: { left: "NORTHWIND STUDIO", right: "hello@northwind.studio" },
      footer: { center: "northwind.studio · 123 Market Street, San Francisco" },
    },
  },
  {
    id: "cover-letter",
    name: "Cover letter",
    kind: "cover-letter",
    description: "Clean A4 cover letter with contact details and a formal sign-off.",
    accent: "#0F766E",
    markdown: `# Cover letter

**Alex Morgan**
San Francisco, CA · alex@example.com · +1 (555) 010-2030

March 14, 2026

Hiring Team
Northwind Studio
123 Market Street
San Francisco, CA 94105

Dear Hiring Manager,

I'm writing to apply for the Senior Product Designer role. Over the past eight years I've worked at the point where complex systems meet everyday use: reporting tools, collaborative editors, and the design systems that keep large products coherent.

At Bright Labs I shipped the first version of a collaborative editor used by 40,000 people. At Northwind Studio I led the redesign of our core reporting experience, lifting weekly active usage by 34%, and built a token-based design system now used by four product teams. I care about the unglamorous parts of the work too: clear documentation, accessible defaults, and handoffs that let engineers move without waiting.

What draws me to Northwind is the ambition to make a category-defining product feel obvious. I'd love to bring my experience in research, systems thinking and hands-on product design to that problem.

Thank you for your time and consideration. I'd welcome the chance to talk through the role and how I could contribute.

Sincerely,

**Alex Morgan**`,
    layout: {
      version: 1,
      canvas: "page",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 1.05, right: 1.05, bottom: 1, left: 1.05 },
      fontFamily: "Inter",
      fontSizePt: 10.5,
      lineHeight: 1.55,
      styles: {
        h1: { fontSizePt: 20, fontWeight: 700, align: "left", marginTopPt: 0, marginBottomPt: 10 },
        paragraph: { align: "left", lineHeight: 1.55, marginBottomPt: 7 },
        blockquote: { fontStyle: "italic" },
      },
    },
  },
  {
    id: "invoice",
    name: "Invoice",
    kind: "invoice",
    description: "A4 invoice with line items, totals and payment details.",
    accent: "#7C3AED",
    markdown: `# Invoice

**Northwind Studio**  
123 Market Street, Suite 400  
San Francisco, CA 94105  
hello@northwind.studio

---

**Billed to**  
Acme Inc.  
500 Howard Street  
San Francisco, CA 94105

**Invoice #** INV-2026-014  
**Issued** March 14, 2026  
**Due** April 14, 2026

## Line items

| Description | Qty | Rate | Amount |
| --- | ---: | ---: | ---: |
| Brand audit and positioning | 1 | $3,500 | $3,500 |
| Visual identity system | 1 | $8,000 | $8,000 |
| Design system handoff | 1 | $2,500 | $2,500 |

**Total due: $14,000**

---

**Payment details**  
Bank transfer · Northwind Studio · Account 000123456 · Routing 021000021  
Please reference INV-2026-014 with your payment.`,
    layout: {
      version: 1,
      canvas: "page",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 },
      fontFamily: "Inter",
      fontSizePt: 10,
      lineHeight: 1.4,
      styles: {
        h1: { fontSizePt: 24, fontWeight: 800, align: "left", marginTopPt: 0, marginBottomPt: 8 },
        h2: {
          fontSizePt: 11,
          fontWeight: 800,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 14,
          marginBottomPt: 5,
        },
        paragraph: { align: "left", lineHeight: 1.4, marginBottomPt: 3 },
        blockquote: { fontStyle: "italic" },
      },
      footer: { center: "Thank you for your business." },
    },
  },
];
