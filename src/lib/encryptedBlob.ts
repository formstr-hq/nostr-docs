import { decryptFile } from "../utils/fileEncryption";
import { bytesToBase64 } from "./base64";

/**
 * A reference to a Blossom blob. The blob itself is AES-GCM encrypted; the
 * decryption key/nonce live in the NIP-44-encrypted document envelope, never in
 * the Blossom URL.
 */
export interface EncryptedBlobRef {
  src: string;
  decryptionKey: string;
  decryptionNonce: string;
  /** SHA-256 of the encrypted bytes, when known. */
  x?: string;
  mimeType?: string;
  size?: number;
  filename?: string;
}

/**
 * Encrypt bytes with the same format as user-uploaded attachments, upload them
 * to Blossom, and return the reference that belongs in the document JSON.
 *
 * Imports are dynamic so the pure OOXML adapter can still be used from Node
 * scripts without loading the browser signer stack.
 */
export async function uploadEncryptedBytes(
  servers: string[],
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): Promise<EncryptedBlobRef> {
  if (servers.length === 0) {
    throw new Error("No Blossom server configured");
  }
  const [{ encryptFile }, { uploadToBlossom }] = await Promise.all([
    import("../utils/fileEncryption"),
    import("../blossom/client"),
  ]);
  const file = new File([bytes as unknown as BlobPart], filename, {
    type: mimeType || "application/octet-stream",
  });
  const { encryptedData, decryptionKey, decryptionNonce, x } =
    await encryptFile(file);
  const src = await uploadToBlossom(servers, encryptedData, x);
  return {
    src,
    decryptionKey,
    decryptionNonce,
    x,
    mimeType: mimeType || "application/octet-stream",
    size: bytes.byteLength,
    filename,
  };
}

/** Fetch and decrypt a Blossom blob into its original bytes. */
export async function fetchEncryptedBytes(
  ref: EncryptedBlobRef,
): Promise<Uint8Array> {
  if (!ref.src || !ref.decryptionKey || !ref.decryptionNonce) {
    throw new Error("Encrypted blob reference is incomplete");
  }
  const response = await fetch(ref.src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const encryptedData = await response.arrayBuffer();
  const decrypted = await decryptFile(
    encryptedData,
    ref.decryptionKey,
    ref.decryptionNonce,
  );
  return new Uint8Array(decrypted);
}

/** Fetch and decrypt a Blossom blob as base64 (used for the DOCX package). */
export async function fetchEncryptedBase64(
  ref: EncryptedBlobRef,
): Promise<string> {
  return bytesToBase64(await fetchEncryptedBytes(ref));
}
