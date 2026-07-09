# E2E tests

A small, deliberately focused Playwright suite that exercises the core
nostr-docs flows end to end. These are **health checks**, not UI specs.

## Tests

- **doc-roundtrip** — sign in → create a document → write content → save
  (encrypt + publish) → read it back from the relay after a full reload. The
  core spine.
- **sidebar-list** — a saved document syncs back from the relay into the sidebar
  on load and reopens from there (the list read + open-from-list path).

## Running

```bash
# from the repo root
npm run test:e2e            # headless
npm run test:e2e:ui         # Playwright UI mode
npm run test:e2e doc-roundtrip   # a single file
```

Playwright boots two servers itself (via the `webServer` config; both are reused
if already running):

1. a **local in-memory nostr relay** (`tests/e2e/relay-server.cjs`) on port 7449, and
2. the Vite dev server (`npm run dev` on port 5181), started with
   `VITE_DEFAULT_RELAYS=ws://localhost:7449` so the whole app reads/writes
   against the local relay only.

Browsers are installed once with `npx playwright install chromium`.

## Principles

- Interactions are driven the way a **user** would: accessible roles, visible
  text, placeholders, labels — never CSS structure or test-only hooks.
- Tests never touch `localStorage` or signer internals, so they stay valid as
  the signer layer evolves.
- Sign-in uses the real login modal's **Temporary Account** (anonymous) option —
  no key seeding.

## Notes

- No live relays — fast and deterministic, retries disabled so real flakiness
  surfaces. The relay is in-memory and wiped on restart.
- `DEFAULT_RELAYS` (`src/nostr/relayPool.ts`) honors the `VITE_DEFAULT_RELAYS`
  env var; it's unset in production. `doc-roundtrip` decodes the saved document's
  `naddr` and asserts the event is present on the **local** relay, so a broken
  override fails loudly instead of silently using live relays.
- The guest secret persists in `localStorage`, so a signed-in session (and the
  ability to decrypt its own documents) survives the reload the round-trip relies
  on.
