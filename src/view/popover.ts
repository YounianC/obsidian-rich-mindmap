export interface PlaceOptions {
  gap?: number;
  prefer?: "above" | "below";
}

/**
 * 把浮层摆在锚点附近。按 `prefer` 先试一侧（默认下方），空间不足时翻到另一侧；
 * 左右夹紧在宿主范围内，保证浮层始终完整可见。
 * 坐标相对宿主元素（宿主需 position: relative）。
 */
export function placeNear(
  panel: HTMLElement,
  anchor: DOMRect,
  hostRect: DOMRect,
  options: PlaceOptions = {},
): void {
  const gap = options.gap ?? 8;
  const prefer = options.prefer ?? "below";
  const panelRect = panel.getBoundingClientRect();

  const belowTop = anchor.bottom - hostRect.top + gap;
  const aboveTop = anchor.top - hostRect.top - panelRect.height - gap;
  const fitsBelow = belowTop + panelRect.height <= hostRect.height;
  const fitsAbove = aboveTop >= 0;

  let flippedTop: number;
  if (prefer === "below") {
    flippedTop = fitsBelow ? belowTop : fitsAbove ? aboveTop : Math.max(0, belowTop);
  } else {
    flippedTop = fitsAbove ? aboveTop : fitsBelow ? belowTop : Math.max(0, aboveTop);
  }
  // 翻转判断只保证「优先一侧、超界则翻到另一侧」；在矮宿主里，翻转后仍可能
  // 因为 panelRect.height > hostRect.height 而底部越界（Math.max(0, …) 把 top
  // 夹到 0 之后，top + 面板高度依然可能超出 hostRect.height）。在翻转决策之后
  // 再补一次下界夹紧，不会撤销翻转本身（翻转已经选好上面某个分支的 top），只是
  // 让结果不再超出宿主底边；配合已有的 Math.max(0, …) 上界，面板比宿主还大时会
  // 钉在左上角而不是继续伸出边界。
  const top = Math.min(flippedTop, Math.max(0, hostRect.height - panelRect.height));

  const desiredLeft = anchor.left - hostRect.left;
  const maxLeft = Math.max(0, hostRect.width - panelRect.width);
  const left = Math.min(Math.max(0, desiredLeft), maxLeft);

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}
