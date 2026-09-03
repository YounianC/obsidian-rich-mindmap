import type { Size } from "./layout";

/**
 * 把节点元素临时挂到隐藏容器读取尺寸。
 * 读完即从隐藏容器摘下（元素本身保留，交给调用方正式摆放）。
 */
export function measureAll(
  elements: Map<string, HTMLElement>,
  host: HTMLElement,
): Map<string, Size> {
  for (const element of elements.values()) host.appendChild(element);

  const sizes = new Map<string, Size>();
  for (const [id, element] of elements) {
    // 用 getBoundingClientRect 而非 offsetWidth，保留亚像素精度避免布局抖动。
    const rect = element.getBoundingClientRect();
    sizes.set(id, { width: rect.width, height: rect.height });
  }

  for (const element of elements.values()) host.removeChild(element);
  return sizes;
}
