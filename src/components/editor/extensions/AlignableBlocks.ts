import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getHTMLFromFragment } from "@tiptap/core";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";

/**
 * Legacy-compatible paragraph/heading serializers.
 *
 * New documents never create alignment, so they stay pure Markdown. But older
 * documents may already contain `<h1 style="text-align: center">…</h1>` or a
 * paragraph with a text-align style. tiptap-markdown's default paragraph and
 * heading serializers drop node attributes, so without these variants an old
 * document would lose its alignment the first time it was re-saved.
 */

type MarkdownState = {
  write(text: string): void;
  renderInline(node: ProseMirrorNode, escape?: boolean): void;
  closeBlock(node: ProseMirrorNode): void;
  repeat(text: string, count: number): string;
};

function serializeAlignedBlock(
  state: MarkdownState,
  node: ProseMirrorNode,
  tag: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
) {
  const align = node.attrs.textAlign as string | null | undefined;
  if (!align || align === "left") {
    if (tag === "p") {
      state.renderInline(node);
    } else {
      state.write(state.repeat("#", node.attrs.level) + " ");
      state.renderInline(node, false);
    }
    state.closeBlock(node);
    return;
  }

  // Render the whole block as HTML so inline marks (bold, links, legacy font
  // size) survive inside it. Markdown syntax is not parsed inside an HTML block.
  const html = getHTMLFromFragment(Fragment.from(node), node.type.schema);
  state.write(html);
  state.closeBlock(node);
}

export const AlignableParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: ProseMirrorNode) {
          serializeAlignedBlock(state, node, "p");
        },
      },
    };
  },
});

export const AlignableHeading = Heading.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: ProseMirrorNode) {
          const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1));
          serializeAlignedBlock(state, node, `h${level}` as "h1");
        },
      },
    };
  },
});
