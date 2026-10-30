/**
 * src/features/driveImport/converters/htmlToMarkdown.ts
 * Small HTML -> Markdown serializer for the HTML the drive converters produce.
 * Pages stores documents as Markdown, so imports are saved through this.
 */

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\s+/g, " ").replace(/([*_`[\]\\])/g, (m) => "\\" + m);
  }
  if (!(node instanceof Element)) return "";
  const inner = Array.from(node.childNodes).map(inline).join("");
  const wrap = (mark: string) => (inner.trim() ? `${mark}${inner.trim()}${mark}` : inner);
  switch (node.tagName.toLowerCase()) {
    case "strong":
    case "b":
      return wrap("**");
    case "em":
    case "i":
      return wrap("*");
    case "s":
    case "del":
      return wrap("~~");
    case "code":
      return inner ? `\`${node.textContent}\`` : "";
    case "a": {
      const href = node.getAttribute("href");
      return href && !/^\s*javascript:/i.test(href) ? `[${inner}](${href})` : inner;
    }
    case "br":
      return "  \n";
    default:
      return inner;
  }
}

function cellText(cell: Element): string {
  return Array.from(cell.children).length
    ? Array.from(cell.children).map((c) => inline(c)).join(" ").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|")
    : inline(cell).trim().replace(/\|/g, "\\|");
}

function block(node: Element, depth = 0): string {
  const tag = node.tagName.toLowerCase();
  const text = () => Array.from(node.childNodes).map(inline).join("").trim();

  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${text()}\n\n`;
  if (tag === "p") return text() ? `${text()}\n\n` : "";
  if (tag === "blockquote") return `${text().split("\n").map((l) => `> ${l}`).join("\n")}\n\n`;
  if (tag === "pre") return `\`\`\`\n${node.textContent ?? ""}\n\`\`\`\n\n`;
  if (tag === "hr") return "---\n\n";
  if (tag === "ul" || tag === "ol") {
    const items = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === "li");
    return (
      items
        .map((li, i) => {
          const marker = tag === "ol" ? `${i + 1}.` : "-";
          const body = Array.from(li.childNodes)
            .map((n) => (n instanceof Element && /^(ul|ol)$/i.test(n.tagName) ? `\n${block(n, depth + 1).trimEnd()}` : inline(n)))
            .join("")
            .trim();
          return `${"  ".repeat(depth)}${marker} ${body}`;
        })
        .join("\n") + (depth === 0 ? "\n\n" : "")
    );
  }
  if (tag === "table") {
    const rows = Array.from(node.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.children).map(cellText),
    );
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
    return `${[pad(rows[0]), pad(Array(width).fill("---")), ...rows.slice(1).map(pad)].join("\n")}\n\n`;
  }
  // div/section/body/unknown: recurse into children
  return Array.from(node.childNodes)
    .map((n) => (n instanceof Element ? block(n, depth) : n.textContent?.trim() ? `${inline(n)}\n\n` : ""))
    .join("");
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return block(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}
