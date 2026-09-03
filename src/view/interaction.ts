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

function nodeIdFrom(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
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
    const id = nodeIdFrom(event.target);
    host.dispatch({ kind: "select", id });
    // 让键盘事件回到画布，否则焦点留在按钮上。
    if (id !== null) host.root.focus({ preventScroll: true });
  });

  host.on("dblclick", (event: MouseEvent) => {
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
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
