import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

export type SlashCommandItem = {
  id: string;
  label: string;
  description: string;
  icon: string; // emoji — simple, no MUI dep inside the extension
  keywords: string[];
  command: (opts: { editor: ReturnType<typeof import("@tiptap/core").Editor.prototype.chain>; range: { from: number; to: number } }) => void;
};

export type SlashCommandOptions = {
  suggestion: Omit<SuggestionOptions<SlashCommandItem>, "editor">;
};

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command({ editor, range, props }) {
          props.command({ editor: editor.chain(), range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
