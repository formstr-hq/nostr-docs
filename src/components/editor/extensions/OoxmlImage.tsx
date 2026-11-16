import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { EncryptedFilePreview } from "../EncryptedFilePreview";

function OoxmlImageNodeView({ node }: NodeViewProps) {
  const attrs = node.attrs;
  const src = String(attrs.src ?? "");
  const alt = String(attrs.alt || attrs.filename || "Word image");
  const width =
    attrs.width != null && Number.isFinite(Number(attrs.width))
      ? Number(attrs.width)
      : undefined;

  if (!src) {
    return (
      <NodeViewWrapper className="ooxml-image">
        <span className="ooxml-image-missing">[Image unavailable]</span>
      </NodeViewWrapper>
    );
  }

  // Legacy documents stored extracted images as data URLs.
  if (src.startsWith("data:")) {
    return (
      <NodeViewWrapper className="ooxml-image">
        <img
          src={src}
          alt={alt}
          style={{
            width: width ? `${width}px` : "100%",
            maxWidth: "100%",
            height: "auto",
            display: "block",
          }}
        />
      </NodeViewWrapper>
    );
  }

  if (!attrs.decryptionKey || !attrs.decryptionNonce) {
    return (
      <NodeViewWrapper className="ooxml-image">
        <span className="ooxml-image-missing">[Image unavailable]</span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="ooxml-image">
      <EncryptedFilePreview
        src={src}
        decryptionKey={String(attrs.decryptionKey)}
        decryptionNonce={String(attrs.decryptionNonce)}
        mimeType={String(attrs.mimeType ?? "image/png")}
        filename={alt}
        width={width}
      />
    </NodeViewWrapper>
  );
}

/**
 * A DOCX image. The editor renders the Blossom-encrypted image, while the raw
 * drawing XML is kept in `xml` so the original package can round-trip.
 */
export const OoxmlImage = Node.create({
  name: "ooxmlImage",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      width: { default: null },
      height: { default: null },
      decryptionKey: { default: "" },
      decryptionNonce: { default: "" },
      x: { default: "" },
      mimeType: { default: "image/png" },
      size: { default: null },
      filename: { default: "Word image" },
      xml: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "img[data-ooxml-image]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const {
      xml: _xml,
      decryptionKey,
      decryptionNonce,
      x,
      mimeType,
      filename,
      size,
      ...attrs
    } = HTMLAttributes;
    const src = String(attrs.src ?? "");

    if (src.startsWith("data:")) {
      return [
        "img",
        mergeAttributes(attrs, {
          "data-ooxml-image": "true",
          class: "ooxml-image",
          style: "max-width: 100%; height: auto;",
        }),
      ];
    }

    return [
      "encrypted-file",
      mergeAttributes({
        "data-ooxml-image": "true",
        "data-src": src,
        "data-key": decryptionKey ?? "",
        "data-nonce": decryptionNonce ?? "",
        "data-x": x ?? "",
        "data-mime": mimeType ?? "image/png",
        "data-filename": encodeURIComponent(
          String(filename || attrs.alt || "Word image"),
        ),
        ...(attrs.width != null ? { "data-width": String(attrs.width) } : {}),
        ...(attrs.height != null ? { "data-height": String(attrs.height) } : {}),
        ...(size != null ? { "data-size": String(size) } : {}),
        class: "ooxml-image",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(OoxmlImageNodeView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(text: string): void; closeBlock(node: unknown): void },
          node: {
            attrs?: {
              src?: string;
              alt?: string;
              width?: number | null;
              height?: number | null;
              decryptionKey?: string;
              decryptionNonce?: string;
              mimeType?: string;
              filename?: string;
            };
          },
        ) {
          const attrs = node.attrs ?? {};
          const src = String(attrs.src ?? "");
          if (!src) {
            state.closeBlock(node);
            return;
          }
          if (src.startsWith("data:")) {
            state.write(`![${String(attrs.alt ?? "")}](${src})`);
            state.closeBlock(node);
            return;
          }
          const width =
            attrs.width != null ? ` data-width="${attrs.width}"` : "";
          const height =
            attrs.height != null ? ` data-height="${attrs.height}"` : "";
          state.write(
            `<encrypted-file data-ooxml-image="true" data-src="${src}" data-key="${String(
              attrs.decryptionKey ?? "",
            )}" data-nonce="${String(attrs.decryptionNonce ?? "")}" data-mime="${String(
              attrs.mimeType ?? "image/png",
            )}" data-filename="${encodeURIComponent(
              String(attrs.filename ?? attrs.alt ?? "Word image"),
            )}"${width}${height}></encrypted-file>`,
          );
          state.closeBlock(node);
        },
      },
    };
  },
});
