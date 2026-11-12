import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Opaque OOXML block that the rich model cannot represent yet (merged tables,
 * drawings, fields, tracked changes, content controls, …). The raw XML lives in
 * the node attrs and is written back by the OOXML adapter. The editor shows a
 * small placeholder instead of silently dropping the content.
 */
export const OoxmlBlock = Node.create({
  name: "ooxmlBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      xml: { default: "" },
      label: { default: "Word content" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-ooxml-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const label = String(HTMLAttributes.label ?? "Word content");
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-ooxml-block": "true",
        class: "ooxml-block",
      }),
      [
        "div",
        { class: "ooxml-block-label" },
        label === "Word content"
          ? "Word content preserved"
          : `Word content preserved: ${label}`,
      ],
      [
        "div",
        { class: "ooxml-block-hint" },
        "This block is not editable yet; it will be preserved on DOCX export.",
      ],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write(text: string): void; closeBlock(node: unknown): void }, node: { attrs?: { label?: string } }) {
          const label = String(node.attrs?.label ?? "Word content");
          state.write(
            `<div data-ooxml-block="true" data-label="${label.replace(/"/g, "&quot;")}"></div>`,
          );
          state.closeBlock(node);
        },
      },
    };
  },
});
