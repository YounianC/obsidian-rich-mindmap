import { progressStage } from "../model/marks";
import type { FlagColor, Marks, MindNode } from "../model/types";
import { el, svgEl } from "./dom";

/** branch 序号 → CSS 类名后缀（1–7 循环）。 */
export function branchClass(branch: number): string {
  return `mm-branch-${(((branch % 7) + 7) % 7) + 1}`;
}

/** 深度 → CSS 类名后缀，3 层以下统一。 */
function depthClass(depth: number): string {
  return `mm-depth-${Math.min(depth, 3)}`;
}

const PROGRESS_FRACTIONS: readonly number[] = [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1];

/** 以 12 点为起点、顺时针的扇形路径。 */
function piePath(fraction: number, cx: number, cy: number, r: number): string {
  const angle = fraction * Math.PI * 2;
  const x = cx + r * Math.sin(angle);
  const y = cy - r * Math.cos(angle);
  const largeArc = fraction > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y} Z`;
}

function buildProgress(progress: number, parent: HTMLElement): void {
  const stage = progressStage(progress);
  const wrap = el("span", "mm-mark mm-progress", parent);
  wrap.title = `进度 ${progress}%`;

  const svg = svgEl("svg", "mm-progress-svg", wrap);
  svg.setAttribute("viewBox", "0 0 16 16");

  const ring = svgEl("circle", "mm-progress-ring", svg);
  ring.setAttribute("cx", "8");
  ring.setAttribute("cy", "8");
  ring.setAttribute("r", "7");

  if (stage === 6) {
    const check = svgEl("path", "mm-progress-check", svg);
    check.setAttribute("d", "M 4.5 8.5 L 7 11 L 11.5 5.5");
    return;
  }
  if (stage === 0) {
    const hands = svgEl("path", "mm-progress-hands", svg);
    hands.setAttribute("d", "M 8 4.5 L 8 8 L 10.5 9.5");
    return;
  }
  const wedge = svgEl("path", "mm-progress-wedge", svg);
  wedge.setAttribute("d", piePath(PROGRESS_FRACTIONS[stage], 8, 8, 7));
}

function buildFlag(flag: FlagColor, parent: HTMLElement): void {
  const wrap = el("span", `mm-mark mm-flag mm-flag-${flag}`, parent);
  wrap.title = `旗帜 ${flag}`;
  const svg = svgEl("svg", "mm-flag-svg", wrap);
  svg.setAttribute("viewBox", "0 0 16 16");
  const path = svgEl("path", "mm-flag-glyph", svg);
  path.setAttribute("d", "M 5 3 L 5 13 M 5 3.5 L 12 3.5 L 10.5 6.5 L 12 9.5 L 5 9.5");
}

function buildMarks(marks: Marks, parent: HTMLElement): void {
  if (marks.priority === undefined && marks.progress === undefined && marks.flag === undefined) {
    return;
  }
  const wrap = el("span", "mm-marks", parent);

  if (marks.priority !== undefined) {
    const badge = el("span", `mm-mark mm-priority mm-priority-${marks.priority}`, wrap);
    badge.textContent = String(marks.priority);
    badge.title = `优先级 ${marks.priority}`;
  }
  if (marks.progress !== undefined) buildProgress(marks.progress, wrap);
  if (marks.flag !== undefined) buildFlag(marks.flag, wrap);
}

/**
 * 构造一个节点的 DOM。返回的元素尚未定位，由 renderer 负责摆放。
 * `data-id` 是交互层做事件委派的唯一依据。
 */
export function buildNodeEl(
  node: MindNode,
  depth: number,
  branch: number,
  isRoot: boolean,
): HTMLElement {
  const classes = ["mm-node", depthClass(depth), branchClass(branch)];
  if (isRoot) classes.push("mm-root");
  if (node.collapsed) classes.push("mm-collapsed");

  const element = el("div", classes.join(" "));
  element.dataset.id = node.id;

  buildMarks(node.marks, element);

  const text = el("span", "mm-text", element);
  text.textContent = node.text === "" ? " " : node.text;

  if (node.collapsed && node.children.length > 0) {
    const badge = el("span", "mm-collapse-badge", element);
    badge.textContent = String(node.children.length);
    badge.title = `已折叠 ${node.children.length} 个子节点`;
  }

  return element;
}
