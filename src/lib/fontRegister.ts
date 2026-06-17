export function normalizeId(family: string) {
  return `font-${encodeURIComponent(family)}`;
}

export function registerFontFaceFromUrl(family: string, sourceUrl: string, format: string): HTMLStyleElement {
  const id = normalizeId(family);
  if (document.getElementById(id)) {
    return document.getElementById(id) as HTMLStyleElement;
  }

  const styleEl = document.createElement("style");
  styleEl.id = id;
  styleEl.textContent = `@font-face {\n  font-family: ${JSON.stringify(family)};\n  src: url(${JSON.stringify(sourceUrl)}) format(${JSON.stringify(format)});\n  font-style: normal;\n  font-weight: normal;\n  font-display: swap;\n}`;
  document.head.appendChild(styleEl);
  return styleEl;
}

export function registerFontFaceFromBlob(family: string, blob: Blob, format: string) {
  const objectUrl = URL.createObjectURL(blob);
  const styleEl = registerFontFaceFromUrl(family, objectUrl, format);
  return { objectUrl, styleEl };
}
