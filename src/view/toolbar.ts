import { setIcon } from "obsidian";
import { el } from "./dom";
import { placeNear } from "./popover";

export interface ToolbarHandlers {
  onAddChild(): void;
  onAddSibling(): void;
  onRemove(): void;
  onWrap(marker: "**" | "*" | "~~"): void;
  onMarks(anchor: DOMRect): void;
  onLink(anchor: DOMRect): void;
  onToggleCollapse(): void;
}

interface ButtonSpec {
  icon: string;
  label: string;
  action: (button: HTMLButtonElement) => void;
  /** 返回 true 表示在当前选中状态下禁用 */
  disabled?: (canCollapse: boolean, isRoot: boolean) => boolean;
  /** 标记「文字样式」按钮：它自己管理样式菜单的开关，点击时不应被下面的
   *  「点击其它按钮先关掉样式菜单」逻辑抢先关闭。 */
  isStyleToggle?: boolean;
}

const STYLE_MARKERS: readonly { marker: "**" | "*" | "~~"; label: string }[] = [
  { marker: "**", label: "加粗" },
  { marker: "*", label: "斜体" },
  { marker: "~~", label: "删除线" },
];

/** 选中节点时贴在节点上方（空间不足时翻到下方）出现的工具栏。 */
export function createToolbar(
  host: HTMLElement,
  handlers: ToolbarHandlers,
): {
  showFor(nodeEl: HTMLElement, canCollapse: boolean, isRoot: boolean): void;
  hide(): void;
} {
  // mm-no-pan：画布上「界面元素」的通用标记（见 view.ts 的 attachCameraEvents
  // 与 interaction.ts 的 pointerdown 守卫），否则在工具栏上按下并拖动会被画布
  // 当成平移手势，点击按钮也会先把当前选中清空。
  const bar = el("div", "mm-toolbar mm-no-pan", host);
  bar.hide();

  let styleMenu: HTMLElement | null = null;

  // 与 marks-panel.ts/input-popover.ts 同款：Esc 只关掉菜单本身，不能让它
  // 冒泡到画布的 keydown 监听器上把当前选中节点也清空——用户此刻的意图只是
  // 收起下拉菜单。挂在 document 捕获阶段，与另外两个浮层保持同一套机制。
  const onStyleMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeStyleMenu();
  };

  const closeStyleMenu = (): void => {
    if (styleMenu === null) return;
    styleMenu.remove();
    styleMenu = null;
    document.removeEventListener("keydown", onStyleMenuKeyDown, true);
  };

  const specs: ButtonSpec[] = [
    { icon: "corner-down-right", label: "添加子节点", action: () => handlers.onAddChild() },
    {
      icon: "plus",
      label: "添加兄弟节点",
      action: () => handlers.onAddSibling(),
      disabled: (_canCollapse, isRoot) => isRoot,
    },
    {
      icon: "trash-2",
      label: "删除节点",
      action: () => handlers.onRemove(),
      disabled: (_canCollapse, isRoot) => isRoot,
    },
    {
      icon: "type",
      label: "文字样式",
      isStyleToggle: true,
      action: (button) => {
        if (styleMenu !== null) {
          closeStyleMenu();
          return;
        }
        // mm-no-pan：同上，菜单本身也是画布上的界面元素。
        const menu = el("div", "mm-style-menu mm-no-pan", host);
        for (const { marker, label } of STYLE_MARKERS) {
          const item = el("button", "mm-style-item", menu);
          item.type = "button";
          item.textContent = label;
          item.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeStyleMenu();
            handlers.onWrap(marker);
          });
        }
        styleMenu = menu;
        placeNear(menu, button.getBoundingClientRect(), host.getBoundingClientRect());
        document.addEventListener("keydown", onStyleMenuKeyDown, true);
      },
    },
    {
      icon: "circle-check-big",
      label: "标记",
      action: (button) => handlers.onMarks(button.getBoundingClientRect()),
      // 根节点是 H1 标题行，没有承载标记的行内语法：toggleMark 对根 id 是
      // 有意的 no-op（见 model/tree-ops.ts），serialize 也会忽略根节点的 marks。
      // 若不在这里禁用，选中根节点打开面板后点任何选项都会静默失败。
      disabled: (_canCollapse, isRoot) => isRoot,
    },
    {
      icon: "link",
      label: "插入链接",
      action: (button) => handlers.onLink(button.getBoundingClientRect()),
    },
    {
      icon: "fold-vertical",
      label: "折叠子树",
      action: () => handlers.onToggleCollapse(),
      disabled: (canCollapse) => !canCollapse,
    },
  ];

  const buttons = specs.map((spec) => {
    const button = el("button", "mm-toolbar-btn", bar);
    button.type = "button";
    button.title = spec.label;
    button.setAttribute("aria-label", spec.label);
    setIcon(button, spec.icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      // 样式菜单与标记面板/插入链接浮层同一时刻只允许一个存在：标记面板与
      // 输入浮层各自已经有「点外部关闭」的逻辑（见 marks-panel.ts、
      // input-popover.ts 的 document pointerdown 捕获监听），点击工具栏上
      // 任意按钮都会先派发一次 pointerdown 到它们身上而被自动关闭；反过来，
      // 样式菜单没有这种全局监听，所以这里显式地在点击「文字样式」以外的
      // 任意按钮时把它关掉，保证两个方向都不会叠在一起。
      if (!spec.isStyleToggle) closeStyleMenu();
      spec.action(button);
    });
    return { spec, button };
  });

  return {
    showFor(nodeEl: HTMLElement, canCollapse: boolean, isRoot: boolean): void {
      closeStyleMenu();
      for (const { spec, button } of buttons) {
        button.disabled = spec.disabled?.(canCollapse, isRoot) ?? false;
      }
      bar.show();
      placeNear(bar, nodeEl.getBoundingClientRect(), host.getBoundingClientRect(), {
        prefer: "above",
      });
    },
    hide(): void {
      closeStyleMenu();
      bar.hide();
    },
  };
}
