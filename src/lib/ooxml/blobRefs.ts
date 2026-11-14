import type { JSONContent } from "@tiptap/core";
import { dataUrlToBytes } from "../base64";
import { uploadEncryptedBytes } from "../encryptedBlob";

/**
 * Convert the legacy data URLs produced by the OOXML reader into encrypted
 * Blossom refs. The raw drawing XML stays in the node so DOCX export can still
 * re-emit the original drawing.
 */
export async function replaceEmbeddedImagesWithBlossom(
  doc: JSONContent,
  servers: string[],
): Promise<JSONContent> {
  async function visit(node: JSONContent): Promise<JSONContent> {
    if (node.type === "ooxmlImage") {
      const attrs = node.attrs ?? {};
      const src = String(attrs.src ?? "");
      if (src.startsWith("data:")) {
        const { bytes, mimeType } = dataUrlToBytes(src);
        const ref = await uploadEncryptedBytes(
          servers,
          bytes,
          mimeType,
          String(attrs.filename ?? "Word image"),
        );
        return {
          ...node,
          attrs: {
            ...attrs,
            src: ref.src,
            decryptionKey: ref.decryptionKey,
            decryptionNonce: ref.decryptionNonce,
            x: ref.x,
            mimeType: ref.mimeType,
            size: ref.size,
          },
        };
      }
    }
    if (!node.content) return node;
    return {
      ...node,
      content: await Promise.all(node.content.map(visit)),
    };
  }

  return visit(doc);
}
