import { t } from "../i18n";
import { PROGRESS_STAGE_VALUES, progressStage } from "../model/marks";
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

  const priorityRow = section(panel, t("marks.priority"));
  for (const priority of PRIORITIES) {
    optionButton(
      priorityRow,
      current.priority === priority,
      t("badge.priority", { priority }),
      () => handlers.onToggle({ priority }),
      (parent) => void buildPriorityBadge(priority, parent),
    );
  }

  const progressRow = section(panel, t("marks.progress"));
  for (const progress of PROGRESS_STAGE_VALUES) {
    // 进度是唯一按「档位」而非精确值判定高亮/取消的一档：parseMarks 允许写入
    // 0-100 之间的任意整数（例如手写或 AI 写入的 (60%)），项目要求这类原值必须
    // 原样保留、不得被这里展示用的七个代表值（PROGRESS_STAGE_VALUES）覆写。
    // 若改成精确相等比较，(60%) 会显示成「无选项高亮」，点击视觉上匹配的 67%
    // 选项时 toggleMark 的精确比较也不会命中，结果是把 60 静默改写成 67——这正是
    // 规范禁止的重写。因此这里必须用 progressStage() 归档后比较，并且在「取消」
    // 这个分支里把 handlers.onToggle 传回的是节点当前的精确值（而不是代表值），
    // 让 toggleMark 的精确比较命中并清除该标记。优先级、旗帜是没有量化的精确值
    // 域（1-7、七种颜色名），不要照搬这个模式。
    const active =
      current.progress !== undefined &&
      progressStage(current.progress) === progressStage(progress);
    optionButton(
      progressRow,
      active,
      t("badge.progress", { progress }),
      () => handlers.onToggle({ progress: active ? current.progress : progress }),
      (parent) => void buildProgressBadge(progress, parent),
    );
  }

  const flagRow = section(panel, t("marks.flag"));
  for (const flag of FLAG_COLORS) {
    optionButton(
      flagRow,
      current.flag === flag,
      t("badge.flag", { flag }),
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
