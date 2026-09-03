const SVG_NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (parent !== undefined) parent.appendChild(node);
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (className !== undefined) node.setAttribute("class", className);
  if (parent !== undefined) parent.appendChild(node);
  return node as SVGElementTagNameMap[K];
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}
