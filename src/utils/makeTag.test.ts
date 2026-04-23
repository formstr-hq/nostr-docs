import { makeTag } from './makeTag';

describe('makeTag', () => {
  it('returns a string of length 16 when called with 16', () => {
    expect(makeTag(16)).toHaveLength(16);
  });

  it('returns an empty string when called with 0', () => {
    expect(makeTag(0)).toBe('');
  });

  it('only contains lowercase letters and digits', () => {
    const result = makeTag(100);
    expect(result).toMatch(/^[a-z0-9]+$/);
  });

  // collision probability is negligible at this length
  it('returns different strings on two calls with the same length', () => {
    const a = makeTag(16);
    const b = makeTag(16);
    expect(a).not.toBe(b);
  });
});
