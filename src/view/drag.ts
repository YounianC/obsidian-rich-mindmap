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

function nodeElAt(x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint(x, y);
  if (!(hit instanceof HTMLElement)) return null;
  return hit.closest<HTMLElement>(".mm-node");
}

interface DragState {
  sourceId: string;
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLElement | null;
  indicator: HTMLElement | null;
  target: DropTarget | null;
}

/** 绑定节点拖拽。超过阈值才开始拖，否则交给点击逻辑。 */
export function attachDrag(host: DragHost): void {
  let state: DragState | null = null;

  const teardown = (): void => {
    state?.ghost?.remove();
    state?.indicator?.remove();
    host.root.removeClass("mm-dragging");
    state = null;
  };

  host.on("pointerdown", (event: PointerEvent) => {
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

    const rootRect = host.root.getBoundingClientRect();
    if (state.ghost !== null) {
      state.ghost.style.left = `${event.clientX - rootRect.left}px`;
      state.ghost.style.top = `${event.clientY - rootRect.top}px`;
    }

    // 隐藏浮层再做命中测试，否则总是命中自己。
    const ghostDisplay = state.ghost?.style.display ?? "";
    if (state.ghost !== null) state.ghost.style.display = "none";
    if (state.indicator !== null) state.indicator.style.display = "none";
    const hit = nodeElAt(event.clientX, event.clientY);
    if (state.ghost !== null) state.ghost.style.display = ghostDisplay;
    if (state.indicator !== null) state.indicator.style.display = "";

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
}
