import type { Event, EventTemplate } from "nostr-tools";
import { pool } from "./relayPool";
import { publishEvent } from "./publish";
import { signerManager } from "../signer";
import { KIND_DOC_METADATA } from "./kinds";

export interface DocMetadata {
  tags: string[];
  title?: string;
  viewKey?: string;
  editKey?: string;
  sharedAs?: string; // address of the shared (editKey-signed) copy
}

export async function fetchAllDocMetadata(
  relays: string[],
  pubkey: string,
): Promise<Map<string, DocMetadata>> {
  return new Promise((resolve) => {
    const events: Event[] = [];
    const seenIds = new Set<string>();
    let settled = false;
    let eoseCount = 0;

    const finish = async () => {
      if (settled) return;
      settled = true;
      subs.forEach((s) => {
        try {
          s.close();
        } catch {} // eslint-disable-line no-empty
      });

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
        if (!dTag) continue;

        const address = dTag;
        if (seenAddresses.has(address)) continue;
        seenAddresses.add(address);

        try {
          const decrypted = await signer.nip44Decrypt!(pubkey, event.content);
          const metadata: DocMetadata = JSON.parse(decrypted);
          result.set(address, metadata);
        } catch {
          // skip undecryptable events
        }
      }

      resolve(result);
    };

    const timeout = setTimeout(finish, 6000);

    const subs = relays.map((relay) =>
      pool.subscribeMany(
        [relay],
        { kinds: [KIND_DOC_METADATA], authors: [pubkey] },
        {
          onevent(event) {
            if (!seenIds.has(event.id)) {
              seenIds.add(event.id);
              events.push(event);
            }
          },
          oneose: () => {
            eoseCount++;
            if (eoseCount >= relays.length) {
              clearTimeout(timeout);
              finish();
            }
          },
        },
      ),
    );
  });
}

/**
 * Structural equality for two metadata records. Used to skip re-signing (and the
 * signer prompt it triggers) when a save wouldn't change anything. `tags` is
 * order-sensitive here — the app never reorders tags without an actual edit.
 */
export function metadataEqual(a: DocMetadata | undefined, b: DocMetadata | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.title !== b.title) return false;
  if (a.viewKey !== b.viewKey) return false;
  if (a.editKey !== b.editKey) return false;
  if (a.sharedAs !== b.sharedAs) return false;
  const at = a.tags ?? [];
  const bt = b.tags ?? [];
  if (at.length !== bt.length) return false;
  return at.every((t, i) => t === bt[i]);
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
