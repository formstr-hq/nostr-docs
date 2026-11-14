import { Node, mergeAttributes, getHTMLFromFragment } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * A two-column section for Google-Docs-style page layouts (resume sidebars,
 * letterhead address blocks, etc.). It is canonical ProseMirror content, not a
 * visual trick: the columns and their nested blocks are part of the document
 * and round-trip through the rich JSON kind.
 */
export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-column": "true",
        class: "doc-column",
      }),
      0,
    ];
  },
});

type MarkdownState = {
  write(text: string): void;
  closeBlock(node: ProseMirrorNode): void;
};

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2}",
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-columns": "2",
        class: "doc-columns",
      }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // Markdown has no column model. Serialize the whole section as HTML so
        // the Markdown export adapter preserves it instead of flattening it.
        serialize(state: MarkdownState, node: ProseMirrorNode) {
          const html = getHTMLFromFragment(Fragment.from(node), node.type.schema);
          state.write(html);
          state.closeBlock(node);
        },
      },
    };
  },

  addCommands() {
    return {
      setColumns:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              { type: "column", content: [{ type: "paragraph" }] },
              { type: "column", content: [{ type: "paragraph" }] },
            ],
          }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      setColumns: () => ReturnType;
    };
  }
}
