import { parseInline } from "../model/inline";
import { el } from "./dom";
import { renderInline, type OnOpenLink } from "./node-el";
import { placeNear } from "./popover";

export interface NoteTipHost {
  root: HTMLElement;
  on<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void;
  /** 按节点 id 取备注正文；没有备注返回 null */
  noteOf(id: string): string | null;
  onOpenLink?: OnOpenLink;
}

/** 悬浮多久才弹出。太短会在鼠标扫过密集导图时连环闪烁。 */
const SHOW_DELAY_MS = 200;
/** 移开多久才收起。留出把鼠标移进气泡里选文字 / 点链接的时间。 */
const HIDE_DELAY_MS = 120;

/**
 * `Element` 而不是 `HTMLElement`：角标是内联 SVG，鼠标停在图形上时
 * event.target 是 SVGElement——它有 closest()，但不是 HTMLElement。按
 * HTMLElement 收窄会让这条守卫整个失效，气泡永远不弹（AGENTS.md 第 7 条）。
 */
function badgeFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".mm-note-badge");
}

function nodeIdFrom(element: Element): string | null {
  return element.closest<HTMLElement>(".mm-node")?.dataset.id ?? null;
}

/**
 * 给备注角标接上悬浮气泡。
 *
 * 用 pointerover/pointerout 的**事件委托**而不是给每个角标挂 pointerenter：
 * 角标每次 render() 都会被重建，逐个挂监听既要管解绑、又会在重渲染时漏掉；
 * 委托到 this.root 上则天然覆盖所有当前与未来的角标。注册必须走调用方的
 * `on`（即 view.ts 的 registerDomEvent），并且只在 eventsAttached 块里调用一次
 * ——重复注册会堆叠监听器（AGENTS.md 第 6 条）。
 */
export function attachNoteTips(host: NoteTipHost): { close(): void } {
  let tip: HTMLElement | null = null;
  let ownerId: string | null = null;
  let showTimer: number | null = null;
  let hideTimer: number | null = null;

  function clearShowTimer(): void {
    if (showTimer !== null) window.clearTimeout(showTimer);
    showTimer = null;
  }

  function clearHideTimer(): void {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  function close(): void {
    clearShowTimer();
    clearHideTimer();
    tip?.remove();
    tip = null;
    ownerId = null;
  }

  function open(id: string, badge: HTMLElement, text: string): void {
    tip?.remove();
    // mm-no-pan：浮在画布之上的元素都要带这个类，否则在气泡上按下拖动会连带
    // 平移底下的画布（AGENTS.md 第 7 条）。
    const wrap = el("div", "mm-note-tip mm-no-pan", host.root);
    for (const line of text.split("\n")) {
      const row = el("div", "mm-note-line", wrap);
      if (line === "") {
        // 空行必须占一行高度，否则段落间距会塌陷成 0。
        row.textContent = " ";
        continue;
      }
      renderInline(parseInline(line), row, host.onOpenLink);
    }
    placeNear(wrap, badge.getBoundingClientRect(), host.root.getBoundingClientRect());
    tip = wrap;
    ownerId = id;
  }

  host.on("pointerover", (event: PointerEvent) => {
    // 鼠标进到气泡自己身上：取消收起，让用户能选文字、点链接。
    if (tip !== null && event.target instanceof Node && tip.contains(event.target)) {
      clearHideTimer();
      return;
    }

    const badge = badgeFrom(event.target);
    if (badge === null) return;
    const id = nodeIdFrom(badge);
    if (id === null) return;
    const text = host.noteOf(id);
    if (text === null) return;

    clearHideTimer();
    // 已经为这个节点开着了：不重开，避免鼠标在角标内部移动时气泡反复重建。
    if (tip !== null && ownerId === id) return;

    clearShowTimer();
    showTimer = window.setTimeout(() => {
      showTimer = null;
      open(id, badge, text);
    }, SHOW_DELAY_MS);
  });

  host.on("pointerout", (event: PointerEvent) => {
    const leavingBadge = badgeFrom(event.target) !== null;
    const leavingTip =
      tip !== null && event.target instanceof Node && tip.contains(event.target);
    if (!leavingBadge && !leavingTip) return;

    // 在角标内部（span → svg → path）之间移动同样派发 pointerout，
    // relatedTarget 仍在角标或气泡里时不该收起。
    const to = event.relatedTarget;
    if (to instanceof Node) {
      if (badgeFrom(to) !== null) return;
      if (tip !== null && tip.contains(to)) return;
    }

    clearShowTimer();
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      close();
    }, HIDE_DELAY_MS);
  });

  return { close };
}
