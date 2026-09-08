import { setIcon } from "obsidian";
import { t } from "../i18n";
import { el } from "./dom";

export interface ControlsHandlers {
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  onActualSize(): void;
}

function controlButton(
  host: HTMLElement,
  cls: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = el("button", cls, host);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
}

function iconButton(
  host: HTMLElement,
  icon: string,
  label: string,
  onClick: () => void,
): void {
  setIcon(controlButton(host, "mm-control-btn", label, onClick), icon);
}

/** 画布右上角的缩放控件。 */
export function createControls(
  host: HTMLElement,
  handlers: ControlsHandlers,
): { setScale(scale: number): void } {
  // mm-no-pan：画布上「界面元素」的通用标记（见 view.ts 的 attachCameraEvents）。
  // 之后新增的工具栏/面板/弹出框只需带上这个类，就不会触发画布平移。
  const bar = el("div", "mm-controls mm-no-pan", host);

  // 用箭头函数包一层再传，不把方法从 handlers 上拆下来（unbound-method）。
  iconButton(bar, "maximize", t("controls.fit"), () => handlers.onFit());
  iconButton(bar, "minus", t("controls.zoomOut"), () => handlers.onZoomOut());

  // 百分比读数**本身**就是「恢复 100%」按钮，不额外加一个图标按钮：lucide 里
  // 没有能表达「原始大小」的图标，而读数就在用户找当前倍率时的视线落点上。
  // 用真正的 <button>（而不是给 span 挂 click）才能拿到键盘可达性、焦点环，
  // 以及 .mm-control-btn 那套 hover 底色——否则「这里能点」没有任何可见线索。
  const readout = controlButton(bar, "mm-control-scale", t("controls.actualSize"), () =>
    handlers.onActualSize(),
  );
  readout.textContent = "100%";

  iconButton(bar, "plus", t("controls.zoomIn"), () => handlers.onZoomIn());

  return {
    setScale(scale: number): void {
      readout.textContent = `${Math.round(scale * 100)}%`;
    },
  };
}
