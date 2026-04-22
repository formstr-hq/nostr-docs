// MIT License — Copyright (c) 2023-2024 Jeet Mandaliya (sereneinserenade)
// Vendored from https://github.com/sereneinserenade/tiptap-search-and-replace

import type { Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface SearchAndReplaceOptions {
  searchResultClass: string;
  disableRegex: boolean;
}

interface SearchAndReplaceStorage {
  searchTerm: string;
  replaceTerm: string;
  results: Range[];
  lastSearchTerm: string;
  caseSensitive: boolean;
  lastCaseSensitive: boolean;
  resultIndex: number;
  lastResultIndex: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearchTerm: (searchTerm: string) => ReturnType;
      setReplaceTerm: (replaceTerm: string) => ReturnType;
      setCaseSensitive: (caseSensitive: boolean) => ReturnType;
      resetIndex: () => ReturnType;
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
      replace: () => ReturnType;
      replaceAll: () => ReturnType;
    };
  }
}

interface TextNodesWithPosition {
  text: string;
  pos: number;
}

function getStorage(editor: { storage: unknown }): SearchAndReplaceStorage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor as any).storage.searchAndReplace as SearchAndReplaceStorage;
}

const getRegex = (
  s: string,
  disableRegex: boolean,
  caseSensitive: boolean,
): RegExp => {
  return RegExp(
    disableRegex ? s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : s,
    caseSensitive ? "gu" : "gui",
  );
};

function processSearches(
  doc: PMNode,
  searchTerm: RegExp,
  searchResultClass: string,
  resultIndex: number,
): { decorationsToReturn: DecorationSet; results: Range[] } {
  const decorations: Decoration[] = [];
  const results: Range[] = [];

  let textNodesWithPosition: TextNodesWithPosition[] = [];
  let index = 0;

  if (!searchTerm) {
    return { decorationsToReturn: DecorationSet.empty, results: [] };
  }

  doc?.descendants((node, pos) => {
    if (node.isText) {
      if (textNodesWithPosition[index]) {
        textNodesWithPosition[index] = {
          text: textNodesWithPosition[index].text + node.text,
          pos: textNodesWithPosition[index].pos,
        };
      } else {
        textNodesWithPosition[index] = { text: `${node.text}`, pos };
      }
    } else {
      index += 1;
    }
  });

  textNodesWithPosition = textNodesWithPosition.filter(Boolean);

  for (const element of textNodesWithPosition) {
    const { text, pos } = element;
    const matches = Array.from(text.matchAll(searchTerm)).filter(
      ([matchText]) => matchText.trim(),
    );
    for (const m of matches) {
      if (m[0] === "") break;
      if (m.index !== undefined) {
        results.push({ from: pos + m.index, to: pos + m.index + m[0].length });
      }
    }
  }

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const className =
      i === resultIndex
        ? `${searchResultClass} ${searchResultClass}-current`
        : searchResultClass;
    decorations.push(Decoration.inline(r.from, r.to, { class: className }));
  }

  return {
    decorationsToReturn: DecorationSet.create(doc, decorations),
    results,
  };
}

const rebaseNextResult = (
  replaceTerm: string,
  index: number,
  lastOffset: number,
  results: Range[],
): [number, Range[]] | null => {
  const nextIndex = index + 1;
  if (!results[nextIndex]) return null;
  const { from: currentFrom, to: currentTo } = results[index];
  const offset = currentTo - currentFrom - replaceTerm.length + lastOffset;
  const { from, to } = results[nextIndex];
  results[nextIndex] = { to: to - offset, from: from - offset };
  return [offset, results];
};

const searchAndReplacePluginKey = new PluginKey(
  "searchAndReplacePlugin",
);

export const SearchAndReplace = Extension.create<
  SearchAndReplaceOptions,
  SearchAndReplaceStorage
>({
  name: "searchAndReplace",

  addOptions() {
    return {
      searchResultClass: "search-result",
      disableRegex: true,
    };
  },

  addStorage() {
    return {
      searchTerm: "",
      replaceTerm: "",
      results: [],
      lastSearchTerm: "",
      caseSensitive: false,
      lastCaseSensitive: false,
      resultIndex: 0,
      lastResultIndex: 0,
    };
  },

  addCommands() {
    return {
      setSearchTerm:
        (searchTerm: string) =>
        ({ editor }) => {
          getStorage(editor).searchTerm = searchTerm;
          return false;
        },
      setReplaceTerm:
        (replaceTerm: string) =>
        ({ editor }) => {
          getStorage(editor).replaceTerm = replaceTerm;
          return false;
        },
      setCaseSensitive:
        (caseSensitive: boolean) =>
        ({ editor }) => {
          getStorage(editor).caseSensitive = caseSensitive;
          return false;
        },
      resetIndex:
        () =>
        ({ editor }) => {
          getStorage(editor).resultIndex = 0;
          return false;
        },
      nextSearchResult:
        () =>
        ({ editor }) => {
          const s = getStorage(editor);
          const nextIndex = s.resultIndex + 1;
          s.resultIndex = s.results[nextIndex] ? nextIndex : 0;
          return false;
        },
      previousSearchResult:
        () =>
        ({ editor }) => {
          const s = getStorage(editor);
          const prevIndex = s.resultIndex - 1;
          s.resultIndex = s.results[prevIndex]
            ? prevIndex
            : s.results.length - 1;
          return false;
        },
      replace:
        () =>
        ({ editor, state, dispatch }) => {
          const { replaceTerm, results, resultIndex } = getStorage(editor);
          const current = results[resultIndex] ?? results[0];
          if (!current) return false;
          if (dispatch) dispatch(state.tr.insertText(replaceTerm, current.from, current.to));
          return false;
        },
      replaceAll:
        () =>
        ({ editor, tr, dispatch }) => {
          const { replaceTerm, results } = getStorage(editor);
          let offset = 0;
          let copy = results.slice();
          if (!copy.length) return false;
          for (let i = 0; i < copy.length; i += 1) {
            const { from, to } = copy[i];
            tr.insertText(replaceTerm, from, to);
            const rebased = rebaseNextResult(replaceTerm, i, offset, copy);
            if (!rebased) continue;
            offset = rebased[0];
            copy = rebased[1];
          }
          if (dispatch) dispatch(tr);
          return false;
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { searchResultClass, disableRegex } = this.options;

    return [
      new Plugin({
        key: searchAndReplacePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply({ doc, docChanged }, oldState) {
            const s = getStorage(editor);

            if (
              !docChanged &&
              s.lastSearchTerm === s.searchTerm &&
              s.lastCaseSensitive === s.caseSensitive &&
              s.lastResultIndex === s.resultIndex
            )
              return oldState;

            s.lastSearchTerm = s.searchTerm;
            s.lastCaseSensitive = s.caseSensitive;
            s.lastResultIndex = s.resultIndex;

            if (!s.searchTerm) {
              s.results = [];
              return DecorationSet.empty;
            }

            const { decorationsToReturn, results } = processSearches(
              doc,
              getRegex(s.searchTerm, disableRegex, s.caseSensitive),
              searchResultClass,
              s.resultIndex,
            );

            s.results = results;
            return decorationsToReturn;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
