import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Awareness } from "y-protocols/awareness";
import { resolveAttested } from "./sessionKeys";
import { fetchProfileCached } from "./profileCache";

export interface TrustedCollaborator {
  sessionPubkey: string;
  realPubkey: string | null;
  name: string;
  color: string;
  picture?: string;
}

function shortenPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
}

function colorFromPubkey(pubkey: string): string {
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = (hash << 5) - hash + pubkey.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 65%, 45%)`;
}

/**
 * Resolves the current remote awareness clients to trusted collaborator
 * identities (name/color/avatar), keyed by session pubkey. "Trusted" means
 * resolved via a verified session-attestation lookup and the real pubkey's
 * profile — never taken from self-asserted awareness fields.
 */
export function useTrustedCollaborators(
  awareness: Awareness | null | undefined,
  docAddress: string | null | undefined,
  viewKey: string | undefined,
  relays: string[],
): {
  collaborators: Map<string, TrustedCollaborator>;
  collaboratorsRef: MutableRefObject<Map<string, TrustedCollaborator>>;
} {
  const [collaborators, setCollaborators] = useState<
    Map<string, TrustedCollaborator>
  >(new Map());
  const collaboratorsRef = useRef(collaborators);
  const resolvedRef = useRef(new Map<string, TrustedCollaborator>());

  useEffect(() => {
    if (!awareness || !docAddress || !viewKey) {
      collaboratorsRef.current = new Map();
      setCollaborators(collaboratorsRef.current);
      return;
    }

    let cancelled = false;

    const recompute = () => {
      const states = awareness.getStates();
      const next = new Map<string, TrustedCollaborator>();
      const pending: Promise<void>[] = [];

      states.forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const sessionPubkey = (state as { user?: { sessionPubkey?: string } })
          ?.user?.sessionPubkey;
        if (!sessionPubkey) return;

        const cached = resolvedRef.current.get(sessionPubkey);
        if (cached) {
          next.set(sessionPubkey, cached);
          return;
        }

        pending.push(
          (async () => {
            const resolved = resolveAttested(sessionPubkey);
            const profile = resolved
              ? await fetchProfileCached(resolved.realPubkey, relays)
              : null;
            const identity = resolved?.realPubkey ?? sessionPubkey;
            const trusted: TrustedCollaborator = {
              sessionPubkey,
              realPubkey: resolved?.realPubkey ?? null,
              name: resolved
                ? profile?.display_name || profile?.name || shortenPubkey(identity)
                : "Anonymous",
              color: colorFromPubkey(identity),
              picture: profile?.picture,
            };
            resolvedRef.current.set(sessionPubkey, trusted);
            next.set(sessionPubkey, trusted);
          })(),
        );
      });

      if (pending.length === 0) {
        collaboratorsRef.current = next;
        setCollaborators(next);
        return;
      }

      Promise.all(pending).then(() => {
        if (cancelled) return;
        collaboratorsRef.current = next;
        setCollaborators(next);
      });
    };

    recompute();
    awareness.on("change", recompute);
    return () => {
      cancelled = true;
      awareness.off("change", recompute);
    };
  }, [awareness, docAddress, viewKey, relays]);

  return { collaborators, collaboratorsRef };
}
