# @formstr/polls

Reusable poll rendering + voting package for Formstr apps.

## What it provides

- Poll constants and tag/kind contracts aligned with Pollerama
- Poll parsing utilities (`extractNeventRef`, `decodeNevent`, `parsePollEvent`)
- Generic hooks for event fetch, vote submit, and lazy results
- Reusable UI component: `InlinePollCard`
- Adapter interface so each app plugs in its own signer/relay/publish stack

## Core integration contract

Provide an adapter implementing `NostrPollAdapter`:

- `fetchPollEvent({ id, relays })`
- `subscribePollResponses({ poll, relays, onEvent })`
- `signAndPublishVote({ unsigned, relays })`

Then render:

```tsx
<InlinePollCard nevent={nevent} userRelays={relays} adapter={adapter} />
```

This keeps package logic app-agnostic and portable across Formstr products.
