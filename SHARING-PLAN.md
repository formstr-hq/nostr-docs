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

### Content-event addressing (v2)

Every content event carries **both**:

- `["d", d]` — the document id.
- `["a", rootAddress]` — the document (root address) this version "forks from" /
  belongs to.

The `a` tag is what lets any version be found **without enumerating authors** —
query `{kinds:[33457], "#a":[root]}` — and makes a document's versions unambiguous
even if two documents ever pick the same `d`. Legacy events simply lack it, so
they resolve through the existing address/`d` paths.

## Write-authorization modes

The owner's control event (kind 34579, viewKey-encrypted) declares the mode:

- **`mode: "restricted"`** (default) — `members[]` lists editor pubkeys.
  Resolution: roster → authors → `{kinds:[33457], authors, "#d":[d]}`. Bounded,
  revocable (remove a pubkey), routable (NIP-65 outboxes).
- **`mode: "open"`** — anyone holding the viewKey may write (capability model).
  Resolution: `{kinds:[33457], "#a":[root]}`, accepting any version that decrypts
  with the viewKey. This preserves the old "anyone with the link can edit" UX,
  but each writer still signs with their **own** key, so slots never clobber.

Control events (roster, mode, title, tags) are always **owner-authored**; only the
owner may change membership or the mode. "Open" applies to content versions only.

Trade-offs of `open` (why it is not the default): unbounded author set →
spam/DoS surface; any link-holder can win the LWW tip (denial-of-view); no
per-writer revocation except rotating the viewKey; and unknown authors cannot be
routed to their outboxes, so readers on different relay sets can disagree.
Restricted mode avoids all of these. Open mode is the mode that most needs the
CRDT merge below.

## CRDT compatibility

The on-relay shape is chosen so a CRDT merge can be layered on later **without
migration**. Invariants to preserve from day one:

1. **Per-author cells.** Storage is an LWW-map keyed by author: each author's
   replaceable slot only advances, and no author's write destroys another's. This
   is precisely the structure a CRDT merge needs — the concurrent inputs survive.
2. **Stable origin.** Every version is signed by its author's own key, giving each
   event a replica identity. (The old shared editKey collapsed all origins into
   one, which is why it could never be merged.)
3. **Mergeable payload.** Content is app-defined and versioned, so a snapshot can
   later carry a Yjs/CRDT state instead of raw Markdown. A client then loads by
   applying **every** author's state, not just the tip.
4. **Addressed ops.** Live CRDT ops (kind 22457) and presence are tagged with the
   root address and encrypted with the viewKey, so they attach to the same
   document for every author in either mode.
5. **Lineage hooks.** Reserve a parent reference (`["e", <base-tip-id>]`) on content
   events so divergent branches can be detected and later merged. v1 does **not**
   gate UX on it; a later revision may store a revision/state-vector.

Migration (Phase 6): keep today's LWW tip as the fallback renderer; add a merge
layer that, when more than one author has a concurrent version, applies all of
them through the CRDT and writes the merged result back into the author's own
slot. Because storage already retains every author's branch, this is purely
additive.

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

### Phase 4 — share flow v2 + modes ✅ (done)
- Data layer ✅: `shareV2.ts` — `enableGroupSharing` (re-publish owner content
  under viewKey + roster), `updateRosterMembers` / `upsertMember` / `removeMember`
  / `setDocMode`.
- **`a` tag** ✅: every v2 content event carries `["a", rootAddress]`; open mode
  resolves by `#a`.
- **Mode** ✅: the control event carries `mode: "restricted" | "open"`; the share
  dialog has the View / Anyone-with-the-link / Invited-editors selector.
- **UI** ✅: editors list (add/remove by npub or hex); owner v2 share path.
- **Editor write path** ✅: non-owners may edit when open mode or a roster editor;
  their version is keyed under the root document.

**Done:** owner shares (either mode), the counterpart opens/edits, and all see the
tip; legacy links are untouched. e2e: `tests/e2e/sharing.spec.ts` (open mode).

### Phase 5 — shared-with-me list (works; minor polish left)
- Participant entries store `viewKey` (self-encrypted, kind 34579) and resolve
  the roster on demand; the list works for legacy and v2 entries.
- Optional polish: surface the owner's roster title/tags to participants (they
  currently read only their own metadata) and store `role`/`mode` on the entry.

### Phase 6 — live collaboration (ephemeral) ✅
- ✅ **Live collaboration + presence**: Yjs ops (kind 22457) and awareness
  (24578) over Nostr, viewKey-encrypted, tagged `["a", room]`; per-tab session
  keys with an **embedded** attestation token (kind 34581, never published).
  Writers on a shared doc edit live and merge via Yjs; solo/legacy paths
  untouched. Re-syncs on reconnect (`online` event), not just the 60s step.
- **Yjs is ephemeral**: the document's durable store is the Markdown snapshots
  (33457). Each session seeds from the Markdown tip and merges live. Cross-session
  / offline conflict is therefore last-write-wins on the Markdown tip (accepted
  for v1).
- **Durable CRDT checkpoints were removed** (kind 34582) — they bloated relays
  (full Yjs state per author) and were unnecessary while the Markdown baseline is
  authoritative. Revisit only if cross-session offline merge is needed.
- Remaining: lineage/revision for the `open`-mode adversarial case.

**Tests** (`tests/e2e/sharing.spec.ts`): open-share round-trip, live reflection
without saving, concurrent writers, an offline writer merging on reconnect, and
a three-party convergence.

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
- **Open-mode conflicts.** Under `open` mode any link-holder can win the Markdown
  tip by writing last (denial-of-view), and there is no per-writer write
  revocation. Mitigations: keep `restricted` the default, stamp `["a", room]` for
  discovery, and only honor the **owner's** kind-5 tombstone.
- **Realtime is ephemeral.** In-session edits merge via Yjs, but across sessions /
  offline the Markdown tip is last-write-wins: a returning offline writer can win
  with a stale snapshot, and same-author multi-device isn't merged. Accepted for
  v1; the documented upgrade is durable CRDT checkpoints (removed for now for
  relay-size reasons).

## Out of scope (v1)

- Push invites (no-link). Key delivery is via the share link.
- Read revocation / key epochs.
- Ownership transfer.
