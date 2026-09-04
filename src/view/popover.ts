/**
 * 把浮层摆在锚点附近。优先放下方，空间不足时改到上方；
 * 左右夹紧在宿主范围内，保证浮层始终完整可见。
 * 坐标相对宿主元素（宿主需 position: relative）。
 */
export function placeNear(
  panel: HTMLElement,
  anchor: DOMRect,
  hostRect: DOMRect,
  gap = 8,
): void {
  const panelRect = panel.getBoundingClientRect();

  const belowTop = anchor.bottom - hostRect.top + gap;
  const aboveTop = anchor.top - hostRect.top - panelRect.height - gap;
  const fitsBelow = belowTop + panelRect.height <= hostRect.height;
  const top = fitsBelow ? belowTop : Math.max(0, aboveTop);

  const desiredLeft = anchor.left - hostRect.left;
  const maxLeft = Math.max(0, hostRect.width - panelRect.width);
  const left = Math.min(Math.max(0, desiredLeft), maxLeft);

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}
