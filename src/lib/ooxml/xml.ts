import {
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";

export const W_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

export function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

export function serializeXml(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

export function elements(
  parent: Node,
  localName: string,
  ns: string | null = W_NS,
): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const node = parent.childNodes.item(i);
    if (!node || !isElement(node)) continue;
    if (node.localName !== localName) continue;
    if (ns !== null && node.namespaceURI !== ns) continue;
    out.push(node);
  }
  return out;
}

export function firstElement(
  parent: Node,
  localName: string,
  ns: string | null = W_NS,
): Element | null {
  return elements(parent, localName, ns)[0] ?? null;
}

export function descendants(
  parent: Node,
  localName: string,
  ns: string | null = W_NS,
): Element[] {
  const out: Element[] = [];
  const visit = (node: Node) => {
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes.item(i);
      if (!child || !isElement(child)) continue;
      if (
        child.localName === localName &&
        (ns === null || child.namespaceURI === ns)
      ) {
        out.push(child);
      }
      visit(child);
    }
  };
  visit(parent);
  return out;
}

export function wAttr(element: Element, name: string): string | null {
  return (
    element.getAttributeNS(W_NS, name) ??
    element.getAttribute(`w:${name}`) ??
    null
  );
}

export function setWAttr(element: Element, name: string, value: string): void {
  element.setAttributeNS(W_NS, `w:${name}`, value);
}

export function xmlSpaceAttr(element: Element): string | null {
  return element.getAttributeNS(XML_NS, "space");
}

export function setXmlSpace(element: Element, value: "preserve"): void {
  element.setAttributeNS(XML_NS, "xml:space", value);
}

export function outerXml(element: Element): string {
  return serializeXml(element);
}

export function innerXml(element: Element): string {
  let out = "";
  for (let i = 0; i < element.childNodes.length; i += 1) {
    const child = element.childNodes.item(i);
    if (child) out += serializeXml(child);
  }
  return out;
}

export function parseFragment(doc: Document, xml: string): Node[] {
  const wrapper = parseXml(
    `<root xmlns:w="${W_NS}" xmlns:xml="${XML_NS}">${xml}</root>`,
  );
  const root = wrapper.documentElement;
  const nodes: Node[] = [];
  if (!root) return nodes;
  for (let i = 0; i < root.childNodes.length; i += 1) {
    const node = root.childNodes.item(i);
    if (node && node.nodeType === 1) {
      const imported = doc.importNode(node, true);
      stripRedundantNamespaces(imported as Element, doc);
      nodes.push(imported);
    }
  }
  return nodes;
}

function stripRedundantNamespaces(node: Element, doc: Document): void {
  const root = doc.documentElement;
  if (!root) return;
  const redundant: string[] = [];
  for (let i = 0; i < node.attributes.length; i += 1) {
    const attr = node.attributes.item(i);
    if (!attr) continue;
    if (
      attr.name.startsWith("xmlns:") &&
      root.getAttribute(attr.name) === attr.value
    ) {
      redundant.push(attr.name);
    }
  }
  for (const name of redundant) node.removeAttribute(name);
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes.item(i);
    if (child && child.nodeType === 1) {
      stripRedundantNamespaces(child as Element, doc);
    }
  }
}
