# Architecture: nostr-docs (Formstr Pages)

Nostr-docs is a Nostr-based encrypted Markdown note editor. Users write private documents that are NIP-44 encrypted before being published as Nostr events. Documents can optionally be shared via URL-embedded view/edit keys.

---

## Provider Hierarchy

```
ThemeProvider
└── UserProvider          (auth state, login modal)
    └── RelayProvider     (relay list, must be inside UserProvider)
        └── DocumentProvider   (personal documents map, decrypt)
            └── SharedPagesProvider  (shared-with-me list)
                └── BrowserRouter
                    └── App UI (AppBar, Drawer, Routes)
```

`RelayProvider` must be inside `UserProvider` because it reads `user` to fetch the user's NIP-65 relay list (kind 10002).

---

## Event Kinds

| Kind  | NIP / Purpose | Notes |
|-------|--------------|-------|
| **0** | NIP-01 User metadata | Fetched on login to populate name/avatar. Closed after first event received or EOSE. |
| **5** | NIP-09 Deletion request | Fetched on startup with `#k: [33457]` filter so deleted documents are hidden. |
| **10002** | NIP-65 Relay list | Fetched per-user to switch from default relays to user-preferred relays. |
| **11234** | Shared documents list | App-specific replaceable event. Content is NIP-44 encrypted JSON array of `[address, viewKey, editKey?]` tags representing documents shared with this user. |
| **22457** | CRDT op (ephemeral) | App-specific. Contains base64-encoded Yjs binary update. Used for real-time collaborative editing. Subscriptions are long-lived and must be closed by callers via the returned `SubCloser`. |
| **33457** | Encrypted document (replaceable) | App-specific. Content is NIP-44 encrypted Markdown. Tag `["d", <uuid>]` identifies the document. Multiple versions accumulate in `DocumentHistory`; the latest `created_at` wins for display. |

---

## Encryption Model

### Document content (kind 33457 and 11234)

All document content is NIP-44 encrypted **before** being sent to relays. Relays only ever see ciphertext.

Two encryption modes:

1. **Owner encryption** (personal documents): The signer's own pubkey is used as both sender and recipient. The NIP-44 conversation key is derived from `(privkey, pubkey)` where both sides are the same key.

2. **ViewKey encryption** (shared documents): A randomly generated 32-byte key is used as the NIP-44 private key. The corresponding public key is derived and used to compute the conversation key. The viewKey (hex) is embedded in the URL hash fragment (`#nkeys=...`) and **never stored** on relays or in localStorage.

### EditKey

An editKey is also a random 32-byte key. Its private key is used to `finalizeEvent` (sign) the shared document, so the event pubkey matches the editKey pubkey. This lets a recipient publish updates on behalf of the shared document's address without using the owner's signing key.

### URL format

```
/doc/<naddr>#<base64url-encoded JSON of {viewKey, editKey}>
```

The hash fragment (`#`) is never sent to the server, so keys are client-only.

---

## Signer Types

The `signerManager` singleton (`src/signer/index.ts`) abstracts over three signing backends:

| Type | Class | Storage | Notes |
|------|-------|---------|-------|
| **NIP-07** | `nip07Signer` | Extension (hardware-wallet-style) | Private key never touches app memory |
| **NIP-46** | `createNip46Signer` | Remote bunker | Bunker URI stored in `localStorage`; private key stays in bunker |
| **LocalSigner** (guest) | `createLocalSigner` | `sessionStorage` only | Private key held in memory + sessionStorage (wiped on tab close). Pubkey stored in `localStorage` for UI continuity. |

The `signerManager` exposes:
- `getSigner()` — returns the active signer, or triggers the login modal if none is set
- `registerLoginModal(cb)` — called by `UserProvider` to wire up the React modal
- `onChange(cb)` — subscribe to login/logout events
- `restoreFromStorage()` — called once after `onChange` listeners are registered (in `UserProvider` `useEffect`)
- `hasSigner()` — returns `true` if a signer is active (avoids leaking `private signer` field)

---

## Data Flow

### Startup / Login

```
App mounts
  → UserProvider useEffect registers onChange + calls restoreFromStorage()
    → restoreFromStorage checks: bunkerUri? → NIP-46; pubkey only? → NIP-07; sessionStorage secret? → LocalSigner
    → notify() fires onChange
      → UserContext fetches kind-0 profile, sets user state
        → RelayProvider fetches kind-10002, switches to user relays
          → DocumentList useEffect fetches kind-33457 documents + kind-5 deletions
          → SharedPagesProvider fetches kind-11234 shared list
```

### Write / Save

```
User edits Markdown in DocEditorSurface
  → handleSave()
    → encryptContent(md, viewKey) → NIP-44 ciphertext
    → signer.signEvent(event) → signed kind-33457
    → publishEvent(signed, relays) → broadcast to relays
    → addDocument(signed, keys) → decrypt + add to DocumentContext
```

### Share

```
handleGeneratePrivateLink(canEdit)
  → generateSecretKey() → viewKey (and optionally editKey)
  → encryptContent(md, viewKey) → saves new event signed with editKey or owner key
  → URL = /doc/<naddr>#<{viewKey, editKey}>
  → addSharedDoc([address, viewKey, editKey?]) → publishes kind-11234 event
    → fetchSharedDocuments(updatedDocs) → subscribes to shared doc's relay stream
```

### Delete

```
handleDelete()
  → guard: if isDraft return
  → deleteEvent({address, relays, reason}) → publishes kind-5 deletion request
  → removeDocument(id) → removes from DocumentContext Map
  → navigate("/") → returns user to home
```

---

## Key Source Files

| File | Role |
|------|------|
| `src/signer/index.ts` | `signerManager` singleton — auth state machine |
| `src/signer/utils.ts` | localStorage / sessionStorage helpers for auth state |
| `src/contexts/UserContext.tsx` | React auth context, login modal wiring |
| `src/contexts/RelayContext.tsx` | Relay list management |
| `src/contexts/DocumentContext.tsx` | Personal document store + decrypt |
| `src/contexts/SharedDocsContext.tsx` | Shared-with-me document store |
| `src/nostr/kinds.ts` | Event kind constants |
| `src/nostr/fetchFile.ts` | Fetch kind-33457 documents |
| `src/nostr/fetchProfile.ts` | Fetch kind-0 profile |
| `src/nostr/fetchDelete.ts` | Fetch kind-5 deletion requests |
| `src/nostr/crdt.ts` | Subscribe to kind-22457 CRDT ops |
| `src/nostr/publish.ts` | Publish events to relays |
| `src/nostr/relayPool.ts` | Shared `SimplePool` instance + default relays |
| `src/utils/encryption.ts` | `encryptContent()` wrapper |
| `src/utils/nkeys.ts` | URL hash encode/decode for view/edit keys |
| `src/components/editor/DocEditorController.tsx` | Save / delete / share orchestration |
| `src/components/DocPage.tsx` | Route-level document loader |
| `src/components/LoginModal.tsx` | Login method picker dialog |
