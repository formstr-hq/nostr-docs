import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A DOCX image. The editor renders the extracted image (data URL), while the
 * raw drawing XML is kept in `xml` so the original package can round-trip.
 */
export const OoxmlImage = Node.create({
  name: "ooxmlImage",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      width: { default: null },
      height: { default: null },
      xml: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "img[data-ooxml-image]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { xml: _xml, ...attrs } = HTMLAttributes;
    return [
      "img",
      mergeAttributes(attrs, {
        "data-ooxml-image": "true",
        class: "ooxml-image",
        style: "max-width: 100%; height: auto;",
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(text: string): void; closeBlock(node: unknown): void },
          node: { attrs?: { src?: string; alt?: string } },
        ) {
          const src = String(node.attrs?.src ?? "");
          const alt = String(node.attrs?.alt ?? "");
          if (src) state.write(`![${alt}](${src})`);
          state.closeBlock(node);
        },
      },
    };
  },
});
