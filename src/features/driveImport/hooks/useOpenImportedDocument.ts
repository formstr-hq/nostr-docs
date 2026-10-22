/**
 * src/features/driveImport/hooks/useOpenImportedDocument.ts
 * "Open in editor": saves the converted Drive file as a Pages document and
 * navigates to it in edit mode, reusing the page if this file was imported before.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { useDocumentContext } from "../../../contexts/DocumentContext";
import { EDIT_MODE_ROUTE_STATE } from "../editModeRoute";
import { importSourceKey, importedAddress, rememberImportedAddress } from "../importRegistry";
import { clearActiveImportPayload, getActiveImportPayload } from "./useDriveImport";

/** Route to a page given its "kind:pubkey:identifier" address. */
function docPath(address: string): string {
  const [kind, pubkey, identifier] = address.split(":");
  return `/doc/${nip19.naddrEncode({ kind: Number(kind), pubkey, identifier })}`;
}

export function useOpenImportedDocument(): (markdown: string) => Promise<void> {
  const navigate = useNavigate();
  const { addImportedDocument, visibleDocuments } = useDocumentContext();

  return useCallback(
    async (markdown: string) => {
      const sourceKey = importSourceKey(getActiveImportPayload());
      const open = (address: string) => {
        clearActiveImportPayload();
        navigate(docPath(address), { state: EDIT_MODE_ROUTE_STATE });
      };

      try {
        const existing = importedAddress(sourceKey);
        if (existing && visibleDocuments.has(existing)) return open(existing);

        // Publishing continues in the background so the editor opens straight away.
        const address = await addImportedDocument(markdown, { publish: true, awaitBroadcast: false });
        rememberImportedAddress(sourceKey, address);
        open(address);
      } catch (e) {
        console.error("Failed to import doc into editor", e);
        window.alert(
          e instanceof Error && e.message
            ? `Could not open in editor: ${e.message}`
            : "Could not open in editor. Sign in and try again.",
        );
      }
    },
    [navigate, addImportedDocument, visibleDocuments],
  );
}
