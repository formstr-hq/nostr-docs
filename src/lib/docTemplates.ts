import type { JSONContent } from "@tiptap/core";
import type { PageLayout } from "./docLayout";
import { richDocumentToMarkdown } from "./documentFormat";

export type DocumentTemplateKind =
  | "resume"
  | "letterhead"
  | "cover-letter"
  | "invoice"
  | "project-brief"
  | "daily-planner"
  | "weekly-planner"
  | "journal"
  | "journal-index"
  | "meeting-notes";

export type DocumentTemplateCategory = "documents" | "notes";

export interface DocumentTemplate {
  id: string;
  name: string;
  kind: DocumentTemplateKind;
  category: DocumentTemplateCategory;
  description: string;
  /** Accent colour used by the picker preview and template headings. */
  accent: string;
  /** Legacy/Markdown fallback and import representation. */
  markdown: string;
  /** Canonical rich content, when the template needs structure Markdown can't express. */
  doc?: JSONContent;
  layout: PageLayout;
}

// ── Canonical JSON helpers ──────────────────────────────────────────────────

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
const orderedList = (...items: string[]): JSONContent => ({
  type: "orderedList",
  content: items.map(listItem),
});
const quote = (value: string): JSONContent => ({
  type: "blockquote",
  content: [paragraph(text(value))],
});
const rule: JSONContent = { type: "horizontalRule" };
const column = (...content: JSONContent[]): JSONContent => ({
  type: "column",
  content,
});
const columns = (...cols: JSONContent[]): JSONContent => ({
  type: "columns",
  content: cols,
});
const table = (header: string[], rows: string[][]): JSONContent => ({
  type: "table",
  content: [
    {
      type: "tableRow",
      content: header.map((cell) => ({
        type: "tableHeader",
        content: [paragraph(text(cell))],
      })),
    },
    ...rows.map((row) => ({
      type: "tableRow",
      content: row.map((cell) => ({
        type: "tableCell",
        content: cell ? [paragraph(text(cell))] : [paragraph()],
      })),
    })),
  ],
});

const markdownFromDoc = (doc: JSONContent) => richDocumentToMarkdown(doc);

// ── Documents ──────────────────────────────────────────────────────────────

const richResumeDoc: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Alex Morgan"),
    paragraph(
      text(
        "Product designer · alex@example.com · +1 (555) 010-2030 · San Francisco, CA",
      ),
    ),
    rule,
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

const projectBriefDoc: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Project brief"),
    paragraph(text("Project name · Owner · Date")),
    rule,
    columns(
      column(
        heading(2, "Goal"),
        paragraph(
          text(
            "Describe the outcome this project should create and why it matters now. Keep it to one or two sentences.",
          ),
        ),
        heading(2, "Scope"),
        bullets(
          "In scope: the work this team owns",
          "Out of scope: adjacent work that stays with another team",
          "Assumptions and dependencies",
        ),
        heading(2, "Success metrics"),
        bullets(
          "Primary metric and target",
          "Secondary metric and guardrail",
          "How and when we will measure it",
        ),
      ),
      column(
        heading(2, "Timeline"),
        bullets(
          "Week 1 — discovery and alignment",
          "Week 2–3 — design and prototype",
          "Week 4 — build and validate",
          "Week 5 — launch and review",
        ),
        heading(2, "Team"),
        bullets("Owner", "Design", "Engineering", "Reviewers"),
        heading(2, "Risks"),
        bullets(
          "What could block the launch?",
          "What is the mitigation?",
          "What is the decision date?",
        ),
      ),
    ),
    heading(2, "Background"),
    paragraph(
      text(
        "Add context, links and decisions here so someone joining later can understand the project without a meeting.",
      ),
    ),
  ],
};

// ── Notes ──────────────────────────────────────────────────────────────────

const dailyPlannerDoc: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Daily plan"),
    paragraph(
      text(
        "Date: ____________________   ·   Focus: ____________________",
      ),
    ),
    rule,
    columns(
      column(
        heading(2, "Top priorities"),
        bullets(
          "Finish the onboarding flow",
          "Review the design-system PR",
          "Write the weekly update",
        ),
        heading(2, "Schedule"),
        table(
          ["Time", "Focus"],
          [
            ["09:00", "Deep work"],
            ["11:00", "Team sync"],
            ["14:00", "Design review"],
            ["16:00", "Inbox and follow-ups"],
          ],
        ),
      ),
      column(
        heading(2, "Notes"),
        paragraph(
          text(
            "Capture decisions, blockers and follow-ups here. Keep it short enough to act on tomorrow.",
          ),
        ),
        heading(2, "Intentions"),
        bullets(
          "Protect a two-hour focus block",
          "Leave work at a good stopping point",
        ),
        heading(2, "Evening reflection"),
        quote("What went well today?"),
        quote("What will I carry into tomorrow?"),
      ),
    ),
  ],
};

const weeklyPlannerDoc: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Weekly plan"),
    paragraph(
      text(
        "Week of ____________________   ·   Theme: ____________________",
      ),
    ),
    rule,
    heading(2, "This week's focus"),
    paragraph(
      text(
        "Choose one outcome that matters more than the rest, then protect time for it.",
      ),
    ),
    heading(2, "Daily plan"),
    table(
      ["Day", "Focus", "Notes"],
      [
        ["Monday", "Plan the week", "Weekly sync"],
        ["Tuesday", "Deep work", "Design review"],
        ["Wednesday", "Deep work", "1:1s"],
        ["Thursday", "Build", "Demo prep"],
        ["Friday", "Ship", "Retro"],
        ["Saturday", "Rest", ""],
        ["Sunday", "Rest", ""],
      ],
    ),
    columns(
      column(
        heading(2, "Top priorities"),
        bullets(
          "Most important outcome",
          "Second priority",
          "Something to finish, not just start",
        ),
      ),
      column(
        heading(2, "Notes and wins"),
        paragraph(
          text(
            "Use this space for carry-over items, decisions and the small wins worth remembering.",
          ),
        ),
        heading(2, "Wins"),
        bullets("One thing that worked", "One thing to repeat"),
      ),
    ),
  ],
};

const journalDoc: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Journal"),
    paragraph(text("Date: ____________   ·   Mood: ____________")),
    rule,
    heading(2, "Today I'm grateful for"),
    bullets("A person", "A moment", "Something small"),
    heading(2, "What happened"),
    paragraph(
      text(
        "Write the day without judging it. What did you notice, who did you talk to, what changed?",
      ),
    ),
    heading(2, "What I learned"),
    paragraph(
      text(
        "One idea, correction or question you want to keep. Be specific enough that future-you can use it.",
      ),
    ),
    heading(2, "Tomorrow"),
    bullets("One thing to look forward to", "One thing to make easier"),
    rule,
    quote("A thought to keep:"),
  ],
};

const journalIndexDoc: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Journal index"),
    paragraph(
      text(
        "A home for your daily entries. Put the cursor under Entries and run /journal-entry to create today's page and link it here.",
      ),
    ),
    rule,
    heading(2, "Entries"),
    paragraph(
      text(
        "No entries yet. Use /journal-entry, or Link to another page from the More actions menu.",
      ),
    ),
    rule,
    quote("One page at a time."),
  ],
};

const meetingNotesDoc: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Meeting notes"),
    paragraph(
      text(
        "Project · Date · Facilitator · Location",
      ),
    ),
    rule,
    heading(2, "Attendees"),
    bullets("Name — role", "Name — role", "Name — role"),
    heading(2, "Agenda"),
    orderedList(
      "Review the current state",
      "Decide the open questions",
      "Assign owners and dates",
    ),
    heading(2, "Decisions"),
    bullets("Decision and rationale", "What changes as a result"),
    heading(2, "Action items"),
    table(
      ["Owner", "Action", "Due"],
      [
        ["Alex", "Send the notes", "Today"],
        ["Jordan", "Follow up with design", "Friday"],
        ["Sam", "Update the timeline", "Next week"],
      ],
    ),
    heading(2, "Notes"),
    paragraph(
      text(
        "Capture the context that will not be obvious from the decisions alone. Link related docs and threads.",
      ),
    ),
  ],
};

// ── Template catalog ───────────────────────────────────────────────────────

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "resume",
    name: "Resume",
    kind: "resume",
    category: "documents",
    description: "One-page resume with a right-hand skills sidebar.",
    accent: "#2563EB",
    doc: richResumeDoc,
    markdown: `# Alex Morgan
Product designer · alex@example.com · +1 (555) 010-2030 · San Francisco, CA

---

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
      ruleColor: "#2563EB",
      styles: {
        h1: { fontSizePt: 25, fontWeight: 800, align: "center", lineHeight: 1.1, marginBottomPt: 2, color: "#0F172A" },
        h2: {
          fontSizePt: 11,
          fontWeight: 800,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 13,
          marginBottomPt: 5,
          color: "#2563EB",
        },
        h3: { fontSizePt: 11, fontWeight: 700, marginTopPt: 7, marginBottomPt: 2, color: "#1E3A8A" },
        paragraph: { align: "left", lineHeight: 1.45, marginBottomPt: 2 },
        blockquote: { fontStyle: "italic" },
      },
    },
  },
  {
    id: "letterhead",
    name: "Letterhead",
    kind: "letterhead",
    category: "documents",
    description: "Formal letter with a company header, footer and classic serif type.",
    accent: "#B45309",
    markdown: `# Brand partnership proposal

March 14, 2026

---

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
      ruleColor: "#B45309",
      styles: {
        h1: { fontSizePt: 19, fontWeight: 700, align: "left", marginTopPt: 0, marginBottomPt: 10, color: "#B45309" },
        h2: { fontSizePt: 12, fontWeight: 700, align: "left", marginTopPt: 14, marginBottomPt: 4, color: "#92400E" },
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
    category: "documents",
    description: "Clean A4 cover letter with contact details and a formal sign-off.",
    accent: "#0F766E",
    markdown: `# Cover letter

**Alex Morgan**  
San Francisco, CA · alex@example.com · +1 (555) 010-2030

March 14, 2026

---

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
      ruleColor: "#0F766E",
      styles: {
        h1: { fontSizePt: 20, fontWeight: 700, align: "left", marginTopPt: 0, marginBottomPt: 10, color: "#0F766E" },
        h2: { fontSizePt: 11, fontWeight: 700, align: "left", marginTopPt: 12, marginBottomPt: 4, color: "#115E59" },
        paragraph: { align: "left", lineHeight: 1.55, marginBottomPt: 7 },
        blockquote: { fontStyle: "italic" },
      },
    },
  },
  {
    id: "invoice",
    name: "Invoice",
    kind: "invoice",
    category: "documents",
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
      ruleColor: "#7C3AED",
      styles: {
        h1: { fontSizePt: 24, fontWeight: 800, align: "left", marginTopPt: 0, marginBottomPt: 8, color: "#6D28D9" },
        h2: {
          fontSizePt: 11,
          fontWeight: 800,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 14,
          marginBottomPt: 5,
          color: "#7C3AED",
        },
        paragraph: { align: "left", lineHeight: 1.4, marginBottomPt: 3 },
        blockquote: { fontStyle: "italic" },
      },
      footer: { center: "Thank you for your business." },
    },
  },
  {
    id: "project-brief",
    name: "Project brief",
    kind: "project-brief",
    category: "documents",
    description: "Goals, scope, milestones, team and risks in a two-column brief.",
    accent: "#7C3AED",
    doc: projectBriefDoc,
    markdown: markdownFromDoc(projectBriefDoc),
    layout: {
      version: 1,
      canvas: "page",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 },
      fontFamily: "Inter",
      fontSizePt: 10.5,
      lineHeight: 1.5,
      ruleColor: "#7C3AED",
      styles: {
        h1: { fontSizePt: 25, fontWeight: 800, align: "left", marginTopPt: 0, marginBottomPt: 8, color: "#5B21B6" },
        h2: {
          fontSizePt: 11,
          fontWeight: 800,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 14,
          marginBottomPt: 5,
          color: "#7C3AED",
        },
        paragraph: { align: "left", lineHeight: 1.5, marginBottomPt: 5 },
        blockquote: { fontStyle: "italic" },
      },
    },
  },

  // ── Notes ────────────────────────────────────────────────────────────────

  {
    id: "daily-planner",
    name: "Daily planner",
    kind: "daily-planner",
    category: "notes",
    description: "Priorities, schedule, notes and an evening reflection.",
    accent: "#4F46E5",
    doc: dailyPlannerDoc,
    markdown: markdownFromDoc(dailyPlannerDoc),
    layout: {
      version: 1,
      canvas: "page",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 0.7, right: 0.7, bottom: 0.7, left: 0.7 },
      fontFamily: "Inter",
      fontSizePt: 10.5,
      lineHeight: 1.5,
      ruleColor: "#4F46E5",
      styles: {
        h1: { fontSizePt: 24, fontWeight: 800, align: "left", marginTopPt: 0, marginBottomPt: 8, color: "#312E81" },
        h2: {
          fontSizePt: 11,
          fontWeight: 800,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 14,
          marginBottomPt: 5,
          color: "#4F46E5",
        },
        h3: { fontSizePt: 11, fontWeight: 700, marginTopPt: 8, marginBottomPt: 2, color: "#3730A3" },
        paragraph: { align: "left", lineHeight: 1.5, marginBottomPt: 5 },
        blockquote: { fontStyle: "italic", color: "#4338CA" },
      },
    },
  },
  {
    id: "weekly-planner",
    name: "Weekly planner",
    kind: "weekly-planner",
    category: "notes",
    description: "Week at a glance with daily focus, priorities and wins.",
    accent: "#0F766E",
    doc: weeklyPlannerDoc,
    markdown: markdownFromDoc(weeklyPlannerDoc),
    layout: {
      version: 1,
      canvas: "page",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 },
      fontFamily: "Inter",
      fontSizePt: 10,
      lineHeight: 1.45,
      ruleColor: "#0F766E",
      styles: {
        h1: { fontSizePt: 24, fontWeight: 800, align: "left", marginTopPt: 0, marginBottomPt: 8, color: "#115E59" },
        h2: {
          fontSizePt: 11,
          fontWeight: 800,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 12,
          marginBottomPt: 5,
          color: "#0F766E",
        },
        paragraph: { align: "left", lineHeight: 1.45, marginBottomPt: 4 },
        blockquote: { fontStyle: "italic" },
      },
    },
  },
  {
    id: "journal",
    name: "Journal",
    kind: "journal",
    category: "notes",
    description: "Reflective journal with gratitude, highlights and tomorrow's intention.",
    accent: "#BE123C",
    doc: journalDoc,
    markdown: markdownFromDoc(journalDoc),
    layout: {
      version: 1,
      canvas: "notes",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 0.9, right: 0.9, bottom: 0.9, left: 0.9 },
      fontFamily: "Georgia",
      fontSizePt: 11,
      lineHeight: 1.7,
      ruleColor: "#BE123C",
      styles: {
        h1: { fontSizePt: 24, fontWeight: 700, align: "left", marginTopPt: 0, marginBottomPt: 8, color: "#9F1239" },
        h2: {
          fontSizePt: 11,
          fontWeight: 700,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 18,
          marginBottomPt: 6,
          color: "#BE123C",
        },
        paragraph: { align: "left", lineHeight: 1.7, marginBottomPt: 6 },
        blockquote: { fontStyle: "italic", color: "#9F1239" },
      },
    },
  },
  {
    id: "journal-index",
    name: "Journal index",
    kind: "journal-index",
    category: "notes",
    description: "Front page for daily entries; add one with /journal-entry.",
    accent: "#BE123C",
    doc: journalIndexDoc,
    markdown: markdownFromDoc(journalIndexDoc),
    layout: {
      version: 1,
      canvas: "notes",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 0.9, right: 0.9, bottom: 0.9, left: 0.9 },
      fontFamily: "Georgia",
      fontSizePt: 11,
      lineHeight: 1.7,
      ruleColor: "#BE123C",
      styles: {
        h1: { fontSizePt: 24, fontWeight: 700, align: "left", marginTopPt: 0, marginBottomPt: 8, color: "#9F1239" },
        h2: {
          fontSizePt: 11,
          fontWeight: 700,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 18,
          marginBottomPt: 6,
          color: "#BE123C",
        },
        paragraph: { align: "left", lineHeight: 1.7, marginBottomPt: 6 },
        blockquote: { fontStyle: "italic", color: "#9F1239" },
      },
    },
  },
  {
    id: "meeting-notes",
    name: "Meeting notes",
    kind: "meeting-notes",
    category: "notes",
    description: "Attendees, agenda, decisions and action items.",
    accent: "#0E7490",
    doc: meetingNotesDoc,
    markdown: markdownFromDoc(meetingNotesDoc),
    layout: {
      version: 1,
      canvas: "notes",
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 0.75, right: 0.75, bottom: 0.75, left: 0.75 },
      fontFamily: "Inter",
      fontSizePt: 10.5,
      lineHeight: 1.45,
      ruleColor: "#0E7490",
      styles: {
        h1: { fontSizePt: 24, fontWeight: 800, align: "left", marginTopPt: 0, marginBottomPt: 8, color: "#155E75" },
        h2: {
          fontSizePt: 11,
          fontWeight: 800,
          align: "left",
          textTransform: "uppercase",
          marginTopPt: 14,
          marginBottomPt: 5,
          color: "#0E7490",
        },
        paragraph: { align: "left", lineHeight: 1.45, marginBottomPt: 5 },
        blockquote: { fontStyle: "italic" },
      },
    },
  },
];
