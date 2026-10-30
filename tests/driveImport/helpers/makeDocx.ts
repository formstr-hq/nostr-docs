import JSZip from "jszip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** A minimal but real .docx: a ZIP whose word/document.xml holds the given body XML. */
export async function makeDocx(bodyXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

export const paragraph = (text: string, props = "") =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
