function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return result;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  // crypto.subtle.digest requires ArrayBuffer, not Uint8Array<ArrayBufferLike>
  const buf = data instanceof Uint8Array ? (data.buffer as ArrayBuffer) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return bufToHex(hash);
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
    decryptionKey: bufToHex(rawKey),
    decryptionNonce: bufToHex(nonce),
    x,
    ox,
  };
}

export async function decryptFile(
  encryptedData: ArrayBuffer,
  decryptionKey: string,
  decryptionNonce: string,
): Promise<ArrayBuffer> {
  const keyBytes = hexToBuf(decryptionKey);
  const nonce = hexToBuf(decryptionNonce);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
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
