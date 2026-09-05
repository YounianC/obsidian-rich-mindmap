import { t } from "../i18n";
import { el } from "./dom";
import { placeNear } from "./popover";

/**
 * 多行备注的编辑浮层。Enter 换行，Cmd/Ctrl+Enter 提交，Esc 取消，点击外部提交。
 *
 * 不复用 input-popover.ts：那是单行 `<input>` 且 Enter 即提交，键盘语义与多行
 * 输入正相反，合并会让两边都变糊。
 */
export function openNotePopover(
  host: HTMLElement,
  anchor: DOMRect,
  options: {
    initial: string;
    onSubmit(value: string): void;
    /** 浮层以任何方式关闭时调用一次，供调用方清空自己持有的引用
     *  （与 openMarksPanel / openInputPopover 同款）。 */
    onClose?(): void;
  },
): { close(): void } {
  // mm-no-pan：画布上「界面元素」的通用标记，否则在浮层上按下并拖动会被画布
  // 当成平移手势处理（AGENTS.md 第 7 条）。
  const wrap = el("div", "mm-note-popover mm-no-pan", host);
  const area = el("textarea", "mm-note-input", wrap);
  area.placeholder = t("note.placeholder");
  area.value = options.initial;
  const hint = el("div", "mm-note-hint", wrap);
  hint.textContent = t("note.hint");

  placeNear(wrap, anchor, host.getBoundingClientRect());

  let closed = false;
  let submitted = false;

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    wrap.remove();
    options.onClose?.();
  }

  function submit(): void {
    if (submitted || closed) return;
    submitted = true;
    // 只去掉尾部空白：留着会让每次编辑都在文件里多写一行孤零零的 `>`。
    // 前导空白是用户可能真想要的缩进，保留。
    const value = area.value.replace(/[ \t\n]+$/, "");
    close();
    options.onSubmit(value);
  }

  function onDocPointerDown(event: PointerEvent): void {
    if (event.target instanceof Node && wrap.contains(event.target)) return;
    submit();
  }

  area.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      // 只关浮层，不让 Esc 冒泡到画布的 keydown 把当前选中也清空
      // ——用户此刻的意图只是收起浮层（与 marks-panel.ts 同款）。
      event.stopPropagation();
      close();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      submit();
      return;
    }

    // 带修饰键：放行给 Obsidian 全局热键。stopPropagation 会对所有祖先生效，
    // 包括挂着全局热键的 document（AGENTS.md 第 6 条）。
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // 其余按键在 textarea 内消费掉，绝不能冒泡到 this.root 的 keydown：
    // 那里 Enter 会新建兄弟节点、方向键会切换选中，用户打字就会同时改变导图。
    event.stopPropagation();
  });

  document.addEventListener("pointerdown", onDocPointerDown, true);
  area.focus();
  // 光标落到末尾，方便直接续写已有备注。
  area.setSelectionRange(area.value.length, area.value.length);

  return { close };
}
