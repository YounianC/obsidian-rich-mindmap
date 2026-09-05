import { parseInline, type InlineToken } from "../model/inline";
import { t } from "../i18n";
import { progressStage } from "../model/marks";
import { isHeading, type FlagColor, type MindNode } from "../model/types";
import { el, svgEl, textNode } from "./dom";

/** 点击一个 wikilink 时的回调，由 view.ts 提供并接到
 *  `this.app.workspace.openLinkText(...)`。node-el.ts 是视图层但刻意不 import
 *  "obsidian"、不接触 `app`——链接跳转的实际动作留给调用方注入。 */
export type OnOpenLink = (target: string, event: MouseEvent) => void;

/** 点击折叠角标展开该节点的回调，由 view.ts 提供并接到 `toggleCollapse` 意图
 *  （见 buildNodeEl 里角标的 click 处理器，以及 AGENTS.md 第 6 条事件传播
 *  约束）。与 OnOpenLink 一样，node-el.ts 本身不 import "obsidian"。 */
export type OnToggleCollapse = (id: string) => void;

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

export function buildPriorityBadge(
  priority: number,
  parent: HTMLElement,
): HTMLElement {
  const badge = el("span", `mm-mark mm-priority mm-priority-${priority}`, parent);
  badge.textContent = String(priority);
  badge.title = t("badge.priority", { priority });
  return badge;
}

export function buildProgressBadge(progress: number, parent: HTMLElement): HTMLElement {
  const stage = progressStage(progress);
  const wrap = el("span", "mm-mark mm-progress", parent);
  wrap.title = t("badge.progress", { progress });

  const svg = svgEl("svg", "mm-progress-svg", wrap);
  svg.setAttribute("viewBox", "0 0 16 16");

  const ring = svgEl("circle", "mm-progress-ring", svg);
  ring.setAttribute("cx", "8");
  ring.setAttribute("cy", "8");
  ring.setAttribute("r", "7");

  if (stage === 6) {
    const check = svgEl("path", "mm-progress-check", svg);
    check.setAttribute("d", "M 4.5 8.5 L 7 11 L 11.5 5.5");
    return wrap;
  }
  if (stage === 0) {
    const hands = svgEl("path", "mm-progress-hands", svg);
    hands.setAttribute("d", "M 8 4.5 L 8 8 L 10.5 9.5");
    return wrap;
  }
  const wedge = svgEl("path", "mm-progress-wedge", svg);
  wedge.setAttribute("d", piePath(PROGRESS_FRACTIONS[stage], 8, 8, 7));
  return wrap;
}

export function buildFlagBadge(flag: FlagColor, parent: HTMLElement): HTMLElement {
  const wrap = el("span", `mm-mark mm-flag mm-flag-${flag}`, parent);
  wrap.title = t("badge.flag", { flag });
  const svg = svgEl("svg", "mm-flag-svg", wrap);
  svg.setAttribute("viewBox", "0 0 16 16");
  const path = svgEl("path", "mm-flag-glyph", svg);
  path.setAttribute("d", "M 5 3 L 5 13 M 5 3.5 L 12 3.5 L 10.5 6.5 L 12 9.5 L 5 9.5");
  return wrap;
}

/**
 * 备注角标。
 *
 * **刻意不设 `.title`**：其余角标用原生 title 做提示，而备注有自己的悬浮气泡
 * （note-tip.ts），再挂一个原生 tooltip 会有两个浮层抢同一块位置。可访问名
 * 只走 aria-label。
 */
export function buildNoteBadge(parent: HTMLElement): HTMLElement {
  const wrap = el("span", "mm-mark mm-note-badge", parent);
  wrap.setAttribute("aria-label", t("badge.note"));

  const svg = svgEl("svg", "mm-note-svg", wrap);
  svg.setAttribute("viewBox", "0 0 16 16");

  const box = svgEl("rect", "mm-note-box", svg);
  box.setAttribute("x", "2.5");
  box.setAttribute("y", "2.5");
  box.setAttribute("width", "11");
  box.setAttribute("height", "11");
  box.setAttribute("rx", "2");

  const lines = svgEl("path", "mm-note-lines", svg);
  lines.setAttribute("d", "M 5.5 6.5 H 10.5 M 5.5 9.5 H 9");

  return wrap;
}

function buildMarks(node: MindNode, parent: HTMLElement): void {
  const { marks } = node;
  const hasNote = node.note !== undefined;
  if (
    marks.priority === undefined &&
    marks.progress === undefined &&
    marks.flag === undefined &&
    !hasNote
  ) {
    return;
  }
  const wrap = el("span", "mm-marks", parent);
  if (marks.priority !== undefined) buildPriorityBadge(marks.priority, wrap);
  if (marks.progress !== undefined) buildProgressBadge(marks.progress, wrap);
  if (marks.flag !== undefined) buildFlagBadge(marks.flag, wrap);
  if (hasNote) buildNoteBadge(wrap);
}

/**
 * 一个链接元素（wikilink 或外部链接）挡在 `.mm-node` 内部，而 `this.root` 上
 * 挂着平移/选中/拖拽三个 pointerdown 监听（见 view.ts 的
 * attachCameraEvents/attachInteractionLayer/attachDragLayer）。不拦下这个事件
 * 的话，按在链接上会被当成节点拖拽的起点、同时把选中切到这个节点——点一次链接
 * 变成"点了没反应，还把选区搞乱了"。stopPropagation 只挡住画布这三个监听器，
 * 不影响链接自身的 click。
 */
function stopPointerPropagation(event: PointerEvent): void {
  event.stopPropagation();
}

/**
 * 把 parseInline() 产出的 token 树 programmatic 地转成 DOM，绝不使用
 * `innerHTML`——节点文字来自用户的笔记文件，逐节点用 createElement/textContent
 * 拼装使注入在结构上不可能发生，而不是依赖转义。
 *
 * 备注气泡（note-tip.ts）复用这个函数渲染备注正文，同样不走 innerHTML。
 */
export function renderInline(
  tokens: InlineToken[],
  parent: HTMLElement,
  onOpenLink?: OnOpenLink,
): void {
  for (const token of tokens) {
    switch (token.kind) {
      case "text":
        textNode(token.text, parent);
        break;
      case "strong":
        renderInline(token.children, el("strong", undefined, parent), onOpenLink);
        break;
      case "em":
        renderInline(token.children, el("em", undefined, parent), onOpenLink);
        break;
      case "del":
        renderInline(token.children, el("del", undefined, parent), onOpenLink);
        break;
      case "code": {
        const code = el("code", undefined, parent);
        code.textContent = token.text;
        break;
      }
      case "wikilink": {
        // class/data-href 是 Obsidian 渲染 wikilink 时使用的约定属性（见
        // node-el.ts 顶部关于 OnOpenLink 的说明：Obsidian 自己的全局点击处理
        // 只在它自己 registerDomEvents() 过的 markdown-preview-view 容器内才
        // 生效，这里的 .mm-node 不在那棵子树下，不会被它接管、也就不会双开）。
        const a = el("a", "internal-link", parent);
        a.textContent = token.label;
        // href 只是镜像 Obsidian 渲染 wikilink 的约定（反编译确认过：
        // `{className:"internal-link",href:c,dataHref:c}`），值是笔记名而非
        // 真实可解析的 URL；点击一律 preventDefault，跳转动作交给 onOpenLink，
        // 绝不让浏览器按这个 href 做原生导航。
        a.href = token.target;
        a.dataset.href = token.target;
        a.addEventListener("pointerdown", stopPointerPropagation);
        a.addEventListener("click", (event) => {
          event.preventDefault();
          onOpenLink?.(token.target, event);
        });
        // 中键点击触发的是 auxclick 而非 click，不会被上面那个监听器拦到；
        // 不挡住的话浏览器会用 href（一个笔记名，不是真实 URL）原生新开一个
        // 标签页，白屏或报错。这里只做"不要让它发生"，不实现"新标签页打开"——
        // 那需要 Obsidian 的 openLinkText newLeaf 语义，已经在 view.ts 的
        // openLink() 里通过 Cmd/Ctrl+左键覆盖了。
        a.addEventListener("auxclick", (event) => event.preventDefault());
        break;
      }
      case "link": {
        const a = el("a", undefined, parent);
        a.textContent = token.label;
        a.href = token.href;
        a.rel = "noopener";
        a.target = "_blank";
        a.addEventListener("pointerdown", stopPointerPropagation);
        break;
      }
    }
  }
}

/**
 * 构造一个节点的 DOM。返回的元素尚未定位，由 renderer 负责摆放。
 * `data-id` 是交互层做事件委派的唯一依据。
 *
 * 节点文字通过 parseInline() + renderInline() 渲染出行内 Markdown（加粗/斜体/
 * 删除线/代码/wikilink/外部链接），never `innerHTML`。就地编辑期间这段 DOM 会
 * 被 interaction.ts 的 startInlineEdit() 整体替换成 node.text 原文，见那里的
 * 说明——不能反过来从这里渲染出的 DOM 读回 textContent 当作原文，那样会把
 * markup 静默丢失。
 */
export function buildNodeEl(
  node: MindNode,
  depth: number,
  branch: number,
  isRoot: boolean,
  onOpenLink?: OnOpenLink,
  onToggleCollapse?: OnToggleCollapse,
): HTMLElement {
  const classes = ["mm-node", depthClass(depth), branchClass(branch)];
  if (isRoot) classes.push("mm-root");
  // 标题节点不可删、不可拖、不能带标记，必须有视觉区分，否则用户不理解为什么
  // 按 Delete 没反应。根节点也带这个类：drag.ts 用它做「不可拖」的判据，一个类
  // 覆盖根与 H2–H6，取代原来单独判 mm-root 的写法。视觉差异靠 CSS 的
  // `:not(.mm-root)` 排除根节点，根有自己的 .mm-root 样式。
  if (isHeading(node)) classes.push("mm-heading");
  if (node.collapsed) classes.push("mm-collapsed");

  const element = el("div", classes.join(" "));
  element.dataset.id = node.id;

  buildMarks(node, element);

  const text = el("span", "mm-text", element);
  if (node.text === "") {
    // 空文本时保留一个空格：`.mm-node` 是 width: max-content 的绝对定位元素
    // （见 AGENTS.md 第 9 条），完全空的 .mm-text 会让节点收缩到零宽度。
    text.textContent = " ";
  } else {
    renderInline(parseInline(node.text), text, onOpenLink);
  }

  if (node.collapsed && node.children.length > 0) {
    // `▸ N` + 胶囊形（见 styles.css 的 .mm-collapse-badge 注释）替代此前的纯
    // 数字圆点——用户反馈那和优先级角标（同样是圆点+数字）分不清。
    const badge = el("span", "mm-collapse-badge", element);
    badge.textContent = `▸ ${node.children.length}`;
    badge.title = t("badge.collapsed", { count: node.children.length });
    // 事件传播（AGENTS.md 第 6 条）：不拦 pointerdown——平移守卫本就在
    // .mm-node 上短路（不影响画布），选中守卫选中这个节点是期望行为，拖拽
    // 要移动 4px 才激活，单次点击够不到那个阈值。但 click 是我们真正触发
    // 展开的地方，且必须挡住它继续冒泡到 this.root——虽然当前 this.root 上
    // 没有挂 click 监听器，这里仍然显式 stopPropagation，作为"角标上的点击
    // 到此为止、不再向上传播"的契约，避免以后有人在 root 加 click 监听时
    // 意外收到这个事件。dblclick 必须 stopPropagation：this.root 挂着
    // dblclick -> beginEdit，两次快速点击角标会先后触发一次 click（展开、
    // 角标随之被移除并重渲染）和一次 dblclick；不挡住 dblclick 的话它会
    // 冒泡到画布，画布用 closest(".mm-node") 找到同一个节点并进入就地编辑，
    // 把"点一下展开"变成"点两下意外进编辑态"。
    badge.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggleCollapse?.(node.id);
    });
    badge.addEventListener("dblclick", (event) => {
      event.stopPropagation();
    });
  }

  return element;
}
