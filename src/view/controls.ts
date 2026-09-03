import { setIcon } from "obsidian";
import { el } from "./dom";

export interface ControlsHandlers {
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
}

function iconButton(
  host: HTMLElement,
  icon: string,
  label: string,
  onClick: () => void,
): void {
  const button = el("button", "mm-control-btn", host);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  setIcon(button, icon);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
}

/** 画布右上角的缩放控件。 */
export function createControls(
  host: HTMLElement,
  handlers: ControlsHandlers,
): { setScale(scale: number): void } {
  const bar = el("div", "mm-controls", host);

  iconButton(bar, "maximize", "适应窗口", handlers.onFit);
  iconButton(bar, "minus", "缩小", handlers.onZoomOut);

  const readout = el("span", "mm-control-scale", bar);
  readout.textContent = "100%";

  iconButton(bar, "plus", "放大", handlers.onZoomIn);

  return {
    setScale(scale: number): void {
      readout.textContent = `${Math.round(scale * 100)}%`;
    },
  };
}
