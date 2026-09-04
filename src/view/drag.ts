export type DropZone = "before" | "after" | "child";

export interface DropTarget {
  targetId: string;
  zone: DropZone;
}

export interface DragHost {
  root: HTMLElement;
  on<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void;
  isEditing(): boolean;
  onDrop(sourceId: string, target: DropTarget): void;
}

const DRAG_THRESHOLD_PX = 4;
const EDGE_RATIO = 0.3;

/** 指针在目标节点内的纵向比例决定落点区域。 */
export function zoneFromOffset(offsetY: number, height: number): DropZone {
  if (height <= 0) return "child";
  const ratio = offsetY / height;
  if (ratio < EDGE_RATIO) return "before";
  if (ratio > 1 - EDGE_RATIO) return "after";
  return "child";
}

/** 隐藏浮层再做命中测试，否则总是命中自己；用 try/finally 保证一定会恢复显示。 */
function nodeElAt(
  x: number,
  y: number,
  ghost: HTMLElement | null,
  indicator: HTMLElement | null,
): HTMLElement | null {
  const ghostDisplay = ghost?.style.display ?? "";
  const indicatorDisplay = indicator?.style.display ?? "";
  try {
    if (ghost !== null) ghost.style.display = "none";
    if (indicator !== null) indicator.style.display = "none";
    const hit = document.elementFromPoint(x, y);
    if (!(hit instanceof HTMLElement)) return null;
    return hit.closest<HTMLElement>(".mm-node");
  } finally {
    if (ghost !== null) ghost.style.display = ghostDisplay;
    if (indicator !== null) indicator.style.display = indicatorDisplay;
  }
}

interface DragState {
  sourceId: string;
  startX: number;
  startY: number;
  active: boolean;
  pointerId: number | null;
  ghost: HTMLElement | null;
  indicator: HTMLElement | null;
  target: DropTarget | null;
}

/** 绑定节点拖拽。超过阈值才开始拖，否则交给点击逻辑。 */
export function attachDrag(host: DragHost): { cancel(): void } {
  let state: DragState | null = null;

  // 收尾必须走这一条路径：pointerup、pointercancel、pointermove 里的
  // buttons===0 早退分支、以及下一次 pointerdown 开头的兜底清理，全部调用它。
  // 释放指针捕获放在移除浮层之前，且用 try/catch 包住——指针 id 已经失效或
  // 被系统提前释放时会抛错，若排在移除浮层之后且不捕获异常，会导致 ghost/
  // indicator 残留在 DOM 里，和本函数要防的问题一样。
  const teardown = (): void => {
    if (state?.pointerId !== null && state?.pointerId !== undefined) {
      try {
        host.root.releasePointerCapture(state.pointerId);
      } catch {
        // 指针 id 未知或已释放（例如 pointercancel 之后浏览器已自动释放）时会
        // 抛出，这里只是收尾状态，吞掉即可。
      }
    }
    state?.ghost?.remove();
    state?.indicator?.remove();
    host.root.removeClass("mm-dragging");
    state = null;
  };

  host.on("pointerdown", (event: PointerEvent) => {
    // 若上一次手势的 pointerup/pointercancel 因为指针移出了 this.root 的
    // 子树而从未送达（拖到侧边栏、标签栏、窗口外都会发生——这些都是 Obsidian
    // 里稀松平常的布局），上一个 state 就会残留为非 null，其 ghost/indicator
    // 也还挂在 DOM 里。新手势开始前先兜底清理一次，否则每次中断的拖拽都会
    // 多留下一对浮层，越积越多。
    if (state !== null) teardown();

    if (host.isEditing() || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const nodeEl = target.closest<HTMLElement>(".mm-node");
    const id = nodeEl?.dataset.id;
    // 根节点不可拖动。
    if (nodeEl === null || id === undefined || nodeEl.hasClass("mm-root")) return;

    state = {
      sourceId: id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      pointerId: null,
      ghost: null,
      indicator: null,
      target: null,
    };
  });

  host.on("pointermove", (event: PointerEvent) => {
    if (state === null) return;

    // 按钮已经在别处（例如失焦、被系统接管）被释放，但我们从未收到
    // pointerup/pointercancel；主动收尾，避免拖拽状态"粘住"。与 Task 10
    // 平移的 endPan 同一诱因，这里复用同一条 teardown 路径。
    if (event.buttons === 0) {
      teardown();
      return;
    }

    if (!state.active) {
      const moved =
        Math.abs(event.clientX - state.startX) +
        Math.abs(event.clientY - state.startY);
      if (moved < DRAG_THRESHOLD_PX) return;

      state.active = true;
      state.pointerId = event.pointerId;
      // 只在真正越过阈值、确认这是一次拖拽而非普通点击/双击时才捕获指针；
      // 放在 pointerdown 里会对每一次点击和双击生效，干扰 Task 11 的选择与
      // 双击进入编辑。捕获后即便指针移出 this.root 的可视区域，move/up/cancel
      // 仍会持续送达这里，不再依赖事件冒泡命中 this.root 子树。
      try {
        host.root.setPointerCapture(event.pointerId);
      } catch {
        // 指针 id 无效等极端情况下会抛出；不影响后续用坐标做的命中测试逻辑，
        // 吞掉即可，teardown() 里的 release 同样有 try/catch 兜底。
      }
      host.root.addClass("mm-dragging");

      const ghost = document.createElement("div");
      ghost.className = "mm-drag-ghost mm-no-pan";
      host.root.appendChild(ghost);
      state.ghost = ghost;

      const indicator = document.createElement("div");
      indicator.className = "mm-drop-indicator mm-no-pan";
      host.root.appendChild(indicator);
      state.indicator = indicator;
    }

    // 拖拽已激活：阻止原生的文本选中/拖拽手势与自定义拖拽并行，避免松手后
    // 画布上残留一段被选中的文字高亮。不能放在 pointerdown 上，那会破坏
    // Task 11 依赖的原生 focus 行为（选择、双击进入编辑）。
    event.preventDefault();

    const rootRect = host.root.getBoundingClientRect();
    if (state.ghost !== null) {
      state.ghost.style.left = `${event.clientX - rootRect.left}px`;
      state.ghost.style.top = `${event.clientY - rootRect.top}px`;
    }

    const hit = nodeElAt(event.clientX, event.clientY, state.ghost, state.indicator);

    const hitId = hit?.dataset.id;
    if (hit === null || hitId === undefined || hitId === state.sourceId) {
      state.target = null;
      if (state.indicator !== null) state.indicator.style.display = "none";
      return;
    }

    const hitRect = hit.getBoundingClientRect();
    const zone = zoneFromOffset(event.clientY - hitRect.top, hitRect.height);
    state.target = { targetId: hitId, zone };

    if (state.indicator !== null) {
      const indicator = state.indicator;
      indicator.dataset.zone = zone;
      indicator.style.left = `${hitRect.left - rootRect.left}px`;
      indicator.style.width = `${hitRect.width}px`;
      indicator.style.top = `${
        (zone === "before" ? hitRect.top : hitRect.bottom) - rootRect.top
      }px`;
      indicator.style.height = zone === "child" ? `${hitRect.height}px` : "2px";
      if (zone === "child") {
        indicator.style.top = `${hitRect.top - rootRect.top}px`;
      }
    }
  });

  host.on("pointerup", () => {
    if (state === null) return;
    const { active, sourceId, target } = state;
    teardown();
    if (active && target !== null) host.onDrop(sourceId, target);
  });

  host.on("pointercancel", teardown);

  return {
    // 供调用方在「进行中的拖拽引用的节点 id 即将全部失效」时主动中止——
    // 例如外部改动文件后要整体重新解析：拖拽状态里的 sourceId/target.targetId
    // 都是旧文档里的 id，reparse 后同名 id 可能指向完全不同的节点（parser.ts
    // 按前序遍历顺序重新分配 n0/n1/n2…），松手时的 onDrop 会照常用旧 id 去操作
    // 新文档，可能静默移动一个不相关的节点。调用 cancel() 复用 teardown()，
    // 把 state 置回 null，之后即便还收到这次手势剩余的 pointerup/pointercancel，
    // 也会被上面两个 handler 的 `state === null` 早退挡掉，不会再触发 onDrop。
    cancel: teardown,
  };
}
