# NIP-XX: Multi-Writer Encrypted Documents

`draft` `optional`

A document is a set of per-author replaceable events, all encrypted with one
shared key; the newest version across the authorized authors is the document.
The owner controls who may write through an encrypted roster.

## Conventions

- **viewKey**: random 32-byte key. NIP-44 conversation key =
  `nip44.getConversationKey(viewKey, getPublicKey(viewKey))`.
- **root address**: `33457:<owner-pubkey>:<d>`.
- **room**: `getPublicKey(viewKey)` — a capability identifier for the realtime
  channel (computable only by viewKey holders).
- All `content` is NIP-44 encrypted with the viewKey.

## Events

### Content — kind `33457` (parameterised replaceable on `d`)

- tags: `["d", <document id>]`, `["a", <root address>]`
- content: the document Markdown
- signed by the author
- one event per author (their own replaceable slot)

### Roster — kind `34579` (parameterised replaceable on `d`)

- `d` = root address; authored by the owner
- content: JSON
  ```json
  { "v": 2, "mode": "restricted" | "open",
    "members": [{ "pubkey": "<hex>", "role": "editor" | "viewer" }],
    "title": "<optional>", "tags": ["<optional>"] }
  ```
- latest by `created_at` wins; only the owner's roster is authoritative

### Realtime (optional)

- `22457` CRDT op / `24578` presence: content = base64 Yjs sync/awareness
  message, tag `["a", <room>]`, signed by a session key.
- `34581` session attestation: `d` = `<room>:<sessionPubkey>`, content
  `{ "realPubkey": "<hex>", "expiresAt": <unix> }`, signed by the author's real key.
- `34582` durable Yjs checkpoint (parameterised replaceable on `d`): `d` and `a`
  = room; content = base64 `Y.encodeStateAsUpdate`. One per author.

## Resolution

1. From the pointer (root address + viewKey), compute the room.
2. Fetch the roster `{kinds:[34579], authors:[owner], "#d":[root]}`, decrypt with
   the viewKey. Absent roster ⇒ the document has a single author (the owner).
3. Fetch content:
   - `restricted`: `{kinds:[33457], authors:[owner, ...editor members], "#d":[d]}`
   - `open`: `{kinds:[33457], "#a":[root]}`
4. Discard events that do not decrypt with the viewKey. The **tip** is the
   greatest `(created_at, id)`.
5. For realtime, apply every author's checkpoint (`34582`, `#d`/`#a` = room) to a
   Y.Doc; subscribe live to `{kinds:[22457,24578], "#a":[room]}`.

## Deletion

Kind `5` with `a` = the root address, authored by the owner, tombstones the
document for clients.

## Compatibility

A document with no roster resolves as a single author. The legacy edit-key model
(shared signing key, no roster) is read as such; `nkeys` fragments carrying
`editKey` remain valid.
