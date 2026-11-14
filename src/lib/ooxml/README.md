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
  tables while keeping unsupported blocks as opaque raw XML. Horizontal merges
  (`w:gridSpan`) map to table-cell spans; vertical merges stay raw.
- `images.ts` — resolves drawing relationships to media parts and keeps the
  original drawing XML for export. The import dialog uploads the extracted bytes
  as encrypted Blossom blobs, so the stored document holds only a blob
  reference; legacy/device-only imports may still carry data URLs.
- `sections.ts` — parses `w:sectPr`, page size/margins and the referenced
  header/footer parts; projects them into the app's `PageLayout`, and writes
  page size/orientation/margins back on export. The raw parts stay in the
  package.
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
- A table is editable when it has `w:tc` cells containing paragraphs. Horizontal
  merges (`w:gridSpan`) are preserved as `colspan`; vertical merges, nested
  tables and other complex content stay raw.
- Drawings/images are stored as encrypted Blossom refs (new imports) or data
  URLs (legacy/device-only imports); the raw drawing XML is re-emitted on
  export. Replacing or resizing an image is a later slice.
- The original DOCX package is uploaded once to Blossom and referenced from the
  envelope when the page is published; device-only imports keep it inline.
- Anything else (drawings, hyperlinks, bookmarks, fields, content controls,
  footnotes, …) is a **raw block** and is re-emitted verbatim.
- Non-dirty paragraphs are re-emitted from their original XML, so no attributes
  or unknown children are lost.
- Dirty paragraphs are rebuilt from their run text while preserving the original
  `w:pPr`/`w:rPr` inner XML.

This gives us a lossless floor while the editable surface grows.

## Next coverage

1. Vertical merges and complex/nested tables.
2. Image replacement and resizing.
3. Field results and page numbers in headers/footers (`w:fldChar`/`w:instrText`).
4. Footnotes/endnotes, comments and tracked changes as editable content.
5. Floating objects and content controls.
6. Writing header/footer text edits back into the DOCX package.
7. Preserve richer run formatting when editing imported text.

Every step should add a fixture to `tests/fixtures/docx/` and a fidelity check to
`scripts/ooxml-fidelity.ts`.
