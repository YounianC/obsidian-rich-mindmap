import { PROGRESS_STAGE_VALUES } from "../model/marks";
import { FLAG_COLORS, type Marks } from "../model/types";
import { el } from "./dom";
import {
  buildFlagBadge,
  buildPriorityBadge,
  buildProgressBadge,
} from "./node-el";
import { placeNear } from "./popover";

export interface MarksPanelHandlers {
  onToggle(patch: Marks): void;
  onClose(): void;
}

const PRIORITIES: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

function section(parent: HTMLElement, title: string): HTMLElement {
  const wrap = el("div", "mm-panel-section", parent);
  const label = el("div", "mm-panel-title", wrap);
  label.textContent = title;
  return el("div", "mm-panel-row", wrap);
}

function optionButton(
  row: HTMLElement,
  active: boolean,
  label: string,
  onClick: () => void,
  fill: (parent: HTMLElement) => void,
): void {
  const button = el("button", "mm-panel-option", row);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.toggleClass("mm-active", active);
  fill(button);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
}

/**
 * 打开标记面板。点选已生效项即取消该标记（由调用方的 toggleMark 语义保证）。
 * 面板外点击或按 Esc 关闭。
 */
export function openMarksPanel(
  host: HTMLElement,
  anchor: DOMRect,
  current: Marks,
  handlers: MarksPanelHandlers,
): { close(): void } {
  // mm-no-pan：画布上「界面元素」的通用标记（见 view.ts 的 attachCameraEvents），
  // 否则在面板上按下并拖动会被画布当成平移手势处理。
  const panel = el("div", "mm-panel mm-no-pan", host);

  const priorityRow = section(panel, "优先级");
  for (const priority of PRIORITIES) {
    optionButton(
      priorityRow,
      current.priority === priority,
      `优先级 ${priority}`,
      () => handlers.onToggle({ priority }),
      (parent) => void buildPriorityBadge(priority, parent),
    );
  }

  const progressRow = section(panel, "进度");
  for (const progress of PROGRESS_STAGE_VALUES) {
    optionButton(
      progressRow,
      current.progress === progress,
      `进度 ${progress}%`,
      () => handlers.onToggle({ progress }),
      (parent) => void buildProgressBadge(progress, parent),
    );
  }

  const flagRow = section(panel, "旗帜");
  for (const flag of FLAG_COLORS) {
    optionButton(
      flagRow,
      current.flag === flag,
      `旗帜 ${flag}`,
      () => handlers.onToggle({ flag }),
      (parent) => void buildFlagBadge(flag, parent),
    );
  }

  placeNear(panel, anchor, host.getBoundingClientRect());

  const onDocPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && panel.contains(event.target)) return;
    close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      // 必须 stop：本监听器挂在 document 捕获阶段，早于画布 host.root 上冒泡阶段
      // 的 keydown 监听器（interaction.ts）执行。若不在这里截断，同一次 Esc 会先
      // 关闭面板，随后又被画布当作「未编辑态」的 Esc 处理一遍，取消当前选中节点
      // ——而用户此刻的意图只是关闭面板，不是取消选择。与 startInlineEdit 里
      // Enter/Escape 的 stopPropagation 是同一类冲突、同一种修法。
      event.stopPropagation();
      close();
    }
  };

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    panel.remove();
    handlers.onClose();
  }

  // 捕获阶段监听，确保先于画布的 pointerdown 生效。这里注册的是 pointerdown，
  // 而打开面板的触发者（工具栏按钮）用的是 click；click 在 pointerup 之后才
  // 派发且早已结束，此时才注册的 pointerdown 监听不会追溯到已经跑完的事件，
  // 因此打开面板这一下不会把自己立刻关掉。
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  return { close };
}
