import { TextFileView, type TFile, type WorkspaceLeaf } from "obsidian";
import {
  applyCollapsedPaths,
  collectCollapsedPaths,
  readCollapsed,
  writeCollapsed,
} from "./model/collapse-state";
import { parse } from "./model/parser";
import { serialize } from "./model/serializer";
import type { MindDoc } from "./model/types";
import {
  cssTransform,
  fit,
  IDENTITY,
  panBy,
  zoomAt,
  type Camera,
} from "./view/camera";
import { createControls } from "./view/controls";
import { clear, el } from "./view/dom";
import type { LayoutResult } from "./view/layout";
import { createLayers, renderMindmap, type RenderLayers } from "./view/renderer";

export const MINDMAP_VIEW_TYPE = "mindmap-view";

const SAVE_DEBOUNCE_MS = 400;

export class MindmapView extends TextFileView {
  private doc: MindDoc | null = null;
  private readonly root: HTMLElement;
  private saveTimer: number | null = null;
  private layers: RenderLayers | null = null;
  private lastLayout: LayoutResult | null = null;
  private selectedId: string | null = null;
  private camera: Camera = IDENTITY;
  private controls: { setScale(scale: number): void } | null = null;
  private panOrigin: { x: number; y: number } | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.root = el("div", "mindmap-view", this.contentEl);
  }

  override getViewType(): string {
    return MINDMAP_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "思维导图";
  }

  override getIcon(): string {
    return "git-fork";
  }

  getDoc(): MindDoc | null {
    return this.doc;
  }

  /** Obsidian 读取文件内容后调用。 */
  override setViewData(data: string, _clear: boolean): void {
    // 防御性清理：正常情况下 onUnloadFile 已经在文件切换前把上一份文档的待保存
    // 计时器 flush 掉了；这里再兜底一次，避免任何遗漏路径下的计时器在新文档加载
    // 后触发，把新文档的内容错误地当成旧文档保存。
    this.clearSaveTimer();
    const fileName = this.file?.name ?? "未命名.md";
    const parsed = parse(data, fileName);
    this.doc = {
      ...parsed,
      root: applyCollapsedPaths(parsed.root, readCollapsed(parsed.frontmatter)),
    };
    this.render();
    this.fitToView();
  }

  /** Obsidian 保存时调用，必须返回当前完整文件内容。 */
  override getViewData(): string {
    if (this.doc === null) return this.data;
    return serialize(this.withCollapsedInFrontmatter(this.doc));
  }

  override clear(): void {
    this.clearSaveTimer();
    this.doc = null;
    this.layers = null;
    this.lastLayout = null;
    this.selectedId = null;
    clear(this.root);
  }

  /**
   * Obsidian 在把这个视图实例切换到另一个文件之前调用（此时 `this.file`/`this.doc`
   * 仍指向旧文件）。这是 flush 防抖保存的正确时机：Obsidian 会复用同一个 leaf 的
   * 视图实例加载新文件，如果不在这里 flush，旧文件的计时器会在新文件加载后触发，
   * 用新文档的内容错误地保存到旧文件。
   */
  override async onUnloadFile(file: TFile): Promise<void> {
    if (this.saveTimer !== null) {
      this.clearSaveTimer();
      await this.save();
    }
    await super.onUnloadFile(file);
  }

  /** 更新内存文档、重绘、防抖写回文件。 */
  applyDoc(next: MindDoc): void {
    this.doc = next;
    this.render();
    this.scheduleSave();
  }

  /** 把当前折叠状态写进 frontmatter 的副本，不改动内存文档。 */
  private withCollapsedInFrontmatter(doc: MindDoc): MindDoc {
    return {
      ...doc,
      frontmatter: writeCollapsed(doc.frontmatter, collectCollapsedPaths(doc.root)),
    };
  }

  private scheduleSave(): void {
    this.clearSaveTimer();
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  private clearSaveTimer(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  override async onClose(): Promise<void> {
    if (this.saveTimer !== null) {
      this.clearSaveTimer();
      await this.save();
    }
    await super.onClose();
  }

  /** 当前布局结果，供 Task 10 起的交互层使用。 */
  getLayout(): LayoutResult | null {
    return this.lastLayout;
  }

  private render(): void {
    if (this.doc === null) {
      if (this.layers !== null) clear(this.root);
      this.layers = null;
      return;
    }
    if (this.layers === null) {
      clear(this.root);
      this.layers = createLayers(this.root);
      this.controls = createControls(this.root, {
        onZoomIn: () => this.zoom(1.2),
        onZoomOut: () => this.zoom(1 / 1.2),
        onFit: () => this.fitToView(),
      });
      this.attachCameraEvents();
    }
    this.lastLayout = renderMindmap(this.layers, this.doc.root, this.selectedId);
    this.applyCamera();
  }

  private applyCamera(): void {
    if (this.layers === null) return;
    this.layers.canvas.style.transform = cssTransform(this.camera);
    this.controls?.setScale(this.camera.scale);
  }

  private zoom(factor: number): void {
    const rect = this.root.getBoundingClientRect();
    this.camera = zoomAt(this.camera, factor, rect.width / 2, rect.height / 2);
    this.applyCamera();
  }

  /** 让整图适应当前视口。 */
  fitToView(): void {
    if (this.lastLayout === null) return;
    const rect = this.root.getBoundingClientRect();
    this.camera = fit(
      { width: this.lastLayout.width, height: this.lastLayout.height },
      { width: rect.width, height: rect.height },
    );
    this.applyCamera();
  }

  private attachCameraEvents(): void {
    // 滚轮：按住修饰键缩放，否则平移。
    this.registerDomEvent(this.root, "wheel", (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = this.root.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY / 300);
        this.camera = zoomAt(
          this.camera,
          factor,
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      } else {
        this.camera = panBy(this.camera, -event.deltaX, -event.deltaY);
      }
      this.applyCamera();
    });

    // 空白处按下拖拽平移。
    this.registerDomEvent(this.root, "pointerdown", (event: PointerEvent) => {
      const onNode = (event.target as HTMLElement).closest(".mm-node") !== null;
      const onControls = (event.target as HTMLElement).closest(".mm-controls") !== null;
      if (onNode || onControls || event.button !== 0) return;

      this.panOrigin = { x: event.clientX, y: event.clientY };
      this.root.setPointerCapture(event.pointerId);
      this.root.addClass("mm-panning");
    });

    this.registerDomEvent(this.root, "pointermove", (event: PointerEvent) => {
      if (this.panOrigin === null) return;
      this.camera = panBy(
        this.camera,
        event.clientX - this.panOrigin.x,
        event.clientY - this.panOrigin.y,
      );
      this.panOrigin = { x: event.clientX, y: event.clientY };
      this.applyCamera();
    });

    this.registerDomEvent(this.root, "pointerup", (event: PointerEvent) => {
      if (this.panOrigin === null) return;
      this.panOrigin = null;
      this.root.releasePointerCapture(event.pointerId);
      this.root.removeClass("mm-panning");
    });
  }
}
