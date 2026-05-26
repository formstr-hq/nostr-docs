import { Extension } from "@tiptap/core";

const INDENT_STEP = 24; // px per indent level
const MAX_INDENT = 8;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

const INDENTABLE = new Set(["paragraph", "heading"]);

export const Indent = Extension.create({
  name: "indent",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              const raw = (el as HTMLElement).style.paddingLeft;
              if (!raw) return 0;
              const px = parseFloat(raw);
              return isNaN(px) ? 0 : Math.round(px / INDENT_STEP);
            },
            renderHTML: (attrs) => {
              if (!attrs.indent) return {};
              return { style: `padding-left: ${attrs.indent * INDENT_STEP}px` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          let changed = false;
          state.doc.nodesBetween(
            selection.from,
            selection.to,
            (node, pos) => {
              if (!INDENTABLE.has(node.type.name)) return;
              const current = node.attrs.indent ?? 0;
              if (current >= MAX_INDENT) return;
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  indent: current + 1,
                });
              }
              changed = true;
            }
          );
          return changed;
        },
      outdent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          let changed = false;
          state.doc.nodesBetween(
            selection.from,
            selection.to,
            (node, pos) => {
              if (!INDENTABLE.has(node.type.name)) return;
              const current = node.attrs.indent ?? 0;
              if (current <= 0) return;
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  indent: current - 1,
                });
              }
              changed = true;
            }
          );
          return changed;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        // Let list items handle Tab themselves
        if (editor.isActive("listItem")) return false;
        return editor.commands.indent();
      },
      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("listItem")) return false;
        return editor.commands.outdent();
      },
    };
  },
});
