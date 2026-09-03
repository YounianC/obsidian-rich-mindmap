import { TextFileView, type TFile, type WorkspaceLeaf } from "obsidian";
import {
  applyCollapsedPaths,
  collectCollapsedPaths,
  readCollapsed,
  writeCollapsed,
} from "./model/collapse-state";
import { parse } from "./model/parser";
import { serialize } from "./model/serializer";
import {
  addChild,
  addSibling,
  findNode,
  findParent,
  moveNode,
  navigate,
  removeNode,
  setMarks,
  setText,
  toggleCollapse,
} from "./model/tree-ops";
import { parseMarks } from "./model/marks";
import type { MindDoc, MindNode } from "./model/types";
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
import { attachDrag, type DropTarget } from "./view/drag";
import {
  attachInteractions,
  startInlineEdit,
  type Intent,
} from "./view/interaction";
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
  /** `attachCameraEvents()` 只应在 `this.root` 上挂载一次；`this.root` 在构造后不会被替换，
   *  但 `render()` 可能在同一实例上因 `clear()` 多次重新进入创建分支。 */
  private eventsAttached = false;
  /** 首次渲染时视口可能尚未完成布局（尺寸为 0），此时 `fitToView()` 会是无操作。
   *  置位后由 `resizeObserver` 在视口获得非零尺寸时补一次 `fitToView()`。 */
  private needsFit = false;
  private resizeObserver: ResizeObserver | null = null;
  private editingId: string | null = null;
  /** 新增节点后自动进入编辑的目标 */
  private pendingEditId: string | null = null;
  /** Tab/Enter 刚创建、还没被提交过的节点 id；用于 Esc 取消编辑时撤销这次新建，
   *  避免留下一个空文本的节点被写进文件。一旦该节点被成功提交过一次文字（无论是
   *  否为空文本），就不再是「刚创建」的候选，见 commitText 分支。 */
  private freshNodeId: string | null = null;

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

  override onload(): void {
    super.onload();
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!this.needsFit) return;
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      this.fitToView();
    });
    this.resizeObserver.observe(this.root);
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
    // 视口此时可能还没有完成布局（尺寸为 0），fitToView() 在那种情况下是无操作。
    // needsFit 置位后由 resizeObserver 在视口拿到非零尺寸时补一次。
    this.needsFit = true;
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
    // 未提交的就地编辑属于旧文档的瞬时状态：底层 DOM 节点即将被下面的 clear(this.root)
    // 销毁，若不重置这两个字段，新文档会继承一个再也不存在的 editingId，
    // isEditing() 永远为真，导致新文档的选择/键盘交互全部失效。
    this.editingId = null;
    this.pendingEditId = null;
    this.freshNodeId = null;
    // `this.root` 本身不会被重建（见 attachCameraEvents 的 eventsAttached 守卫），
    // 但控件与相机状态属于「当前文档」的展示状态，文件切换后必须重置，否则新文档
    // 会继承上一份文档的缩放/平移，且 controls 会指向已被 clear(this.root) 移除的
    // 旧 DOM 节点。
    this.controls = null;
    this.panOrigin = null;
    this.camera = IDENTITY;
    clear(this.root);
  }

  /**
   * Obsidian 在把这个视图实例切换到另一个文件之前调用（此时 `this.file`/`this.doc`
   * 仍指向旧文件）。这是 flush 防抖保存的正确时机：Obsidian 会复用同一个 leaf 的
   * 视图实例加载新文件，如果不在这里 flush，旧文件的计时器会在新文件加载后触发，
   * 用新文档的内容错误地保存到旧文件。
   */
  override async onUnloadFile(file: TFile): Promise<void> {
    if (this.editingId !== null) {
      // 编辑到一半就切换文件：不能让用户已经敲的文字被静默丢弃。blur() 会同步
      // 触发 startInlineEdit 里已经挂好的 onBlur -> finish(true) -> commitText，
      // 把编辑框里的当前文字当作一次正常提交写回内存文档；下面紧接着的 flush
      // 逻辑会把这次提交触发的防抖保存一并冲掉，复用同一条保存管线，不需要
      // 额外的状态机。
      this.root.querySelector<HTMLElement>(".mm-text.mm-editing")?.blur();
    }
    if (this.saveTimer !== null) {
      this.clearSaveTimer();
      await this.save();
    }
    await super.onUnloadFile(file);
  }

  /** 更新内存文档、重绘、防抖写回文件。 */
  applyDoc(next: MindDoc): void {
    this.doc = next;
    // 编辑期间不重绘：render() 会重建 DOM 节点，销毁正在编辑的 contenteditable。
    if (this.editingId === null) this.render();
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
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
      if (!this.eventsAttached) {
        this.attachCameraEvents();
        this.attachInteractionLayer();
        this.attachDragLayer();
        this.eventsAttached = true;
      }
    }
    this.lastLayout = renderMindmap(this.layers, this.doc.root, this.selectedId);
    this.applyCamera();
    this.refreshSelectionClasses();
    if (this.pendingEditId !== null) {
      const id = this.pendingEditId;
      this.pendingEditId = null;
      this.beginEdit(id);
    }
  }

  private applyCamera(): void {
    if (this.layers === null) return;
    this.layers.canvas.style.transform = cssTransform(this.camera);
    this.controls?.setScale(this.camera.scale);
  }

  private attachInteractionLayer(): void {
    attachInteractions({
      root: this.root,
      on: (type, handler) => this.registerDomEvent(this.root, type, handler),
      dispatch: (intent) => this.handleIntent(intent),
      selectedId: () => this.selectedId,
      isEditing: () => this.editingId !== null,
    });
  }

  private attachDragLayer(): void {
    attachDrag({
      root: this.root,
      on: (type, handler) => this.registerDomEvent(this.root, type, handler),
      isEditing: () => this.editingId !== null,
      onDrop: (sourceId, target) => this.handleDrop(sourceId, target),
    });
  }

  private handleDrop(sourceId: string, target: DropTarget): void {
    if (this.doc === null) return;
    const doc = this.doc;

    if (target.zone === "child") {
      const node = findNode(doc.root, target.targetId);
      if (node === null) return;
      this.applyDoc({
        ...doc,
        root: moveNode(doc.root, sourceId, target.targetId, node.children.length),
      });
      return;
    }

    const parent = findParent(doc.root, target.targetId);
    if (parent === null) return;
    const index = parent.children.findIndex((c) => c.id === target.targetId);
    // 同父内向下移动时，源节点先被摘除，插入下标要相应前移。
    const sourceIndex = parent.children.findIndex((c) => c.id === sourceId);
    const shift = sourceIndex >= 0 && sourceIndex < index ? -1 : 0;
    const insertAt = index + (target.zone === "after" ? 1 : 0) + shift;

    this.applyDoc({
      ...doc,
      root: moveNode(doc.root, sourceId, parent.id, insertAt),
    });
  }

  private handleIntent(intent: Intent): void {
    if (this.doc === null) return;
    const doc = this.doc;

    switch (intent.kind) {
      case "select":
        this.setSelection(intent.id);
        return;

      case "beginEdit":
        this.beginEdit(intent.id);
        return;

      case "cancelEdit": {
        const cancelledId = this.editingId;
        this.editingId = null;

        // Tab/Enter 新建的节点从未被提交过：如果取消编辑时它还是空文本、没有
        // 子节点、也没有标记，视为「用户反悔了这次新建」，直接撤销，避免留下一个
        // 空 `- ` 列表项被写进真实文件。任何真实内容（文字/子节点/标记）都不撤销，
        // 只在确认「完全空」时才移除，防止误删用户其实已经填过内容又清空的节点。
        if (cancelledId !== null && cancelledId === this.freshNodeId) {
          const node = findNode(doc.root, cancelledId);
          const isEmpty =
            node !== null &&
            node.text === "" &&
            node.children.length === 0 &&
            Object.keys(node.marks).length === 0;
          if (isEmpty) {
            this.freshNodeId = null;
            const { root, nextSelectionId } = removeNode(doc.root, cancelledId);
            this.selectedId = nextSelectionId;
            this.applyDoc({ ...doc, root });
            return;
          }
        }

        this.render();
        return;
      }

      case "commitText": {
        this.editingId = null;
        // 任何一次成功提交都意味着用户已经确认了这次编辑的结果（哪怕文字仍是空的），
        // 「Esc 撤销刚新建的空节点」这条兜底逻辑此后不应该再对任何节点生效。
        this.freshNodeId = null;

        let root: MindNode;
        if (intent.id === doc.root.id) {
          // 根节点（H1 标题行）没有标记语法：setMarks/toggleMark 在 tree-ops
          // 里对根 id 是有意的 no-op。如果这里仍然跑 parseMarks，会把用户敲进
          // 标题里的 "(p1) " 之类前缀解析成 marks 再丢弃（setMarks 对根不生效），
          // 造成文字被静默吞掉。根节点编辑当纯文本处理，不解析标记。
          root = setText(doc.root, intent.id, intent.text);
        } else {
          const { marks, rest } = parseMarks(intent.text);
          const target = findNode(doc.root, intent.id);
          const merged = { ...(target?.marks ?? {}), ...marks };
          root = setText(doc.root, intent.id, rest);
          root = setMarks(root, intent.id, merged);
        }
        this.applyDoc({ ...doc, root });
        return;
      }

      case "addChild": {
        const { root, newId } = addChild(doc.root, intent.id);
        this.selectedId = newId;
        this.pendingEditId = newId;
        this.freshNodeId = newId;
        this.applyDoc({ ...doc, root });
        return;
      }

      case "addSibling": {
        const { root, newId } = addSibling(doc.root, intent.id);
        this.selectedId = newId;
        this.pendingEditId = newId;
        this.freshNodeId = newId;
        this.applyDoc({ ...doc, root });
        return;
      }

      case "remove": {
        const { root, nextSelectionId } = removeNode(doc.root, intent.id);
        this.selectedId = nextSelectionId;
        this.applyDoc({ ...doc, root });
        return;
      }

      case "toggleCollapse":
        this.applyDoc({ ...doc, root: toggleCollapse(doc.root, intent.id) });
        return;

      case "navigate": {
        const next = navigate(doc.root, intent.id, intent.dir);
        if (next !== null) this.setSelection(next);
        return;
      }
    }
  }

  private setSelection(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.refreshSelectionClasses();
  }

  /** 只切类名，避免为选中变化做整图重排。 */
  private refreshSelectionClasses(): void {
    if (this.layers === null) return;
    for (const element of Array.from(
      this.layers.nodes.querySelectorAll<HTMLElement>(".mm-node"),
    )) {
      element.toggleClass("mm-selected", element.dataset.id === this.selectedId);
    }
  }

  private beginEdit(id: string): void {
    if (this.doc === null || this.layers === null) return;
    const node = findNode(this.doc.root, id);
    const element = this.layers.nodes.querySelector<HTMLElement>(
      `.mm-node[data-id="${id}"]`,
    );
    if (node === null || element === null) return;

    this.editingId = id;
    startInlineEdit(
      element,
      node.text,
      (text) => this.handleIntent({ kind: "commitText", id, text }),
      () => this.handleIntent({ kind: "cancelEdit" }),
    );
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
    // 视口尚未完成布局时尺寸为 0：fit() 对此返回单位相机（不产生 NaN），但那不是
    // 我们想要的「已完成适应」结果，所以在这里直接跳过、保留 needsFit，等
    // resizeObserver 在视口拿到真实尺寸后再补一次 fitToView()。
    if (rect.width <= 0 || rect.height <= 0) return;
    this.camera = fit(
      { width: this.lastLayout.width, height: this.lastLayout.height },
      { width: rect.width, height: rect.height },
    );
    this.applyCamera();
    this.needsFit = false;
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

    // 空白处按下拖拽平移。节点（.mm-node）以及任何画布上的「界面元素」（约定用
    // .mm-no-pan 标记，见 controls.ts）都不触发平移；后续任务新增的工具栏/面板/
    // 弹出框只需加上这个类，不用再逐个把类名加进这里的判断列表。
    this.registerDomEvent(this.root, "pointerdown", (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      const onNode = target.closest(".mm-node") !== null;
      const onChrome = target.closest(".mm-no-pan") !== null;
      if (onNode || onChrome || event.button !== 0) return;

      this.panOrigin = { x: event.clientX, y: event.clientY };
      this.root.setPointerCapture(event.pointerId);
      this.root.addClass("mm-panning");
    });

    this.registerDomEvent(this.root, "pointermove", (event: PointerEvent) => {
      if (this.panOrigin === null) return;
      // event.buttons === 0 表示按钮已经在别处（例如失焦、被系统接管）被释放，
      // 但我们从未收到 pointerup/pointercancel；主动结束平移，避免"粘住"。
      if (event.buttons === 0) {
        this.endPan(event.pointerId);
        return;
      }
      this.camera = panBy(
        this.camera,
        event.clientX - this.panOrigin.x,
        event.clientY - this.panOrigin.y,
      );
      this.panOrigin = { x: event.clientX, y: event.clientY };
      this.applyCamera();
    });

    this.registerDomEvent(this.root, "pointerup", (event: PointerEvent) => {
      this.endPan(event.pointerId);
    });

    // 窗口失焦、系统接管手势（如触控板被 OS 收回）等场景下，浏览器只会发出
    // pointercancel，不会有 pointerup；必须用同一套清理逻辑收尾，否则
    // panOrigin 悬空、下一次普通 hover 会被当成继续平移。
    this.registerDomEvent(this.root, "pointercancel", (event: PointerEvent) => {
      this.endPan(event.pointerId);
    });
  }

  /** 结束平移，pointerup/pointercancel/buttons===0 三条路径共用，避免互相漂移。 */
  private endPan(pointerId: number): void {
    if (this.panOrigin === null) return;
    this.panOrigin = null;
    try {
      this.root.releasePointerCapture(pointerId);
    } catch {
      // pointerId 未知或已释放（例如 pointercancel 之后浏览器已自动释放）时会抛出，
      // 这里只是收尾状态，吞掉即可。
    }
    this.root.removeClass("mm-panning");
  }
}
