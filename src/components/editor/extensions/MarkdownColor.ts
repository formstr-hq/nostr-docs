import { Color } from "@tiptap/extension-text-style";

type MarkdownState = unknown;
type MarkdownMark = { attrs?: { color?: string } };

/**
 * Color mark with a Markdown serializer. The canonical rich document stores the
 * color inline on the selected text; when we project to Markdown we emit a
 * span so previews, backups and exports keep it. Markdown parsing restores the
 * mark from the same span (markdown-it runs with html: true).
 */
export const MarkdownColor = Color.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_state: MarkdownState, mark: MarkdownMark) {
            return mark.attrs?.color
              ? `<span style="color: ${mark.attrs.color}">`
              : "";
          },
          close(_state: MarkdownState, mark: MarkdownMark) {
            return mark.attrs?.color ? "</span>" : "";
          },
        },
        parse: {},
      },
    };
  },
});
