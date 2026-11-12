import { generateJSON } from "@tiptap/html";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Columns, Column } from "../components/editor/extensions/Columns";
import { MarkdownColor } from "../components/editor/extensions/MarkdownColor";
import { OoxmlBlock } from "../components/editor/extensions/OoxmlBlock";
import { OoxmlImage } from "../components/editor/extensions/OoxmlImage";
import MarkdownIt from "markdown-it";
import { Indent } from "../components/editor/extensions/Indent";
import { EncryptedFileNode } from "../components/editor/extensions/EncryptedFileNode";
import { CommentHighlight } from "../components/editor/extensions/CommentHighlight";
import { FormNode } from "../components/editor/extensions/FormNode";

/**
 * Markdown -> canonical ProseMirror JSON adapter.
 *
 * This is the import boundary. The editor schema is the source of truth; the
 * Markdown parser and HTML generation only decide what shape the initial doc
 * takes. Unsupported Markdown features degrade to plain text/blocks, never to
 * a second stored format.
 */
const markdown = new MarkdownIt({ html: true, linkify: true });

const documentExtensions = [
  StarterKit,
  TextStyle,
  MarkdownColor,
  FontFamily,
  Link.configure({ openOnClick: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Columns,
  Column,
  OoxmlBlock,
  OoxmlImage,
  Indent,
  EncryptedFileNode,
  CommentHighlight,
  FormNode,
];

export function htmlToRichDocument(html: string): JSONContent {
  return generateJSON(html, documentExtensions) as JSONContent;
}

export function markdownToRichDocument(source: string): JSONContent {
  return htmlToRichDocument(markdown.render(source));
}
