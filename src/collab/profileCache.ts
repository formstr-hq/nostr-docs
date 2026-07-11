import { fetchProfile } from "../nostr/fetchProfile";
import { DEFAULT_RELAYS } from "../nostr/relayPool";

export interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  [key: string]: unknown;
}

// Presence/op events resolve the same handful of collaborators' profiles
// over and over — fetchProfile itself has no caching, so wrap it here rather
// than hitting relays on every awareness update.
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  profile: NostrProfile | null;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<NostrProfile | null>>();

export async function fetchProfileCached(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<NostrProfile | null> {
  const cached = cache.get(pubkey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.profile;
  }

  // Dedupe concurrent lookups (e.g. several presence updates for the same
  // collaborator resolving at once) into a single relay round-trip.
  const existing = inflight.get(pubkey);
  if (existing) return existing;

  const promise = (async () => {
    let profile: NostrProfile | null = null;
    try {
      profile = (await fetchProfile(pubkey, relays)) as NostrProfile | null;
    } catch {
      profile = null;
    }
    cache.set(pubkey, { profile, cachedAt: Date.now() });
    inflight.delete(pubkey);
    return profile;
  })();

  inflight.set(pubkey, promise);
  return promise;
}
