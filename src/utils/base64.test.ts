import { uint8ToBase64, base64ToUint8 } from './base64';

describe('uint8ToBase64', () => {
  it('encodes Hello bytes to SGVsbG8=', () => {
    const input = new Uint8Array([72, 101, 108, 108, 111]);
    expect(uint8ToBase64(input)).toBe('SGVsbG8=');
  });

  it('encodes an empty Uint8Array to empty string', () => {
    expect(uint8ToBase64(new Uint8Array())).toBe('');
  });
});

describe('base64ToUint8', () => {
  it('decodes SGVsbG8= to the correct bytes', () => {
    const result = base64ToUint8('SGVsbG8=');
    expect(result).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
  });

  it('decodes an empty string to an empty Uint8Array', () => {
    const result = base64ToUint8('');
    expect(result.length).toBe(0);
  });
});

describe('roundtrip', () => {
  it('survives a roundtrip', () => {
    const input = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const result = base64ToUint8(uint8ToBase64(input));
    expect(result).toEqual(input);
  });
});
