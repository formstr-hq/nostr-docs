import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DocxPackage } from "../src/lib/ooxml/package";
import {
  parseDocumentXml,
  paragraphText,
  serializeDocumentXml,
  setParagraphText,
  type OoxmlParagraph,
  type OoxmlTable,
} from "../src/lib/ooxml/body";

const fixtureDir = join(process.cwd(), "tests/fixtures/docx");
const fixtures = ["letterhead.docx", "report.docx", "resume-sidebar.docx"];

function firstDifference(a: string, b: string): string {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) {
      return `at ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))} != ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`;
    }
  }
  return "no difference";
}

function normalizeEntities(xml: string): string {
  return xml.replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

async function compareParts(
  left: DocxPackage,
  right: DocxPackage,
  options?: { skipDocumentXml?: boolean },
): Promise<string[]> {
  const diffs: string[] = [];
  const leftParts = left.listParts();
  const rightParts = new Set(right.listParts());
  for (const part of leftParts) {
    if (!rightParts.has(part)) {
      diffs.push(`missing ${part}`);
      continue;
    }
    if (part === "word/document.xml") {
      if (options?.skipDocumentXml) continue;
      const a = normalizeEntities(await left.text(part));
      const b = normalizeEntities(await right.text(part));
      if (a !== b) diffs.push(part);
      continue;
    }
    const a = await left.bytes(part);
    const b = await right.bytes(part);
    if (Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0) diffs.push(part);
  }
  for (const part of rightParts) {
    if (!leftParts.includes(part)) diffs.push(`extra ${part}`);
  }
  return diffs;
}

for (const fixture of fixtures) {
  const input = readFileSync(join(fixtureDir, fixture));
  const pkg = await DocxPackage.load(input);
  const beforeXml = await pkg.text("word/document.xml");
  const parsed = parseDocumentXml(beforeXml);
  const afterXml = serializeDocumentXml(parsed);

  const paragraphCount = parsed.blocks.filter((b) => b.kind === "paragraph").length;
  const tableCount = parsed.blocks.filter((b) => b.kind === "table").length;
  const rawCount = parsed.blocks.filter((b) => b.kind === "raw").length;

  const exact = beforeXml === afterXml;
  const equivalent = normalizeEntities(beforeXml) === normalizeEntities(afterXml);

  const noEditPkg = await DocxPackage.load(await pkg.save());
  const noEditDiffs = await compareParts(pkg, noEditPkg);

  console.log(`\n== ${basename(fixture)} ==`);
  console.log(
    `parts=${pkg.listParts().length} paragraphs=${paragraphCount} tables=${tableCount} rawBlocks=${rawCount}`,
  );
  console.log(
    `document.xml: ${
      exact
        ? "EXACT"
        : equivalent
          ? "EQUIVALENT (entity encoding only)"
          : "DIFF " + firstDifference(beforeXml, afterXml)
    }`,
  );
  console.log(
    `package (no edits): ${noEditDiffs.length === 0 ? "LOSSLESS" : `CHANGED ${noEditDiffs.join(", ")}`}`,
  );

  let editableParagraph: OoxmlParagraph | undefined = parsed.blocks.find(
    (b): b is OoxmlParagraph =>
      b.kind === "paragraph" && paragraphText(b).trim().length > 0,
  );
  let editableTable: OoxmlTable | undefined;

  if (!editableParagraph) {
    const table = parsed.blocks.find((b): b is OoxmlTable => b.kind === "table");
    if (table) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          const p = cell.paragraphs.find((candidate) =>
            paragraphText(candidate).trim().length > 0,
          );
          if (p) {
            editableParagraph = p;
            editableTable = table;
            break;
          }
        }
        if (editableParagraph) break;
      }
    }
  }

  if (editableParagraph) {
    const original = paragraphText(editableParagraph);
    setParagraphText(editableParagraph, "OOXML adapter edit");
    if (editableTable) editableTable.dirty = true;
    const editedXml = serializeDocumentXml(parsed);
    pkg.setText("word/document.xml", editedXml);

    const editedPkg = await DocxPackage.load(await pkg.save());
    const changedParts = await compareParts(pkg, editedPkg, {
      skipDocumentXml: true,
    });
    const reparsed = parseDocumentXml(await editedPkg.text("word/document.xml"));
    const editedTexts: string[] = [];
    for (const block of reparsed.blocks) {
      if (block.kind === "paragraph") {
        editedTexts.push(paragraphText(block));
      } else if (block.kind === "table") {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            for (const paragraph of cell.paragraphs) {
              editedTexts.push(paragraphText(paragraph));
            }
          }
        }
      }
    }
    const editedText = editedTexts.find((text) =>
      text.includes("OOXML adapter edit"),
    );

    console.log(
      `edit round-trip: ${editedText ? "OK" : "FAILED"}${editableTable ? " (table cell)" : ""} (was ${JSON.stringify(original.slice(0, 40))})`,
    );
    console.log(
      `other parts after edit: ${changedParts.length === 0 ? "UNCHANGED" : `CHANGED ${changedParts.join(", ")}`}`,
    );
  }
}
