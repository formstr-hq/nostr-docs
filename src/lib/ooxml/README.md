# OOXML adapter

This is the package-preserving OOXML adapter used by the DOCX importer and
exporter. It is not an HTML converter.

The internal document model does not need to be OOXML. The adapter is the
compiler boundary:

```
DOCX package -> OOXML body AST -> rich document nodes
             <- OOXML body AST <- rich document nodes
```

## What is implemented

- `package.ts` — lossless ZIP package loading/saving. Every part, relationship,
  media file and unknown XML fragment is preserved.
- `xml.ts` — namespace-aware XML helpers built on `@xmldom/xmldom`.
- `body.ts` — parses `word/document.xml` into editable paragraphs and simple
  tables while keeping unsupported blocks as opaque raw XML.
- `sections.ts` — parses `w:sectPr`, page size/margins and the referenced
  header/footer parts; projects them into the app's `PageLayout` (the raw parts
  stay in the package).
- `rich.ts` — maps supported OOXML blocks into the canonical ProseMirror model.
  Unsupported blocks become `ooxmlBlock` placeholders carrying their raw XML.
- `writer.ts` — writes edited rich paragraphs/tables back into the original
  OOXML body. Raw blocks are re-emitted; other package parts are untouched.
- `scripts/ooxml-fidelity.ts` — round-trip harness:
  - package parts are preserved
  - `document.xml` round-trips without edits
  - editing paragraph text and table-cell text works
  - page size, margins, header and footer text are reported
  - other package parts stay byte-identical after an edit

The active import/export path uses this adapter. Mammoth has been removed.

Run the harness with:

```sh
npm run test:ooxml
```

Fixtures live in `tests/fixtures/docx/`.

## Deliberate design

- A paragraph is editable only if its children are `w:pPr` + `w:r` and each run
  contains only `w:rPr`/`w:t`/`w:br`/`w:tab`/`w:cr`.
- A table is editable only when it has non-merged `w:tc` cells containing
  paragraphs. Merged cells, nested tables and other complex content stay raw.
- Anything else (drawings, hyperlinks, bookmarks, fields, content controls,
  footnotes, …) is a **raw block** and is re-emitted verbatim.
- Non-dirty paragraphs are re-emitted from their original XML, so no attributes
  or unknown children are lost.
- Dirty paragraphs are rebuilt from their run text while preserving the original
  `w:pPr`/`w:rPr` inner XML.

This gives us a lossless floor while the editable surface grows.

## Next coverage

1. Merged cells and complex/nested tables.
2. Images → editor image nodes, with relationship/media preservation.
3. Field results and page numbers in headers/footers (`w:fldChar`/`w:instrText`).
4. Footnotes/endnotes, comments and tracked changes as explicit sidecars.
5. Floating objects and content controls.
6. Write PageLayout/header/footer edits back into the DOCX package.
7. Preserve richer run formatting when editing imported text.

Every step should add a fixture to `tests/fixtures/docx/` and a fidelity check to
`scripts/ooxml-fidelity.ts`.
