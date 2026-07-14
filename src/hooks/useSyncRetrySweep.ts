import { useEffect } from "react";
import { retryPendingBroadcasts } from "../lib/syncRetry";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Mounted once near the app root (not inside the editor) since pending
 * entries can belong to documents that aren't currently open. Sweeps on
 * `online` (fast path after a real reconnect) plus a periodic interval as a
 * safety net for relay-specific outages that don't flip `navigator.onLine`.
 */
export function useSyncRetrySweep(relays: string[]): void {
  useEffect(() => {
    const sweep = () => {
      retryPendingBroadcasts(relays).catch((err) =>
        console.warn("Pending-broadcast retry sweep failed:", err),
      );
    };

    sweep();
    window.addEventListener("online", sweep);
    const interval = setInterval(sweep, SWEEP_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", sweep);
      clearInterval(interval);
    };
  }, [relays]);
}
