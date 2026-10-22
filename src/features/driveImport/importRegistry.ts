/**
 * src/features/driveImport/importRegistry.ts
 * Remembers which Pages document a Drive file was imported as, so opening the
 * same file again returns to that page instead of creating a duplicate.
 */

import type { NormalizedDrivePayload } from "./types";

const STORAGE_KEY = "driveImportRegistry";

type Registry = Record<string, string>;

function readRegistry(): Registry {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Registry;
  } catch {
    return {};
  }
}

/** Identity of a Drive file: where it is stored plus its content hash(es). */
export function importSourceKey(payload: NormalizedDrivePayload | null): string | null {
  if (!payload) return null;
  const hashes = payload.blobHash ?? payload.chunks?.map((chunk) => chunk.hash).join(",") ?? payload.name;
  return `${payload.server}|${hashes}`;
}

/** Address of the page this source was imported as, if any. */
export function importedAddress(sourceKey: string | null): string | undefined {
  return sourceKey ? readRegistry()[sourceKey] : undefined;
}

export function rememberImportedAddress(sourceKey: string | null, address: string): void {
  if (!sourceKey) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readRegistry(), [sourceKey]: address }));
  } catch {
    // Storage unavailable: the worst case is a second copy on the next open.
  }
}
