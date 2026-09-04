import { setIcon, setTooltip } from "obsidian";
import { t, type MessageKey } from "../i18n";
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

/**
 * 当前选中节点上哪些操作是可用的。
 *
 * 用一个能力对象而不是若干布尔量：三个按钮的禁用条件互不相同（「加兄弟」看
 * 是不是根，「删除」还要看有没有携带图上不可见的正文，「标记」只看是不是根），
 * 把判断留在 tree-ops 里、这里只消费结果，能避免视图层重新推导一遍规则。
 */
export interface NodeCapabilities {
  canCollapse: boolean;
  canAddSibling: boolean;
  canRemove: boolean;
  canMark: boolean;
  /** 该节点是否携带图上不可见的正文（标题下的散文、有序列表、代码块……）。
   *  它是 `canRemove` 为 false 的两个原因之一（另一个是「这是根节点」），
   *  禁用提示需要据此给出具体说明——否则同级节点一个能删一个不能，用户
   *  在图上看不出任何差别，只会觉得按钮的启用状态是任意的。 */
  hasHiddenContent: boolean;
}

interface ButtonSpec {
  icon: string;
  label: string;
  action: (button: HTMLButtonElement) => void;
  /** 返回 true 表示在当前选中状态下禁用 */
  disabled?: (caps: NodeCapabilities) => boolean;
  /** 禁用时替换 hover 提示的文案，说明「为什么不能点」。 */
  disabledLabel?: (caps: NodeCapabilities) => string;
  /** 标记「文字样式」按钮：它自己管理样式菜单的开关，点击时不应被下面的
   *  「点击其它按钮先关掉样式菜单」逻辑抢先关闭。 */
  isStyleToggle?: boolean;
}

/** 提示的展示延迟（毫秒）。原生 `title` 在 Electron 里要等 1–2 秒才浮出来，
 *  对「这个按钮为什么是灰的」这种即时疑问来说等于没有；Obsidian 自己的
 *  tooltip 可以把延迟压到几乎无感。 */
const TOOLTIP_DELAY_MS = 120;

/** 存 key 而不是文案：这是模块级常量，存文案会在模块加载时就把语言固定住，
 *  之后 setLocale 不再生效。取值在下面的样式菜单里现算。 */
const STYLE_MARKERS: readonly { marker: "**" | "*" | "~~"; labelKey: MessageKey }[] = [
  { marker: "**", labelKey: "toolbar.style.bold" },
  { marker: "*", labelKey: "toolbar.style.italic" },
  { marker: "~~", labelKey: "toolbar.style.strike" },
];

/** 选中节点时贴在节点上方（空间不足时翻到下方）出现的工具栏。 */
export function createToolbar(
  host: HTMLElement,
  handlers: ToolbarHandlers,
): {
  showFor(nodeEl: HTMLElement, caps: NodeCapabilities): void;
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

  // specs 在函数体内构造，所以这些 t() 拿到的是「创建工具栏那一刻」的语言。
  // 语言变更后由 view.ts 的 refreshLocale() 重建图层、重新走一遍 createToolbar，
  // 文案才会更新——t() 自己不通知任何人（见 i18n.ts 的 setLocale 说明）。
  const specs: ButtonSpec[] = [
    { icon: "corner-down-right", label: t("toolbar.addChild"), action: () => handlers.onAddChild() },
    {
      icon: "plus",
      label: t("toolbar.addSibling"),
      action: () => handlers.onAddSibling(),
      // 根节点没有兄弟。标题节点可以——addSibling 对它产出一个同级标题。
      disabled: (caps) => !caps.canAddSibling,
      disabledLabel: () => t("toolbar.addSibling.blockedRoot"),
    },
    {
      icon: "trash-2",
      label: t("toolbar.remove"),
      action: () => handlers.onRemove(),
      // 携带图上不可见正文（标题下的散文、代码块、表格）的节点不可删，
      // 否则会删掉用户看不见的东西。见 tree-ops.hasHiddenContent。
      disabled: (caps) => !caps.canRemove,
      disabledLabel: (caps) =>
        caps.hasHiddenContent
          ? t("toolbar.remove.blockedHidden")
          : t("toolbar.remove.blockedRoot"),
    },
    {
      icon: "type",
      label: t("toolbar.textStyle"),
      isStyleToggle: true,
      action: (button) => {
        if (styleMenu !== null) {
          closeStyleMenu();
          return;
        }
        // mm-no-pan：同上，菜单本身也是画布上的界面元素。
        const menu = el("div", "mm-style-menu mm-no-pan", host);
        for (const { marker, labelKey } of STYLE_MARKERS) {
          const item = el("button", "mm-style-item", menu);
          item.type = "button";
          item.textContent = t(labelKey);
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
      label: t("toolbar.marks"),
      action: (button) => handlers.onMarks(button.getBoundingClientRect()),
      // 根节点不能带标记：文件没有 H1 行时根本没有可写的位置，toggleMark 对根
      // id 是有意的 no-op（见 model/tree-ops.ts）。若不在这里禁用，选中根节点
      // 打开面板后点任何选项都会静默失败。文件里的 H2–H6 可以带标记。
      disabled: (caps) => !caps.canMark,
      disabledLabel: () => t("toolbar.marks.blockedRoot"),
    },
    {
      icon: "link",
      label: t("toolbar.link"),
      action: (button) => handlers.onLink(button.getBoundingClientRect()),
    },
    {
      icon: "fold-vertical",
      label: t("toolbar.collapse"),
      action: () => handlers.onToggleCollapse(),
      disabled: (caps) => !caps.canCollapse,
      disabledLabel: () => t("toolbar.collapse.blocked"),
    },
  ];

  const buttons = specs.map((spec) => {
    const button = el("button", "mm-toolbar-btn", bar);
    button.type = "button";
    setTooltip(button, spec.label, { delay: TOOLTIP_DELAY_MS });
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
    showFor(nodeEl: HTMLElement, caps: NodeCapabilities): void {
      closeStyleMenu();
      for (const { spec, button } of buttons) {
        const disabled = spec.disabled?.(caps) ?? false;
        button.disabled = disabled;
        // 禁用时把提示换成「为什么不能点」。用 Obsidian 的 setTooltip 而不是
        // 原生 title：后者在 Electron 里要等 1–2 秒才浮出来，用户根本等不到。
        // aria-label 一起改，否则读屏用户拿不到这条信息。
        const label = disabled ? (spec.disabledLabel?.(caps) ?? spec.label) : spec.label;
        setTooltip(button, label, { delay: TOOLTIP_DELAY_MS });
        button.setAttribute("aria-label", label);
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
