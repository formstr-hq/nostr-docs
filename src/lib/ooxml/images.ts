import type { Document } from "@xmldom/xmldom";
import type { DocxPackage } from "./package";
import type { OoxmlBlock, OoxmlDocument } from "./body";
import { descendants, parseXml } from "./xml";

export interface ImageRelationship {
  id: string;
  target: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

export function parseImageRelationships(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!relsXml.trim()) return map;
  const doc: Document = parseXml(relsXml);
  const root = doc.documentElement;
  if (!root) return map;
  for (const rel of descendants(root, "Relationship", null)) {
    const id = rel.getAttribute("Id") ?? "";
    const target = rel.getAttribute("Target") ?? "";
    if (id && target) map.set(id, target);
  }
  return map;
}

function resolvePart(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return `word/${target.replace(/^\.\//, "")}`;
}

function imageRelationshipId(xml: string): string | undefined {
  return (
    /<a:blip[^>]*\br:embed="([^"]+)"/.exec(xml)?.[1] ??
    /<v:imagedata[^>]*\br:id="([^"]+)"/.exec(xml)?.[1] ??
    /<a:blip[^>]*\br:link="([^"]+)"/.exec(xml)?.[1]
  );
}

function extent(xml: string): { width?: number; height?: number } {
  const cx = Number(/<wp:extent[^>]*\bcx="(\d+)"/.exec(xml)?.[1]);
  const cy = Number(/<wp:extent[^>]*\bcy="(\d+)"/.exec(xml)?.[1]);
  return {
    width: Number.isFinite(cx) && cx > 0 ? Math.round(cx / 9525) : undefined,
    height: Number.isFinite(cy) && cy > 0 ? Math.round(cy / 9525) : undefined,
  };
}

/**
 * Turn raw drawing paragraphs into renderable image blocks. The original XML is
 * retained on the block, so export can re-emit the exact drawing.
 */
export async function resolveImageBlocks(
  parsed: OoxmlDocument,
  pkg: DocxPackage,
): Promise<void> {
  const relsXml = pkg.hasPart("word/_rels/document.xml.rels")
    ? await pkg.text("word/_rels/document.xml.rels")
    : "";
  const relationships = parseImageRelationships(relsXml);
  if (relationships.size === 0) return;

  const resolved: OoxmlBlock[] = [];
  for (const block of parsed.blocks) {
    if (block.kind !== "raw") {
      resolved.push(block);
      continue;
    }
    if (!/<w:drawing[\s>]|<w:pict[\s>]|<mc:AlternateContent[\s>]/.test(block.xml)) {
      resolved.push(block);
      continue;
    }
    const relId = imageRelationshipId(block.xml);
    const target = relId ? relationships.get(relId) : undefined;
    if (!target) {
      resolved.push(block);
      continue;
    }
    const part = resolvePart(target);
    if (!pkg.hasPart(part)) {
      resolved.push(block);
      continue;
    }
    const bytes = await pkg.bytes(part);
    const dims = extent(block.xml);
    resolved.push({
      kind: "image",
      src: `data:${mimeFor(part)};base64,${bytesToBase64(bytes)}`,
      width: dims.width,
      height: dims.height,
      xml: block.xml,
    });
  }
  parsed.blocks = resolved;
}
