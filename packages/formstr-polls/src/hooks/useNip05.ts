import { useEffect, useState } from "react";
import { nip05 } from "nostr-tools";

export type Nip05Status = "loading" | "verified" | "failed";

const verificationCache = new Map<string, Nip05Status>();
const pending = new Set<string>();

export function useNip05(
  identifier: string | undefined,
  pubkey: string,
): Nip05Status {
  const cacheKey = `${identifier}:${pubkey}`;

  const [status, setStatus] = useState<Nip05Status>(() => {
    if (!identifier) return "failed";
    return verificationCache.get(cacheKey) ?? "loading";
  });

  useEffect(() => {
    if (!identifier) {
      setStatus("failed");
      return;
    }

    const cached = verificationCache.get(cacheKey);
    if (cached) {
      setStatus(cached);
      return;
    }

    if (pending.has(cacheKey)) return;

    pending.add(cacheKey);

    nip05
      .queryProfile(identifier)
      .then((profile) => {
        const result: Nip05Status =
          profile?.pubkey === pubkey ? "verified" : "failed";
        verificationCache.set(cacheKey, result);
        pending.delete(cacheKey);
        setStatus(result);
      })
      .catch(() => {
        verificationCache.set(cacheKey, "failed");
        pending.delete(cacheKey);
        setStatus("failed");
      });
  }, [identifier, pubkey, cacheKey]);

  return status;
}
