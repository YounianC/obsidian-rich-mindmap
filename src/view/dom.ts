const SVG_NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = createEl(tag);
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
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

/** 纯文本节点，配合 `el()` programmatic 地拼装行内 Markdown 的渲染结果，
 *  绝不通过 `innerHTML` 传入用户文字——见 src/view/node-el.ts 顶部注释。 */
export function textNode(content: string, parent?: Node): Text {
  const node = document.createTextNode(content);
  if (parent !== undefined) parent.appendChild(node);
  return node;
}
