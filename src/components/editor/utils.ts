import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  nip44,
  type Event,
} from "nostr-tools";
import { getConversationKey } from "nostr-tools/nip44";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { signerManager } from "../../signer";
import { publishEvent } from "../../nostr/publish";
import { encodeNKeys } from "../../utils/nkeys";
import { KIND_FILE } from "../../nostr/kinds";
import { isNativePlatform } from "../../signer/secureStorage";
import { loadFontResources, saveFontResource } from "../../lib/fontStore";
import { sha256Hex } from "../../utils/fileEncryption";
import { uploadBinaryToBlossom } from "../../blossom/client";

export const handleSharePublic = () => {
  console.log("TODO: Share publicly");
};

/**
 * Parses an a-link address into its components.
 * @param address Format: "kind:pubkey:identifier"
 */
function parseAddress(address: string): {
  kind: number;
  pubkey: string;
  identifier: string;
} | null {
  const parts = address.split(":");
  if (parts.length !== 3) return null;
  const [kindStr, pubkey, identifier] = parts;
  const kind = parseInt(kindStr, 10);
  if (isNaN(kind)) return null;
  return { kind, pubkey, identifier };
}

export type ShareResult = {
  url: string;
  address: string;
  viewKey: string;
  editKey?: string;
};

/**
 * Builds an in-app path (`/doc/<naddr>[#<nkeys>]`) for a shared document address,
 * appending the nkeys fragment when keys are available for that address.
 */
export function buildSharedDocPath(
  sharedAddr: string,
  getKeys: (addr: string) => string[],
): string {
  const [kindStr, pubkey, identifier] = sharedAddr.split(":");
  const naddr = nip19.naddrEncode({
    kind: parseInt(kindStr, 10),
    pubkey,
    identifier,
  });
  const keys = getKeys(sharedAddr);
  if (keys.length > 0 && keys[0]) {
    const nkeysObj: Record<string, string> = { viewKey: keys[0] };
    if (keys[1]) nkeysObj.editKey = keys[1];
    return `/doc/${naddr}#${encodeNKeys(nkeysObj)}`;
  }
  return `/doc/${naddr}`;
}

export function buildShareUrl(
  address: string,
  viewKeyHex: string,
  editKeyHex?: string,
): string {
  const [kindStr, pubkey, identifier] = address.split(":");
  const naddr = nip19.naddrEncode({
    kind: parseInt(kindStr, 10),
    pubkey,
    identifier,
  });
  const nkeysStr = encodeNKeys({
    viewKey: viewKeyHex,
    ...(editKeyHex && { editKey: editKeyHex }),
  });
  const baseUrl = isNativePlatform
    ? "https://pages.formstr.app"
    : window.location.origin;
  return `${baseUrl}/doc/${naddr}#${nkeysStr}`;
}

export async function handleGeneratePrivateLink(
  canEdit: boolean,
  selectedDocumentId: string | null,
  docContent: string,
  relays: string[],
  viewKey?: string,
  editKey?: string,
  blossomServers: string[] = [],
): Promise<ShareResult> {
  if (!selectedDocumentId) {
    throw new Error("No document selected");
  }
  if (!docContent) {
    throw new Error("Document content is empty");
  }

  // Parse the address to extract components (selectedDocumentId is an a-link: "kind:pubkey:identifier")
  const parsed = parseAddress(selectedDocumentId);
  if (!parsed) {
    throw new Error("Invalid document address format");
  }
  const { identifier: dTag } = parsed;

  const signer = await signerManager.getSigner();

  // 1️⃣ Generate keys
  const viewKeyUsed = viewKey ? hexToBytes(viewKey) : generateSecretKey();
  const editKeyUsed = canEdit
    ? editKey
      ? hexToBytes(editKey)
      : generateSecretKey()
    : null;

  const conversationKey = getConversationKey(
    viewKeyUsed,
    getPublicKey(viewKeyUsed),
  );
  const encryptedContent = nip44.encrypt(docContent, conversationKey);

  // Gather font metadata from local store and ensure blossom URLs exist
  const fontTags: string[][] = [];
  try {
    const fonts = await loadFontResources();
    for (const f of fonts) {
      try {
        if (!f.blossomUrl && blossomServers && blossomServers.length > 0) {
          const buf = await f.blob.arrayBuffer();
          const sha = await sha256Hex(buf);
          try {
            const url = await uploadBinaryToBlossom(blossomServers, new Uint8Array(buf), sha, f.mimeType);
            f.blossomUrl = url;
            await saveFontResource(f);
          } catch (err) {
            console.warn("Failed to upload font to Blossom:", f.family, err);
          }
        }

        if (f.blossomUrl) {
          // tag format: ["font", family, url, format]
          fontTags.push(["font", f.family, f.blossomUrl, f.format]);
        }
      } catch (err) {
        console.warn("Skipping font metadata due to error", err);
      }
    }
  } catch (err) {
    console.warn("Could not read stored fonts:", err);
  }

  const sharedEvent = {
    kind: KIND_FILE,
    tags: [["d", dTag], ...fontTags],
    content: encryptedContent,
    created_at: Math.floor(Date.now() / 1000),
  };

  // 3️⃣ Sign with editKey if provided, otherwise use user's signer
  let signedEvent: Event;
  if (editKeyUsed) {
    signedEvent = finalizeEvent(sharedEvent, editKeyUsed);
  } else {
    if (!signer) {
      throw new Error("No signer available");
    }
    signedEvent = await signer.signEvent(sharedEvent);
  }

  // 4️⃣ Publish the new shared event
  await publishEvent(signedEvent, relays);

  // 5️⃣ Encode keys in one nkeys string
  const nkeysStr = encodeNKeys({
    viewKey: bytesToHex(viewKeyUsed),
    ...(editKeyUsed && { editKey: bytesToHex(editKeyUsed) }),
  });

  // 6️⃣ Build URL and address
  const newAddress = `${KIND_FILE}:${signedEvent.pubkey}:${dTag}`;
  const naddr = nip19.naddrEncode({
    kind: KIND_FILE,
    pubkey: signedEvent.pubkey,
    identifier: dTag,
  });

  const baseUrl = isNativePlatform ? "https://pages.formstr.app" : window.location.origin;
  const shareUrl = `${baseUrl}/doc/${naddr}#${nkeysStr}`;

  return {
    url: shareUrl,
    address: newAddress,
    viewKey: bytesToHex(viewKeyUsed),
    ...(editKeyUsed && { editKey: bytesToHex(editKeyUsed) }),
  };
}
