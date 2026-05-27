import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";

const tableHandlesKey = new PluginKey("tableHandles");

// ── Floating context menu ──────────────────────────────────────────────────

let activeMenu: HTMLElement | null = null;
let cleanupMenu: (() => void) | null = null;

function dismissMenu() {
  activeMenu?.remove();
  activeMenu = null;
  cleanupMenu?.();
  cleanupMenu = null;
}

interface MenuItem {
  label: string;
  danger?: boolean;
  action: () => void;
}

function showMenu(anchor: HTMLElement, items: MenuItem[]) {
  dismissMenu();

  const menu = document.createElement("div");
  menu.className = "tbl-ctx-menu";

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "tbl-ctx-item" + (item.danger ? " tbl-ctx-danger" : "");
    btn.textContent = item.label;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissMenu();
      item.action();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  activeMenu = menu;

  // Position below the anchor, clamped to viewport
  const rect = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 160;
  const mh = menu.offsetHeight || 120;
  let top = rect.bottom + 6;
  let left = rect.left - 4;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = rect.top - mh - 6;
  menu.style.top = `${top + window.scrollY}px`;
  menu.style.left = `${left + window.scrollX}px`;

  const onDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) dismissMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismissMenu();
  };
  // Bind next tick so this mousedown doesn't immediately dismiss
  setTimeout(() => {
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
  }, 0);
  cleanupMenu = () => {
    document.removeEventListener("mousedown", onDown);
    document.removeEventListener("keydown", onKey);
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function setSelectionTo(editor: Editor, domCell: Element) {
  const pos = editor.view.posAtDOM(domCell, 0);
  if (pos < 0) return false;
  const { state } = editor.view;
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)))
  );
  return true;
}

// ── Row anchor ─────────────────────────────────────────────────────────────

function makeRowAnchor(editor: Editor): HTMLElement {
  const td = document.createElement("td");
  td.className = "tbl-handle-cell tbl-row-handle-cell";
  td.setAttribute("contenteditable", "false");

  const dot = document.createElement("button");
  dot.className = "tbl-anchor-dot";
  dot.setAttribute("aria-label", "Row options");

  dot.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const tr = (e.currentTarget as HTMLElement).closest("tr");
    const firstCell = tr?.querySelector("td, th");
    if (!firstCell) return;

    const run = (cmd: () => void) => () => {
      if (setSelectionTo(editor, firstCell)) cmd();
    };

    showMenu(dot, [
      { label: "Add row above", action: run(() => editor.commands.addRowBefore()) },
      { label: "Add row below", action: run(() => editor.commands.addRowAfter()) },
      { label: "Delete row", danger: true, action: run(() => editor.commands.deleteRow()) },
    ]);
  });

  td.appendChild(dot);
  return td;
}

// ── Column anchor row ──────────────────────────────────────────────────────

function makeColAnchorRow(editor: Editor, colCount: number): HTMLElement {
  const tr = document.createElement("tr");
  tr.className = "tbl-col-handles-row";
  tr.setAttribute("contenteditable", "false");

  for (let i = 0; i < colCount; i++) {
    const td = document.createElement("td");
    td.className = "tbl-handle-cell tbl-col-handle-cell";
    td.setAttribute("contenteditable", "false");

    const dot = document.createElement("button");
    dot.className = "tbl-anchor-dot";
    dot.setAttribute("aria-label", "Column options");

    dot.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const tdEl = (e.currentTarget as HTMLElement).closest("td");
      const trEl = tdEl?.closest("tr");
      if (!tdEl || !trEl) return;

      const colIdx = Array.from(trEl.children).indexOf(tdEl);
      const table = trEl.closest("table");
      if (!table) return;

      const realRows = Array.from(table.querySelectorAll("tr")).filter(
        (r) => !r.classList.contains("tbl-col-handles-row")
      );
      const lastRow = realRows[realRows.length - 1];
      const targetCell = lastRow?.querySelectorAll("td, th")?.[colIdx];
      if (!targetCell) return;

      const run = (cmd: () => void) => () => {
        if (setSelectionTo(editor, targetCell)) cmd();
      };

      showMenu(dot, [
        { label: "Add column before", action: run(() => editor.commands.addColumnBefore()) },
        { label: "Add column after", action: run(() => editor.commands.addColumnAfter()) },
        { label: "Delete column", danger: true, action: run(() => editor.commands.deleteColumn()) },
      ]);
    });

    td.appendChild(dot);
    tr.appendChild(td);
  }

  // Empty corner cell (aligns with the row-handle column)
  const corner = document.createElement("td");
  corner.className = "tbl-handle-cell";
  corner.setAttribute("contenteditable", "false");
  tr.appendChild(corner);

  return tr;
}

// ── Extension ──────────────────────────────────────────────────────────────

export const TableHandles = Extension.create({
  name: "tableHandles",

  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      new Plugin({
        key: tableHandlesKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              if (node.type.name !== "table") return;

              let colCount = 0;

              node.forEach((child, offset) => {
                if (child.type.name !== "tableRow") return;
                const rowPos = pos + 1 + offset;
                if (colCount === 0) colCount = child.childCount;
                const rowEndPos = rowPos + child.nodeSize - 1;
                decorations.push(
                  Decoration.widget(rowEndPos, () => makeRowAnchor(editor), {
                    side: 1,
                    key: `row-handle-${rowPos}`,
                    stopEvent: () => true,
                  })
                );
              });

              if (colCount > 0) {
                const tableEndPos = pos + node.nodeSize - 1;
                decorations.push(
                  Decoration.widget(
                    tableEndPos,
                    () => makeColAnchorRow(editor, colCount),
                    { side: 1, key: `col-handles-${pos}-${colCount}`, stopEvent: () => true }
                  )
                );
              }

              return false;
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
