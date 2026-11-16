import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A block-level page break. It is content, not layout: the author decides where
 * a page ends, while page size/margins live in the document's PageLayout.
 *
 * It serializes through tiptap-markdown's HTML-node fallback, so the Markdown
 * snapshot contains `<div data-page-break="true"></div>` and round-trips.
 */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [
      { tag: 'div[data-page-break]' },
      { tag: 'hr[data-page-break]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-break": "true",
        class: "page-break",
      }),
    ];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}
