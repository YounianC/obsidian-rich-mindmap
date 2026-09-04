import { el } from "./dom";
import { placeNear } from "./popover";

/** 一个只有单行输入框的小浮层，用于「插入链接」这类需要少量输入的操作。 */
export function openInputPopover(
  host: HTMLElement,
  anchor: DOMRect,
  options: { placeholder: string; initial?: string; onSubmit(value: string): void },
): { close(): void } {
  // mm-no-pan：画布上「界面元素」的通用标记（见 view.ts 的 attachCameraEvents），
  // 否则在浮层上按下并拖动会被画布当成平移手势处理。
  const wrap = el("div", "mm-input-popover mm-no-pan", host);
  const input = el("input", "mm-input", wrap);
  input.type = "text";
  input.placeholder = options.placeholder;
  input.value = options.initial ?? "";

  placeNear(wrap, anchor, host.getBoundingClientRect());

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    wrap.remove();
  }

  function onDocPointerDown(event: PointerEvent): void {
    if (event.target instanceof Node && wrap.contains(event.target)) return;
    close();
  }

  input.addEventListener("keydown", (event) => {
    // 带修饰键：放行给 Obsidian 全局快捷键，和 interaction.ts/marks-panel.ts
    // 的同款守卫保持一致。
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const value = input.value.trim();
      close();
      // 输入框已被 close() 移除；浏览器会把焦点还给 document.body，画布的
      // keydown 监听挂在 this.root 上，届时按方向键/Tab 等画布快捷键会失效，
      // 直到用户重新点一次画布。焦点还给 host（即 this.root）以保持可用。
      host.focus({ preventScroll: true });
      if (value !== "") options.onSubmit(value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      host.focus({ preventScroll: true });
    }
  });

  // 捕获阶段监听，确保先于画布的 pointerdown 生效（与 marks-panel.ts 同款）。
  document.addEventListener("pointerdown", onDocPointerDown, true);
  input.focus();
  input.select();

  return { close };
}
