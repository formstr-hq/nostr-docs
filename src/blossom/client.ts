import { signerManager } from "../signer";

async function buildAuthHeader(sha256: string, action: "upload" | "delete" = "upload"): Promise<string> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer available");

  const expiration = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour
  const eventTemplate = {
    kind: 24242,
    tags: [
      ["t", action],
      ["x", sha256],
      ["expiration", String(expiration)],
    ],
    content: "Upload file",
    created_at: Math.floor(Date.now() / 1000),
    pubkey: await signer.getPublicKey(),
  };

  const signed = await signer.signEvent(eventTemplate);
  return `Nostr ${btoa(JSON.stringify(signed))}`;
}

/**
 * Upload an encrypted blob to one or more blossom servers (BUD-02).
 * Tries all servers in parallel, returns the URL from the first success.
 */
export async function uploadToBlossom(
  servers: string[],
  encryptedData: Uint8Array,
  sha256: string,
): Promise<string> {
  if (servers.length === 0) throw new Error("No blossom servers configured");

  const authorization = await buildAuthHeader(sha256, "upload");

  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const base = server.replace(/\/$/, "");
      const res = await fetch(`${base}/upload`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: authorization,
        },
        body: new Blob([encryptedData.buffer as ArrayBuffer]),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${server}: HTTP ${res.status} — ${text}`);
      }
      // BUD-01 response: { url, sha256, size, ... }
      const json = await res.json().catch(() => ({}));
      return (json.url as string) || `${base}/${sha256}`;
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") return result.value;
  }

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => String(r.reason));
  throw new Error(`All blossom uploads failed:\n${errors.join("\n")}`);
}

/**
 * Delete a blob from all blossom servers (BUD-04). Best-effort — errors are
 * collected but don't throw so a partial success still removes the node.
 */
export async function deleteFromBlossom(
  servers: string[],
  sha256: string,
): Promise<void> {
  if (!servers.length || !sha256) return;

  const authorization = await buildAuthHeader(sha256, "delete");

  await Promise.allSettled(
    servers.map(async (server) => {
      const base = server.replace(/\/$/, "");
      const res = await fetch(`${base}/${sha256}`, {
        method: "DELETE",
        headers: { Authorization: authorization },
      });
      if (!res.ok && res.status !== 404) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${server}: HTTP ${res.status} — ${text}`);
      }
    }),
  );
}
