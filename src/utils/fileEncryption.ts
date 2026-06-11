import { bytesToHex, hexToBytes } from "nostr-tools/utils";

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}

export async function encryptFile(file: File): Promise<{
  encryptedData: Uint8Array;
  decryptionKey: string; // 64 hex chars (256-bit)
  decryptionNonce: string; // 24 hex chars (12-byte nonce)
  x: string; // sha256 of encrypted data
  ox: string; // sha256 of original data
}> {
  const fileData = await file.arrayBuffer();
  const ox = await sha256Hex(fileData);

  const cryptoKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as unknown as ArrayBuffer },
    cryptoKey,
    fileData,
  );

  const rawKey = await crypto.subtle.exportKey("raw", cryptoKey);
  const encryptedData = new Uint8Array(encrypted);
  const x = await sha256Hex(encryptedData);

  return {
    encryptedData,
    decryptionKey: bytesToHex(new Uint8Array(rawKey)),
    decryptionNonce: bytesToHex(nonce),
    x,
    ox,
  };
}

export async function decryptFile(
  encryptedData: ArrayBuffer,
  decryptionKey: string,
  decryptionNonce: string,
): Promise<ArrayBuffer> {
  const keyBytes = hexToBytes(decryptionKey);
  const nonce = hexToBytes(decryptionNonce);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    "AES-GCM",
    false,
    ["decrypt"],
  );

  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as unknown as ArrayBuffer },
    cryptoKey,
    encryptedData,
  );
}
