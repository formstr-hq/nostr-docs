# Sharing v2 — Implementation Plan

Multi-writer encrypted documents per `NIP-multi-writer-documents.md`. This plan is
**additive and migration-free**: every existing document shape keeps working, and
v2 is detected per-document. No relay data is rewritten and no local rows are
dropped.

> Note: `ARCHITECTURE.md` mentions a kind-11234 shared list; that is stale — the
> real "shared with me" store is kind-34579 metadata carrying `viewKey`/`editKey`.
> Update the doc as part of this work.

## Model mapping

The pervasive assumption today is **"one document = one author's address"**
(`kind:pubkey:d`). Every consumer keys and groups by `getEventAddress(event)`
(e.g. `DocumentContext.visibleDocuments`, `DocEditorController.isOwner`,
`AllPagesView`, `DocList`). v2 generalizes this with one abstraction:

```
DocumentRef = {
  documentId: string   // map key. Root address for group docs; author address for legacy
  owner: string        // root pubkey. For legacy single-author docs, === event.pubkey
  viewKey?: string
  editKey?: string     // legacy edit-key shares only
  roster?: DocRoster   // present only for v2 group docs
}
```

**Key invariant:** for a legacy doc the `documentId` and `owner` equal the current
address and `event.pubkey`, so behavior is byte-for-byte unchanged. A v2 group doc
is keyed by its **root** address (`33457:<owner>:<d>`) while its `versions[]` hold
events from every author.

## Backwards-compatibility contract

| Shape | Address | Content key | Signer | v2 handling |
|---|---|---|---|---|
| Personal doc | `33457:owner:d` | self (signer) | owner | unchanged; `owner = event.pubkey`, no roster |
| View-only share | `33457:owner:d` | viewKey | owner | viewKey decrypt path; `owner` = naddr pubkey, no roster |
| Edit-key share | `33457:editKeyPub:d` | viewKey | editKey | **no roster → single-author group**; editKey signing preserved |
| Tag/title metadata | `34579:user:<address>` | self | user | read self-first, viewKey fallback (Phase 2) |
| Shared-with-me entry | `34579:user:<address>` | self | user | unchanged; gains `role` (Phase 5) |
| Device-only | `33457:owner:d` | self | unsigned | unchanged |

Rules that make this work:

1. **No roster ⇒ single-author group.** Roster fetch is best-effort; absence
   degrades to `authors = [owner]`, which is exactly today's behavior.
2. **Missing viewKey ⇒ legacy signer path.** Group resolution only runs when a
   viewKey is known; personal docs keep the signer decrypt path.
3. **Metadata self-decrypt stays first.** viewKey decryption is only attempted as
   a fallback, so existing private metadata is untouched.
4. **New links carry only `viewKey`.** Old `nkeys` with `editKey` still decode
   (`nkeys.ts` unchanged); old links keep opening and editing.

## Phases

### Phase 0 — model module ✅ (done)
`src/nostr/sharedDoc.ts`: types, roster parse/encode, author set, deterministic
tip selection, `fetchRoster`, `fetchGroupEvents`, `resolveSharedDocument`. Pure
and React-free.

### Phase 1 — document reference + keying ✅ (done)
Make `DocumentContext` capable of grouping multiple authors under one document,
with defaults preserving legacy behavior.

- `DocumentHistory` gains `owner?: string`.
- `addDocument(document, keys?, ref?: { documentId?: string; owner?: string })`;
  `documentId` defaults to the event address, `owner` to `event.pubkey`.
- `visibleDocuments` / `visitedDocuments` derive ownership from
  `history.owner ?? versions[0].event.pubkey`.
- `DocEditorController.isOwner` and `DocPage` visited-detection use the same
  fallback.
- No caller passes `documentId` yet, so runtime behavior is identical.

**Done when:** `tsc -b` passes and existing e2e sharing/paging flows are unchanged.

### Phase 2 — metadata as roster (read + write) ✅ (done)
- `docMetadata.ts`: viewKey-aware read path (self first, then viewKey) and
  `saveRoster(owner, d, viewKey, roster)` written viewKey-encrypted under the
  owner's signer.
- `DocMetadataContext`: loads viewKeys from the local store, reads rosters, and
  routes owner tag/title writes through `saveRoster` when the metadata carries
  `members` (personal/legacy writes are untouched).

**Done when:** a v2 owner can set tags/title, they round-trip through the roster,
and legacy tags/titles are unaffected.

### Phase 3 — resolution wiring ✅ (done)
- `DocPage`: when a viewKey is known, resolve the doc as a group — roster, then
  every author's newest version under the root `documentId` — falling back to the
  legacy single-author path when there is no roster.
- `SharedDocsContext`: per entry, fetch the roster to learn the author set, then
  subscribe to `{kinds:[33457], authors:<all>, "#d":[d]}` live. Owner-routed
  events land in personal documents; other authors land in the shared store keyed
  by root. No roster ⇒ the previous single-author subscription.

**Done when:** a v2 doc with two editors shows the newest author's version to all
of them; a legacy edit-key link still opens and edits.

### Phase 4 — share flow v2
- Data layer ✅: `shareV2.ts` — `enableGroupSharing` (re-publish owner content
  under viewKey + empty roster), `updateRosterMembers` / `upsertMember` /
  `removeMember`.
- Remaining: UI. New private share generates only `viewKey`, keeps the owner's
  own slot, publishes the roster, URL `#nkeys({viewKey})`; member management adds
  or removes an editor by pubkey/npub (owner only). Legacy edit-key path stays for
  docs already shared that way; never rotate.

**Done when:** the owner shares, adds an editor, the editor opens/edits, and both
see the tip; existing legacy links are untouched.

### Phase 5 — shared-with-me list
- Participant entries add `role`; the owner's roster is the owner's own entry.
- `SharedDocsContext` list continues to work for legacy entries.

### Phase 6 — realtime CRDT (later)
Per-author slots let each author's durable snapshot be a Yjs state; loading
applies every author's state (`Y.applyUpdate`) instead of only the winner. Same
relay shape, no migration.

## Verification

- `npm run build` (tsc + vite) and `npm run lint` per phase.
- e2e: add a legacy-link spec and a v2 two-editor spec.
- Manual matrix: personal doc, view-only link, edit-key link, v2 link (owner +
  editor), tag/title edits, device-only.

## Risks

- **Keying refactor breadth.** Phase 1 touches ownership derivation in several
  consumers; mitigated by the legacy-default invariant and type-checking.
- **Metadata dual-encryption.** Must never discard the self-encrypted path; read
  self first, viewKey second.
- **Realtime ephemeral vs durable.** Snapshots are LWW in v1; CRDT merge is Phase
  6 and needs durable ops/state to fully cover same-author multi-device.

## Out of scope (v1)

- Push invites (no-link). Key delivery is via the share link.
- Read revocation / key epochs.
- Ownership transfer.
