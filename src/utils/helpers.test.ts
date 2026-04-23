import { type Event } from 'nostr-tools';
import { getEventAddress, getLatestVersion } from './helpers';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'abc',
    pubkey: 'pubkey123',
    created_at: 0,
    kind: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}

describe('getEventAddress', () => {
  it('returns kind:pubkey:dtag when event has a d tag', () => {
    const event = makeEvent({ tags: [['d', 'mytag']] });
    expect(getEventAddress(event)).toBe('1:pubkey123:mytag');
  });

  it('returns null when event has no d tag', () => {
    const event = makeEvent({ tags: [['p', 'someone']] });
    expect(getEventAddress(event)).toBeNull();
  });

  it('uses the first d tag when multiple d tags exist', () => {
    const event = makeEvent({ kind: 5, tags: [['d', 'first'], ['d', 'second']] });
    expect(getEventAddress(event)).toBe('5:pubkey123:first');
  });
});

describe('getLatestVersion', () => {
  it('returns the last element for a non-empty versions array', () => {
    const v1 = { event: makeEvent(), decryptedContent: 'v1' };
    const v2 = { event: makeEvent(), decryptedContent: 'v2' };
    expect(getLatestVersion({ versions: [v1, v2] })).toBe(v2);
  });

  it('returns null for an empty versions array', () => {
    expect(getLatestVersion({ versions: [] })).toBeNull();
  });

  it('returns the element for a single element array', () => {
    const v1 = { event: makeEvent(), decryptedContent: 'only' };
    expect(getLatestVersion({ versions: [v1] })).toBe(v1);
  });
});
