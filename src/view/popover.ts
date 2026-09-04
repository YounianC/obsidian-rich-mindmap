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
  const flippedTop = fitsBelow ? belowTop : Math.max(0, aboveTop);
  // 翻转判断只保证「优先下方、超界则上方」；在矮宿主里，翻到上方后仍可能
  // 因为 panelRect.height > hostRect.height 而底部越界（aboveTop 被夹到 0 之后，
  // top + 面板高度依然可能超出 hostRect.height）。在翻转决策之后再补一次下界
  // 夹紧，不会撤销翻转本身（翻转已经选好 belowTop/aboveTop 中的一个），只是让
  // 结果不再超出宿主底边；配合已有的 Math.max(0, …) 上界，面板比宿主还大时会
  // 钉在左上角而不是继续伸出边界。
  const top = Math.min(flippedTop, Math.max(0, hostRect.height - panelRect.height));

  const desiredLeft = anchor.left - hostRect.left;
  const maxLeft = Math.max(0, hostRect.width - panelRect.width);
  const left = Math.min(Math.max(0, desiredLeft), maxLeft);

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}
