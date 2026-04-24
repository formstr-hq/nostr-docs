import { nip44, getPublicKey } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function aesGcmDecrypt(ciphertext: string, conversationKey: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const payload = base64ToUint8Array(ciphertext);
  const version = payload[0];
  if (version !== 2) {
    throw new Error(`Unsupported encrypted payload version: ${version}`);
  }

  const nonce = payload.slice(1, 33);
  const ciphertextBytes = payload.slice(33);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    conversationKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: nonce,
      info: encoder.encode("nip44-v2"),
    },
    baseKey,
    44 * 8,
  );

  const derived = new Uint8Array(derivedBits);
  const aesKeyBytes = derived.slice(0, 32);
  const aesNonce = derived.slice(32, 44);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBytes as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: aesNonce as BufferSource,
    },
    aesKey,
    ciphertextBytes,
  );

  return decoder.decode(plaintext);
}

export async function decryptFormstrDriveFile(ciphertext: string, privateKeyHex: string): Promise<Uint8Array> {
  const secretKey = hexToBytes(privateKeyHex);
  const pubkey = getPublicKey(secretKey);
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
  const plaintextBase64 = await aesGcmDecrypt(ciphertext, conversationKey);
  return base64ToUint8Array(plaintextBase64);
}
