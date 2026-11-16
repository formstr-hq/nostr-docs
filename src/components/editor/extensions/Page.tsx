import { createContext, useContext, type ReactNode } from "react";
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { DocumentPage } from "../DocumentPage";
import type { PageLayout } from "../../../lib/docLayout";

type PageCanvasState = {
  layout: PageLayout;
  viewMode: "fixed" | "responsive";
};

export const PageCanvasContext = createContext<PageCanvasState | null>(null);

export function PageCanvasProvider({
  layout,
  viewMode,
  children,
}: PageCanvasState & { children: ReactNode }) {
  return (
    <PageCanvasContext.Provider value={{ layout, viewMode }}>
      {children}
    </PageCanvasContext.Provider>
  );
}

function PageNodeView(_props: NodeViewProps) {
  const canvas = useContext(PageCanvasContext);
  if (!canvas || canvas.layout.canvas !== "page") {
    return (
      <NodeViewWrapper className="page-section">
        <NodeViewContent />
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className="page-section">
      <DocumentPage layout={canvas.layout} viewMode={canvas.viewMode}>
        <NodeViewContent />
      </DocumentPage>
    </NodeViewWrapper>
  );
}

/** A real page sheet in the page canvas. */
export const Page = Node.create({
  name: "page",
  group: "block",
  content: "block+",
  isolating: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-page-sheet="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-sheet": "true",
        class: "page-section",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageNodeView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            renderContent(node: unknown): void;
            write(text: string): void;
            closeBlock(node: unknown): void;
          },
          node: unknown,
          parent: { childCount: number },
          index: number,
        ) {
          state.renderContent(node);
          if (index < parent.childCount - 1) {
            state.write('<div data-page-break="true"></div>');
          }
          state.closeBlock(node);
        },
      },
    };
  },
});

export function isPageNode(node: { type?: string }): boolean {
  return node.type === "page";
}

/** Split canonical top-level blocks into page containers at page breaks. */
export function wrapInPages(doc: JSONContent): JSONContent {
  const content = doc.content ?? [];
  if (content.some((node) => isPageNode(node))) return doc;

  const pages: JSONContent[] = [];
  let current: JSONContent[] = [];
  const flush = () => {
    pages.push({
      type: "page",
      content:
        current.length > 0
          ? current
          : [{ type: "paragraph" }],
    });
    current = [];
  };

  for (const node of content) {
    if (node.type === "pageBreak") {
      flush();
    } else {
      current.push(node);
    }
  }
  flush();

  return { ...doc, content: pages };
}

/** Flatten page containers back into the canonical block sequence. */
export function unwrapPages(doc: JSONContent): JSONContent {
  const content = doc.content ?? [];
  if (!content.some((node) => isPageNode(node))) return doc;

  const next: JSONContent[] = [];
  content.forEach((node, index) => {
    if (!isPageNode(node)) {
      next.push(node);
      return;
    }
    if (index > 0) next.push({ type: "pageBreak" });
    next.push(...(node.content ?? []));
  });
  return { ...doc, content: next };
}
