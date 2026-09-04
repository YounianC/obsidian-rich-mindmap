export type Intent =
  | { kind: "select"; id: string | null }
  | { kind: "beginEdit"; id: string }
  | { kind: "commitText"; id: string; text: string }
  | { kind: "cancelEdit" }
  | { kind: "addChild"; id: string }
  | { kind: "addSibling"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "toggleCollapse"; id: string }
  | { kind: "navigate"; id: string; dir: "up" | "down" | "left" | "right" };

export interface InteractionHost {
  root: HTMLElement;
  on<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void;
  dispatch(intent: Intent): void;
  selectedId(): string | null;
  isEditing(): boolean;
}

/**
 * `Element` 而不是 `HTMLElement`：节点里的进度/旗帜角标（见 node-el.ts 的
 * buildProgressBadge/buildFlagBadge）是内联 SVG，点在图形上时 event.target
 * 是 SVGElement——它不是 HTMLElement，但同样有 closest()。按 HTMLElement 收窄
 * 会让「点节点角标」被当成「点空白画布」，见下面 pointerdown 守卫处的说明。
 */
function nodeIdFrom(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".mm-node")?.dataset.id ?? null;
}

const ARROW_DIRS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** 绑定选择与键盘操作。就地编辑期间除 Esc 外不拦截按键。 */
export function attachInteractions(host: InteractionHost): void {
  host.root.tabIndex = 0;

  host.on("pointerdown", (event: PointerEvent) => {
    if (host.isEditing()) return;
    // 画布上的「界面元素」（工具栏/浮层，约定用 .mm-no-pan 标记，见 controls.ts
    // 与 marks-panel.ts）按下时不改变选择。这里必须显式判断，不能依赖
    // nodeIdFrom 返回 null 时的行为——那本是「点在空白画布上」的取消选中语义，
    // 但界面元素同样不在 .mm-node 内，若不排除，点面板里的选项或工具栏按钮都会
    // 先把当前选中节点清空，而这些交互恰恰是针对被选中节点发起的。
    // 类型必须是 Element 而不是 HTMLElement：标记面板里进度、旗帜两行的角标是
    // 内联 SVG（优先级那行是 span），点在图形上时 event.target 是 SVGElement，
    // 按 HTMLElement 收窄会让这条守卫整个失效——事件落到下面的 nodeIdFrom 得到
    // null，被当成「点在空白画布上」而清空选中，进而 syncToolbar →
    // closeStaleOverlays 在 pointerdown 阶段就把面板摘掉，按钮上的 click 永远
    // 不会派发。表现是「优先级能点，进度和旗帜点了没反应」。
    const target = event.target;
    if (target instanceof Element && target.closest(".mm-no-pan") !== null) {
      return;
    }
    const id = nodeIdFrom(event.target);
    host.dispatch({ kind: "select", id });
    // 让键盘事件回到画布，否则焦点留在按钮上。
    if (id !== null) host.root.focus({ preventScroll: true });
  });

  host.on("dblclick", (event: MouseEvent) => {
    if (host.isEditing()) return;
    const id = nodeIdFrom(event.target);
    if (id === null) return;
    event.preventDefault();
    host.dispatch({ kind: "beginEdit", id });
  });

  host.on("keydown", (event: KeyboardEvent) => {
    if (host.isEditing()) return;

    const id = host.selectedId();
    if (id === null) return;

    // 让 Obsidian 自己的快捷键继续工作。
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case "Tab":
        event.preventDefault();
        host.dispatch({ kind: "addChild", id });
        return;
      case "Enter":
        event.preventDefault();
        host.dispatch({ kind: "addSibling", id });
        return;
      case "F2":
        event.preventDefault();
        host.dispatch({ kind: "beginEdit", id });
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        host.dispatch({ kind: "remove", id });
        return;
      case " ":
        event.preventDefault();
        host.dispatch({ kind: "toggleCollapse", id });
        return;
      case "Escape":
        event.preventDefault();
        host.dispatch({ kind: "select", id: null });
        return;
      default:
        break;
    }

    const dir = ARROW_DIRS[event.key];
    if (dir !== undefined) {
      event.preventDefault();
      host.dispatch({ kind: "navigate", id, dir });
    }
  });
}

/**
 * 在节点内就地编辑文字。
 * 提交与取消都只调用一次，之后解绑，避免失焦与按键重复触发。
 */
export function startInlineEdit(
  nodeEl: HTMLElement,
  initial: string,
  onCommit: (text: string) => void,
  onCancel: () => void,
): void {
  const textEl = nodeEl.querySelector<HTMLElement>(".mm-text");
  if (textEl === null) {
    onCancel();
    return;
  }

  let settled = false;
  textEl.textContent = initial;
  textEl.contentEditable = "true";
  textEl.addClass("mm-editing");

  const finish = (commit: boolean): void => {
    if (settled) return;
    settled = true;

    const text = (textEl.textContent ?? "").replace(/\s+/g, " ").trim();
    textEl.contentEditable = "false";
    textEl.removeClass("mm-editing");
    textEl.removeEventListener("keydown", onKeyDown);
    textEl.removeEventListener("blur", onBlur);

    if (commit) {
      onCommit(text);
    } else {
      onCancel();
    }
  };

  function onKeyDown(event: KeyboardEvent): void {
    // 带修饰键：让事件原样冒泡出去，不 preventDefault/stopPropagation。这类按键
    // 组合（如 Cmd/Ctrl+Enter、Cmd/Ctrl+Escape）可能绑定了 Obsidian 自己的全局
    // 快捷键，Obsidian 的命令/快捷键管理器监听在 document/window 上；一旦在这里
    // stopPropagation，事件永远到不了那里。必须与 attachInteractions 里
    // host.root 的 keydown 处理器上那条同款守卫（`event.metaKey || event.ctrlKey
    // || event.altKey`）保持同步，不要让两处的判断条件走散。注意不要把 shiftKey
    // 并进这个守卫：Shift+Enter 需要继续走下面 `!event.shiftKey` 的分支，落到
    // contenteditable 默认的换行行为。
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // 必须在 finish() 之前调用：finish() 会同步触发 commitText，后者可能
      // 把 editingId 置空并重新渲染。若不在此处stop，同一个 Enter 事件冒泡到
      // host.root 上的 keydown 监听器时会读到 isEditing() === false，从而
      // 被当成「未编辑态」的 Enter 再次处理，多插入一个兄弟节点。
      event.stopPropagation();
      finish(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // 同上：避免 Esc 取消编辑后，同一个事件冒泡到画布触发「取消选中」。
      event.stopPropagation();
      finish(false);
    }
  }

  function onBlur(): void {
    finish(true);
  }

  textEl.addEventListener("keydown", onKeyDown);
  textEl.addEventListener("blur", onBlur);

  textEl.focus();
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
