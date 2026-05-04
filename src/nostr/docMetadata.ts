import type { EventTemplate } from "nostr-tools";
import { pool } from "./relayPool";
import { publishEvent } from "./publish";
import { signerManager } from "../signer";
import { KIND_DOC_METADATA } from "./kinds";

export interface DocMetadata {
  tags: string[];
  title?: string;
}

export async function fetchAllDocMetadata(
  relays: string[],
  pubkey: string,
): Promise<Map<string, DocMetadata>> {
  return new Promise((resolve) => {
    const events: any[] = [];
    const seenIds = new Set<string>();
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      sub.close();

      const result = new Map<string, DocMetadata>();
      events.sort((a, b) => b.created_at - a.created_at);
      const seenAddresses = new Set<string>();

      const signer = await signerManager.getSigner();
      if (!signer) {
        resolve(result);
        return;
      }

      for (const event of events) {
        const dTag = event.tags.find((t: string[]) => t[0] === "d")?.[1];
        if (!dTag || seenAddresses.has(dTag)) continue;
        seenAddresses.add(dTag);

        try {
          const decrypted = await signer.nip44Decrypt!(pubkey, event.content);
          const metadata: DocMetadata = JSON.parse(decrypted);
          result.set(dTag, metadata);
        } catch {
          // skip undecryptable events
        }
      }

      resolve(result);
    };

    const timeout = setTimeout(finish, 5000);

    const sub = pool.subscribeMany(
      relays,
      { kinds: [KIND_DOC_METADATA], authors: [pubkey] },
      {
        onevent(event) {
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            events.push(event);
          }
        },
        oneose: () => {
          clearTimeout(timeout);
          finish();
        },
      },
    );
  });
}

export async function saveDocMetadata(
  address: string,
  metadata: DocMetadata,
  relays: string[],
): Promise<void> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer");

  const pubkey = await signer.getPublicKey();
  const encrypted = await signer.nip44Encrypt!(pubkey, JSON.stringify(metadata));

  const event: EventTemplate = {
    kind: KIND_DOC_METADATA,
    tags: [["d", address]],
    content: encrypted,
    created_at: Math.floor(Date.now() / 1000),
  };

  const signed = await signer.signEvent(event);
  await publishEvent(signed, relays);
}
