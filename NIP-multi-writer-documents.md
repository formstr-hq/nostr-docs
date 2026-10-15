# NIP-XX: Multi-Writer Encrypted Documents

> **Status:** draft / discussion.
> **Scope:** app-specific (Formstr Pages, `nostr-docs`). Kind numbers below are
> the ones the app already uses and must be confirmed against the NIP registry
> before submission.

## Abstract

This NIP defines an encrypted document that can be collaboratively written by
several authors **without a shared signing key**. Each author publishes their
own parameterized-replaceable snapshot under their own pubkey; all snapshots are
encrypted with one shared symmetric *view key*. A document is reconstructed by
fetching every authorized author's slot and selecting the newest valid one. The
owner controls who may write through a signed, shareable *metadata* event.

## Motivation

The previous model shares a random **edit key**: every collaborator signs a full
snapshot with that key, so all writers target one replaceable event address
(`kind:pubkey:d`). Relays keep only the newest `created_at`, therefore

- every writer overwrites every other writer,
- a stale client save silently replaces newer content,
- the document has no durable per-author history.

Making the **author pubkey part of the address** gives each writer an independent
replaceable slot, so writers stop clobbering each other. The only thing shared is
the view key; write authorization is a signed roster.

## Terminology

- **Document id (`d`)** — opaque value chosen by the owner (e.g. 16 random bytes
  hex). Shared by all authors.
- **Root address** — `33457:<owner-pubkey>:<d>`. Canonical identity of the
  document; also the URL pointer (`naddr`).
- **Author slot** — `33457:<author-pubkey>:<d>`, one per writer.
- **viewKey** — random 32-byte key. Encrypts every content event via
  NIP-44 (conversation key derived from `(viewKey, viewKey's public key)`).
  Never published in the clear.
- **Roster** — owner-signed list of authorized authors and roles, carried in the
  shared metadata event.

## Event kinds

| Kind | Name | Replaceable? | Author | Purpose |
|------|------|--------------|--------|---------|
| `33457` | Content version | parameterized (`d`) | each author | Encrypted document snapshot |
| `34579` | Metadata / roster | parameterized (`d`) | owner | Shareable doc metadata + authorized authors |
| `34579` | Participant entry | parameterized (`d`) | any user | Private "shared with me" pointer |
| `22457` | CRDT op (optional, later) | ephemeral | each author | Live sync (Yjs) |
| `24578` | Presence (optional, later) | ephemeral | each author | Live awareness |
| `5` | Deletion | — | owner / author | Tombstone the group / own slot |

## Document identity

The owner picks `d` and publishes the first content event at the root address.
The canonical pointer is

```
naddr (kind 33457, pubkey = owner, identifier = d)
```

Editors publish content events with the **same `d`** but **their own pubkey**, so
their addresses are distinct and independently replaceable. A relay therefore
never replaces an editor's version with the owner's, or vice versa.

## viewKey

- viewKey is a random 32-byte value created by the owner at first share.
- Every content event is NIP-44 encrypted with viewKey.
- Because NIP-44 requires a keypair, use the symmetric convention:
  `nip44.getConversationKey(viewKey, getPublicKey(viewKey))`.
- viewKey grants **read** and the ability to produce ciphertext. Write authorization
  comes from the roster, not from viewKey.

## Content events (kind 33457)

- `d` = document id.
- `content` = NIP-44(viewKey) of the app payload (Markdown, or app-defined JSON).
- signed by the author's own key.
- Optional tags:
  - `["e", <parent-event-id>]` — lineage to the version this was based on.
    **Deferred to the CRDT phase**; not required in v1.

An event is only considered if:
1. its author is the owner or a roster `editor`, and
2. it decrypts with viewKey, and
3. the author's slot is not tombstoned.

The owner is always an implicit member and author.

## Metadata events (kind 34579)

Kind `34579` is parameterized-replaceable on `(kind, pubkey, d)`. It carries two
distinct roles, separated by author:

### (a) Shared document metadata / roster — authored by the owner

- `d` = root address.
- `content` = NIP-44(**viewKey**) of the JSON below. This is what makes the event
  *shareable*: it is encrypted with viewKey rather than to the owner's own key,
  so every member who holds viewKey can read it and it travels with the document.
- Because it is viewKey-encrypted, member pubkeys, title and tags are visible **only
  to viewKey holders** — not to relays and not to the public.
- Content:

```json
{
  "v": 2,
  "title": "…",
  "tags": ["…"],
  "members": [
    { "pubkey": "<hex>", "role": "editor" },
    { "pubkey": "<hex>", "role": "viewer" }
  ]
}
```

- `role` is `editor` (may author content) or `viewer` (read-only).
- The owner is implicitly a member.
- Latest by `created_at` wins (parameterized replaceable on owner + `d`).
- Clients **must** read the roster from the owner's address only, never from a
  non-owner event.
- Optional (push invites, later): `["p", <member-pubkey>, <role>]` tags so a
  member's client can discover an invitation without a link. Tags are always
  public, so this trades membership privacy for auto-discovery — see *Sharing and
  key delivery*.

### (b) Private participant entry — authored by each user

- `d` = root address.
- `content` = NIP-44(self) of `{ "v": 2, "role": "editor", "viewKey": "<hex>" }`.
- This is the per-user "shared with me" record; it lets the user's other devices
  open the document offline without re-fetching the roster.
- For a document the user owns there is no separate private entry: the owner's
  shared metadata (a) is their copy.

If the owner's roster is absent, the group degenerates to a single-author
document owned by `owner`.

## Resolution algorithm

1. From the pointer, decode `(owner, d)`.
2. Fetch the latest roster: `{kinds:[34579], authors:[owner], "#d":[d]}` and
   decrypt it with viewKey.
3. Author set = `{owner} ∪ { m : role = editor }`. If no roster, `{owner}`.
4. Fetch content `{kinds:[33457], authors: authorSet, "#d":[d]}`, live-subscribe
   to the same filter.
5. Drop events that do not decrypt with viewKey or whose author is not in the set.
6. **Tip** = newest by `(created_at desc, id asc)`; clamp `created_at` to
   `min(created_at, now + MAX_SKEW)`.
7. Render the tip. Keep each author's latest snapshot for the version-history
   picker.
8. Re-run on roster changes: adding/removing an editor changes the author set and
   the live subscription.

## Sharing and key delivery

- **View-only:** URL = `naddr#nkeys(viewKey)`. The holder can read; publishes are
  ignored because they are not in the roster.
- **Edit:** the owner adds the pubkey as an `editor` in the viewKey-encrypted roster
  and sends the member a link carrying viewKey. The member decrypts the roster and
  starts syncing.
- **Invite privacy:** with viewKey-encrypted metadata and link delivery, member
  pubkeys are exposed only to viewKey holders — never to relays or the public.
- **Optional push invites (later):** to add a member without sending a link, the
  invitation must be discoverable *without* viewKey, which requires a public surface
  (e.g. `p` tags or a NIP-59 gift wrap). NIP-59 also exposes the recipient pubkey
  in its `p` tag, so push invites leak membership regardless of the carrier. A
  hashed-mailbox tag (`sha256(member-pubkey)`) reduces the leak but not to zero.
  Out of scope for v1.

## Realtime (planned, not v1)

For live editing, authors may publish ephemeral CRDT ops (`22457`) and presence
(`24578`), NIP-44(viewKey) encrypted, tagged with the root address, signed by the
author (or a short-lived session key bound to the author via a signed
attestation). Convergence is Yjs's responsibility. This NIP defines only the
transport and authorization rule (author in roster, holds viewKey).

## Conflict handling

v1 uses **plain last-write-wins** tip selection, deliberately, because per-author
slots already preserve work:

- **Across different authors, nothing is destroyed.** If A and B both save, A's
  newest remains in A's slot and B's newest in B's slot; the tip rule only
  decides what renders. The other version stays fetchable and is offered in the
  version-history picker.
- **Same author on two devices is the only true loss**, because both write the
  same slot (same pubkey). This is the case a CRDT checkpoint layer would fix.

v1 therefore takes **no automatic conflict action and shows no blocking prompt**.
Lineage/detection tags are deferred; a future revision adds CRDT checkpoints for
automatic cross-session merge. (Detection without merge is not a durability
mechanism and is intentionally not shipped.)

## Deletion

- **Owner deletes the document:** publish kind `5` targeting the root address
  (`a` tag `33457:<owner>:<d>`). Clients treat this as tombstoning the whole group
  and ignore all authors.
- **Editor leaves:** publish kind `5` targeting their own slot only. Their events
  stop counting (also removed by the roster update).

## Revocation and key rotation

- Removing an editor from the roster revokes **write** immediately.
- It does **not** revoke **read**: anyone who ever held viewKey can still decrypt
  every event. To revoke read, the owner must rotate viewKey (generate a new one
  and re-share it to the remaining members) and begin publishing under a new key
  epoch.
- A future revision MAY add a `keyEpoch` field so old and new ciphertexts coexist
  and only current members can read new content.

## Security considerations

- **viewKey compromise** exposes all content, past and future. There is no forward
  secrecy; viewKey is a long-lived symmetric secret.
- **Roster gating is client-side.** Relays cannot enforce it. Any viewKey holder can
  publish decryptable ciphertext; clients ignore it unless the author is in the
  roster. This is not a consensus guarantee against a modified client.
- **`created_at` is untrusted**; clamp future timestamps.
- **Metadata privacy:** the shared metadata is NIP-44(viewKey) encrypted, so member
  pubkeys, title and tags are readable by viewKey holders (members and anyone holding
  the view link) but not by relays or the public. If a future push-invite
  mechanism adds public tags, membership becomes public instead.
- **Spam:** anyone may publish `33457` events with the same `d`. Clients should
  filter by author set before attempting decryption.

## Backwards compatibility

- **Legacy personal docs:** single author, self-encrypted, no viewKey. Unchanged.
- **Legacy shared docs (edit-key):** treat as a single-author group whose author
  is the edit-key pubkey, with no roster. The `naddr` still resolves. Keep
  decoding `editKey` from old `nkeys` fragments.
- **New shares** carry only the view key; the edit key is removed in v2.
- The app may promote a legacy doc to the new model on the next share, keeping
  the same `d`.

## Rationale / alternatives

- **Single shared signing key (previous model):** rejected — one replaceable slot
  means writers overwrite each other.
- **Dedicated roster kind (`33458`):** viable and cleaner conceptually, but
  reusing `34579` keeps metadata, tags, and members in one event and one fetch
  path.
- **Fully CRDT-backed documents:** better merge semantics, but durable CRDT
  history is heavier; planned as a later phase layered on this transport.

## Open questions

1. Invite delivery: link-based (private, v1) vs. push discovery via public tags /
   NIP-59 / hashed mailbox (automatic, but leaks membership)?
2. Rotate/epoch design for read revocation.
3. Ownership transfer / multiple owners (out of scope for now).
4. Whether tags/title in shared metadata are owner-authoritative or editable by
   all editors (last-write-wins on the metadata event).
