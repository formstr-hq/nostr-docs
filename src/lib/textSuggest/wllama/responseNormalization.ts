export function normalizeContinuation(text: string, prefix: string): string {
  let output = text
    .replace(/\r/g, "")
    .replace(/^[\s]*["'`]+/, "")
    .replace(/["'`]+[\s]*$/, "")
    .replace(
      /^\s*(?:Sure[.,]?|Okay[.,]?|Alright[.,]?|Here(?:'s| is)?(?: the)?(?: continuation| next words| text)?(?::|-)?\s*)/i,
      "",
    )
    .replace(
      /^\s*(?:Certainly[.,]?|Of course[.,]?|I'd be happy to[^.\n]*[.!]?\s*)/i,
      "",
    )
    .replace(/^\s*(?:Continuation|Next words)\s*(?::|-)\s*/i, "");

  const echo = prefix.slice(-40).trim();
  if (echo && output.toLowerCase().startsWith(echo.toLowerCase())) {
    output = output.slice(echo.length);
  }

  const blankLine = output.search(/\n\s*\n/);
  if (blankLine !== -1) output = output.slice(0, blankLine);
  output = output.replace(/\n+/g, " ").replace(/\s+$/, "");

  const trimmedPrefix = prefix.replace(/\s+$/, "");
  const midSentence =
    trimmedPrefix.length > 0 && !/[.!?…]"?$/.test(trimmedPrefix);
  if (midSentence) output = output.replace(/[.!?]+["']?\s*$/, "");

  if (
    output &&
    prefix.length > 0 &&
    !/\s$/.test(prefix) &&
    !/^\s/.test(output)
  ) {
    output = ` ${output}`;
  }
  return output;
}

export function normalizeProofreadDocument(text: string): string {
  // The model is instructed to return the document only. Heuristically
  // stripping fences or preambles can delete legitimate document content.
  return text.replace(/\r\n?/g, "\n");
}
