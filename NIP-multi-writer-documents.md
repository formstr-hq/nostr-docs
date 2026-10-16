# NIP-XX: Multi-Writer Encrypted Documents

`draft` `optional`

A document is a set of per-author replaceable events, all encrypted with one
shared key; the newest version across the authorized authors is the document.
Yjs is used only for live, in-session merging — it is not a durable store. The
owner controls who may write through an encrypted roster.

## Conventions

- **viewKey**: random 32-byte key. NIP-44 conversation key =
  `nip44.getConversationKey(viewKey, getPublicKey(viewKey))`.
- **root address**: `33457:<owner-pubkey>:<d>`.
- **room**: `getPublicKey(viewKey)` — a capability identifier for the realtime
  channel (computable only by viewKey holders).
- All `content` is NIP-44 encrypted with the viewKey.

## Link

```
/doc/<naddr>#<nkeys>
```

- `<naddr>`: NIP-19 address of the root (`kind=33457`, `pubkey=owner`, `identifier=d`).
- `<nkeys>`: `bech32` string, prefix `nkeys`, over TLV pairs (`0` = field name,
  `1` = value). Fields: `viewKey` (hex, required); `editKey` (hex, legacy only).

## Events

### Content — kind `33457` (parameterised replaceable on `d`)

- tags: `["d", <document id>]`, `["a", <room>]`
- content: the document Markdown
- signed by the author
- one event per author (their own replaceable slot); the newest across authors is
  the document

### Roster — kind `34579` (parameterised replaceable on `d`)

- `d` = root address; authored by the owner
- content: JSON
  ```json
  { "v": 2, "epoch": 1, "mode": "restricted" | "open",
    "members": [{ "pubkey": "<hex>",
                  "author": "<optional author-key pubkey, see below>",
                  "role": "editor" | "viewer" }],
    "title": "<optional>", "tags": ["<optional>"] }
  ```
- Clients use the roster with the greatest `epoch`, then `created_at`, then `id`.
  The owner MAY rotate the viewKey and increment `epoch` to revoke prior readers;
  a client MUST NOT use a roster with a lower `epoch` than one it has seen.

### Author keys (recommended)

To keep authorship off relays, writers SHOULD sign document events (content)
with a **per-document keypair** ("author key") instead of their real key, so the
event `pubkey` is an unlinkable per-document pseudonym.

- Generate one author key per (user, document) and persist its secret alongside
  the viewKey in the user's private list, so all of that user's devices reuse it.
- The roster carries each member's author pubkey in its `author` field.
- The roster is itself signed by the owner's author key; the share link carries
  the owner's author pubkey so clients know which roster is authoritative.
- The **author set used in resolution is each member's `author`**, falling back
  to `pubkey` for members (or clients) that predate this extension.

### Realtime (optional)

- `22457` CRDT op / `24578` presence: NIP‑44(viewKey) of the JSON envelope
  `{ "a": <attestation token | null>, "m": "<base64 Yjs sync/awareness message>" }`;
  tag `["a", <room>]`; signed by a session key.
- The **attestation token** (`a`) is a real-key-signed event (kind `34581`),
  plaintext content `{ "realPubkey": "<hex>", "expiresAt": <unix> }`, tag
  `["d", "<room>:<sessionPubkey>"]`. It is **not published** — it rides inside each
  op/presence, so a peer can resolve `session → realPubkey` (for presence
  attribution and restricted-mode authorisation) and relays never see the real
  key. Signed once per session (one signer prompt).

Realtime is **capability-authorized**: any viewKey holder may send ops/presence.
In `restricted` mode this is weaker than the content rule, so a client that
requires restricted semantics MUST ignore an op/presence whose session
attestation (`34581`) does not resolve to a roster `editor`.

## Resolution

1. From the pointer (root address, viewKey, and — if present — the owner's author
   pubkey), compute the room.
2. Fetch the roster `{kinds:[34579], authors:[<owner author pubkey, else owner>],
   "#d":[root]}`, decrypt with the viewKey. Absent roster ⇒ single author (owner).
3. Fetch content:
   - `restricted`: `{kinds:[33457], authors:[<roster author set>], "#d":[d]}`
   - `open`: `{kinds:[33457], "#a":[room]}`
   where the roster author set is the owner plus every `editor` member, each as
   their `author` pubkey (or their `pubkey` when absent).
4. Discard events that do not decrypt with the viewKey. Clamp `created_at` to
   `now + 300s` (relays do not validate timestamps); the document is the Markdown
   **tip**, the greatest `(created_at, id)` across the authorized authors.
5. For realtime, subscribe live to `{kinds:[22457,24578], "#a":[room]}` and merge
   incoming ops into an in-memory Y.Doc. Yjs is not persisted to relays: on a new
   session a client seeds its Y.Doc from the Markdown tip.

## Examples

`content` below is ciphertext (`<nip44: …>` shows the plaintext that was
encrypted). For the realtime events the plaintext is the JSON envelope shown.

Content — kind `33457`:
```json
{ "kind": 33457, "pubkey": "<author>", "created_at": 1700000000,
  "tags": [["d", "<d>"], ["a", "<room>"]],
  "content": "<nip44: # Title\n\nMarkdown body>" }
```

Roster — kind `34579`, owner-signed:
```json
{ "kind": 34579, "pubkey": "<owner>", "created_at": 1700000000,
  "tags": [["d", "33457:<owner>:<d>"]],
  "content": "<nip44: {\"v\":2,\"epoch\":1,\"mode\":\"restricted\",\"members\":[{\"pubkey\":\"<editor>\",\"role\":\"editor\"}],\"tags\":[]}>" }
```

CRDT op — kind `22457` (presence `24578` is identical with an awareness update):
```json
{ "kind": 22457, "pubkey": "<sessionPubkey>", "created_at": 1700000000,
  "tags": [["a", "<room>"]],
  "content": "<nip44: {\"a\": <token or null>, \"m\": \"<base64 of the Yjs message>\"}>" }
```

The embedded `a` token (not published) is a normal signed event:
```json
{ "kind": 34581, "pubkey": "<realPubkey>", "created_at": 1700000000,
  "tags": [["d", "<room>:<sessionPubkey>"]],
  "content": "{\"realPubkey\":\"<realPubkey>\",\"expiresAt\":1700432000}",
  "id": "<…>", "sig": "<…>" }
```

## Deletion

Kind `5` with `a` = the root address, authored by the owner, tombstones the
document for clients.

## Compatibility

A document with no roster resolves as a single author. The legacy edit-key model
(shared signing key, no roster) is read as such; `nkeys` fragments carrying
`editKey` remain valid.
