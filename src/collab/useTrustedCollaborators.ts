import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Awareness } from "y-protocols/awareness";
import { resolveSession } from "./sessionKeys";
import { fetchProfileCached } from "./profileCache";

export interface TrustedCollaborator {
  sessionPubkey: string;
  // null for an anonymous collaborator — editKey possession already
  // authorizes their edits (see NostrYjsProvider); there's just no bound
  // real identity to attribute a name/avatar to.
  realPubkey: string | null;
  name: string;
  color: string;
  picture?: string;
}

function shortenPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
}

// Deterministic so the same collaborator always gets the same color across
// reloads/reconnects, without trusting any self-asserted color from the
// (spoofable) awareness state.
function colorFromPubkey(pubkey: string): string {
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = (hash << 5) - hash + pubkey.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

/**
 * Resolves the current set of remote awareness clients to trusted
 * collaborator identities (name/color/avatar), keyed by session pubkey.
 * "Trusted" means resolved via a verified session-attestation lookup
 * (resolveSession) and the real pubkey's profile — never taken from the
 * awareness state's self-asserted fields directly, since any session key
 * could otherwise claim any name/color.
 *
 * Returns both a React-state map (for components that re-render on change,
 * e.g. an avatar row) and a ref mirror of the same map (for the
 * CollaborationCaret render/selectionRender closures, which are plain
 * functions invoked outside React's render cycle and need synchronous,
 * always-current access).
 */
export function useTrustedCollaborators(
  awareness: Awareness | null | undefined,
  docAddress: string | null | undefined,
  editKey: string | undefined,
  relays: string[],
): {
  collaborators: Map<string, TrustedCollaborator>;
  collaboratorsRef: MutableRefObject<Map<string, TrustedCollaborator>>;
} {
  const [collaborators, setCollaborators] = useState<
    Map<string, TrustedCollaborator>
  >(new Map());
  const collaboratorsRef = useRef(collaborators);
  // Cache of already-resolved identities, independent of the current
  // awareness snapshot, so a collaborator who briefly disconnects and
  // reconnects doesn't re-trigger a relay round-trip.
  const resolvedRef = useRef(new Map<string, TrustedCollaborator>());

  useEffect(() => {
    if (!awareness || !docAddress || !editKey) {
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
        if (clientId === awareness.clientID) return; // exclude self
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
            const resolved = await resolveSession(
              docAddress,
              sessionPubkey,
              editKey,
              relays,
            );
            // No attestation doesn't mean untrusted content (editKey
            // possession already authorizes it) — it means an anonymous
            // collaborator (no logged-in signer), shown as such rather than
            // hidden.
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
  }, [awareness, docAddress, editKey, relays]);

  return { collaborators, collaboratorsRef };
}
