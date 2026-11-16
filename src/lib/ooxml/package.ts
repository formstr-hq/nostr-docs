import JSZip from "jszip";

/**
 * A DOCX package. The important property is that it is lossless: every part,
 * relationship, media file and unknown XML fragment is kept. The adapter only
 * replaces parts it actually edits.
 */
export class DocxPackage {
  private readonly zip: JSZip;

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async load(data: ArrayBuffer | Uint8Array): Promise<DocxPackage> {
    const zip = await JSZip.loadAsync(data);
    return new DocxPackage(zip);
  }

  listParts(): string[] {
    return Object.keys(this.zip.files)
      .filter((name) => !this.zip.files[name].dir)
      .sort();
  }

  hasPart(name: string): boolean {
    return !!this.zip.file(name);
  }

  async text(name: string): Promise<string> {
    const file = this.zip.file(name);
    if (!file) throw new Error(`Missing DOCX part: ${name}`);
    return file.async("string");
  }

  async bytes(name: string): Promise<Uint8Array> {
    const file = this.zip.file(name);
    if (!file) throw new Error(`Missing DOCX part: ${name}`);
    return file.async("uint8array");
  }

  setText(name: string, value: string): void {
    this.zip.file(name, value);
  }

  setBytes(name: string, value: Uint8Array): void {
    this.zip.file(name, value);
  }

  remove(name: string): void {
    this.zip.remove(name);
  }

  async save(): Promise<Uint8Array> {
    return this.zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  async clone(): Promise<DocxPackage> {
    return DocxPackage.load(await this.save());
  }
}
