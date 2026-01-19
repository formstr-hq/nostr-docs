export function makeTag(length: number): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);

  return Array.from(arr, (x) => chars[x % chars.length]).join("");
}
