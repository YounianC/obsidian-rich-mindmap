import { Notice, TextFileView, TFile, type WorkspaceLeaf } from "obsidian";
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
  canAddSibling,
  canMark,
  canNote,
  canRemove,
  findNode,
  findParent,
  hasHiddenContent,
  moveNode,
  navigate,
  removeNode,
  setMarks,
  setNote,
  setText,
  toggleCollapse,
  toggleMark,
} from "./model/tree-ops";
import { parseMarks } from "./model/marks";
import { t } from "./i18n";
import type { Marks, MindDoc, MindNode } from "./model/types";
// `import type`：编译后被整体擦除，不会产生 view.ts → settings.ts → main.ts
// 的运行时循环依赖（settings.ts 自己 import 了 obsidian 与 main 的类型）。
import type { MindmapSettings } from "./settings";
import {
  actualSize,
  cssTransform,
  fit,
  IDENTITY,
  panBy,
  zoomAt,
  zoomTo,
  type Camera,
} from "./view/camera";
import { createControls } from "./view/controls";
import { clear, el } from "./view/dom";
import { attachDrag, type DropTarget } from "./view/drag";
import { openInputPopover } from "./view/input-popover";
import {
  attachInteractions,
  startInlineEdit,
  type Intent,
} from "./view/interaction";
import type { LayoutResult, Size } from "./view/layout";
import { openMarksPanel } from "./view/marks-panel";
import { openNotePopover } from "./view/note-popover";
import { attachNoteTips } from "./view/note-tip";
import { createLayers, renderMindmap, type RenderLayers } from "./view/renderer";
import { createToolbar } from "./view/toolbar";

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
  /** 首次渲染时视口可能尚未完成布局（尺寸为 0），此时 `applyInitialCamera()` 会是
   *  无操作。置位后由 `resizeObserver` 在视口获得非零尺寸时补一次。
   *  名字不叫 `needsFit`：初始相机到底是「适应窗口」还是 100%，取决于设置项
   *  `defaultZoom`，见 `applyInitialCamera()`。 */
  private needsInitialCamera = false;
  private resizeObserver: ResizeObserver | null = null;
  private editingId: string | null = null;
  /** 新增节点后自动进入编辑的目标 */
  private pendingEditId: string | null = null;
  /** Tab/Enter 刚创建、还没被提交过的节点 id；用于 Esc 取消编辑时撤销这次新建，
   *  避免留下一个空文本的节点被写进文件。一旦该节点被成功提交过一次文字（无论是
   *  否为空文本），就不再是「刚创建」的候选，见 commitText 分支。 */
  private freshNodeId: string | null = null;
  private toolbar: ReturnType<typeof createToolbar> | null = null;
  private marksPanel: { close(): void } | null = null;
  /** 插入链接的输入浮层；文件切换/重建图层时必须显式 close()，否则它注册在
   *  document 上的 pointerdown 捕获监听会在浮层 DOM 被 clear(this.root) 销毁后
   *  继续存在，成为跨文件的监听器泄漏（见 clear()）。 */
  private inputPopover: { close(): void } | null = null;
  /** 备注编辑浮层。与 marksPanel/inputPopover 同款：它在 document 上挂着
   *  pointerdown 捕获监听，DOM 被 clear(this.root) 销毁不会解绑，必须显式 close()。 */
  private notePopover: { close(): void } | null = null;
  /** marksPanel/inputPopover/notePopover 当前绑定的节点 id，见 closeStaleOverlays()。 */
  private overlayOwnerId: string | null = null;
  /** attachDrag() 返回的取消句柄，供 setViewData() 中止一次跨文档失效的拖拽。 */
  private dragControl: { cancel(): void } | null = null;
  /** 备注悬浮气泡的句柄。与 dragControl 一样只挂一次监听（在 eventsAttached
   *  块里），因此在重置状态时只 close() 不置 null——置 null 会让下一次 render()
   *  以为还没挂过，但监听器实际上还在，形成堆叠（AGENTS.md 第 6 条）。 */
  private noteTips: { close(): void } | null = null;
  /** parse() 抛异常时的错误信息；非 null 时 render() 走错误态分支，doc 为 null。 */
  private parseError: string | null = null;

  /** `settings` 是 getter 而不是快照：用户在设置页改完立刻生效（见 main.ts 的
   *  `registerView`），视图不需要被重建。 */
  constructor(
    leaf: WorkspaceLeaf,
    private readonly settings: () => MindmapSettings,
  ) {
    super(leaf);
    this.root = el("div", "mindmap-view", this.contentEl);
    // 视图标题栏右上角的动作按钮（与 Obsidian 自带视图的图标按钮同一位置）。
    // 命令面板里的「切换思维导图 / 源码视图」仍然可用，这是它的鼠标入口。
    this.addAction("file-text", t("view.switchToSource"), () => this.switchToSource());
  }

  /**
   * 把当前 leaf 切回 Markdown 源码视图。未保存的编辑由基类在卸载文件时通过
   * getViewData() 落盘（TextFileView.onUnloadFile → save），这里不需要额外 flush。
   * 切换不会触发 file-open（文件没变），因此也不会被 main.ts 的自动打开逻辑切回来。
   */
  private switchToSource(): void {
    const path = this.file?.path;
    if (path === undefined) return;
    void this.leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source" },
      active: true,
    });
  }

  /**
   * 语言变更后重建图层，让工具栏、缩放控件、标记面板、错误卡片换上新语言。
   *
   * 置 `layers = null` 再 `render()` 是**唯一允许的重建入口**，与 `setViewData`
   * 完全同一条路径：`render()` 的重建分支靠 `eventsAttached` 守卫防止在
   * `this.root` 上堆叠监听器（AGENTS.md 第 6 条——堆叠会让一个滚轮档位变成
   * `factor^N` 倍缩放）。不要另写一套重建逻辑。
   *
   * 视口与选中保留：`render()` 不动 `camera` 与 `selectedId`。
   */
  refreshLocale(): void {
    this.layers = null;
    this.render();
  }

  override getViewType(): string {
    return MINDMAP_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? t("view.displayTitle");
  }

  override getIcon(): string {
    return "git-fork";
  }

  override onload(): void {
    super.onload();
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!this.needsInitialCamera) return;
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      this.applyInitialCamera();
    });
    this.resizeObserver.observe(this.root);

    // 注意：这里**不**注册自己的 vault.on("modify")。TextFileView.onload() 已经
    // 注册了一个（`onModify(f) { this.saving || f === this.file && this.loadFileInternal(f, false) }`，
    // 见反编译的 obsidian.asar），它会读盘、用自己的 lastSavedData 过滤掉本视图
    // 保存产生的回声，然后调用 setViewData(content, false)。再注册一个只会和它
    // 竞争：基类那个先注册、先读盘、先 resolve，本插件的收尾逻辑就永远跑在
    // 「文档已经被基类换掉之后」，等于没做。AI 协同要的自动刷新完全由基类这条
    // 路径提供，我们只需要把收尾逻辑放进 setViewData 本身，见那里的注释。
  }

  /**
   * Obsidian 读取文件内容后调用，是本视图唯一的「文档被整体替换」入口。
   *
   * `clear` 参数的含义（来自反编译的 obsidian.asar）：
   * - `true`：换文件。`FileView.onLoadFile` → `loadFileInternal(file, true)`，
   *   每次加载新文件必定为 true。
   * - `false`：同一个文件被外部改动后的就地刷新。`TextFileView.onModify` →
   *   `loadFileInternal(file, false)`。
   *
   * 为什么 per-file 重置写在这里而不是 `clear()`：基类的 `clear()` 只可能被
   * `save(true)` 调用，而 `save(true)` 开头就有
   * `if (this.lastSavedData === getViewData()) return;` 的早退。文件切换时
   * `onUnloadFile` 已经 flush 过一次保存，`lastSavedData` 正好等于此刻的
   * `getViewData()`，于是这个早退是常态——`clear()` 在常见路径上根本不会执行。
   * 只有 `setViewData` 的 `clear` 参数是每次换文件都必定为 true 的信号。
   */
  override setViewData(data: string, clear: boolean): void {
    // 1) 进行中的就地编辑必须在 this.doc 被替换之前收尾，否则用户刚敲进
    //    contenteditable 里、还没提交的文字会随旧文档一起消失。blur() 同步走
    //    startInlineEdit 的 onBlur -> finish(true) -> commitText，用一条已知、
    //    确定性的路径结束编辑态，而不是指望「聚焦元素被移出文档时浏览器是否补发
    //    blur」这种因浏览器而异的行为。两个状态都要在 blur 之前抓快照：blur 会
    //    把 editingId 置空，并通过 applyDoc 重新武装一次防抖保存。
    const hadUnsavedEdit = this.editingId !== null;
    const hadPendingSave = this.saveTimer !== null;
    if (hadUnsavedEdit) {
      this.root.querySelector<HTMLElement>(".mm-text.mm-editing")?.blur();
    }

    // 2) 旧文档的瞬时状态收尾。换文件时做完整的 per-file 重置；外部改动同一个
    //    文件时保留相机与选中（README/设计文档承诺「视口与选中保持不动」），
    //    只清掉那些引用着旧文档节点 id 的东西。
    if (clear) {
      this.resetPerFileState();
    } else {
      // 防抖计时器里排着的是「外部修改之前」的内存文档，让它跑完会把刚被外部
      // 写入的内容覆盖掉。以磁盘为准，直接丢弃。
      this.clearSaveTimer();
      this.resetDocBoundState();
      if (hadUnsavedEdit || hadPendingSave) {
        new Notice(t("notice.externalChange"));
      }
    }

    const fileName = this.file?.name ?? t("view.untitledFile");
    try {
      const parsed = parse(data, fileName);
      this.doc = {
        ...parsed,
        root: applyCollapsedPaths(parsed.root, readCollapsed(parsed.frontmatter)),
      };
      this.parseError = null;
    } catch (error) {
      // 解析失败是最后一道防线：doc 保持 null，getViewData() 因此返回原始
      // this.data 不变——文件绝不会被这次失败的解析结果覆盖。
      this.doc = null;
      this.parseError = String(error);
      // 错误态没有任何布局可言。留着上一份 lastLayout 会让排队中的初始相机
      // 按一张已经不在屏幕上的图去算，所以一并清掉。
      this.lastLayout = null;
      this.needsInitialCamera = false;
    }
    // 强制走 render() 里「layers === null」的重建分支：不仅重建图层/控件/
    // 工具栏，还会 clear(this.root) 一次，顺带清掉任何不属于当前渲染路径、
    // 直接挂在 this.root 下的浮层残留（例如一次被外部变更打断的拖拽留下的
    // ghost/drop-indicator 元素）。普通首次加载时 this.layers 本来就是 null，
    // 这里是无操作。
    this.layers = null;
    this.render();
    if (this.parseError !== null) return;
    if (clear) {
      // 视口此时可能还没有完成布局（尺寸为 0），applyInitialCamera() 在那种情况下
      // 是无操作。needsInitialCamera 置位后由 resizeObserver 在视口拿到非零尺寸
      // 时补一次。
      this.needsInitialCamera = true;
      this.applyInitialCamera();
    } else {
      // 外部改文件不应该在任何时间点让视口跳动：相机没有被上面的重置动过，
      // render() 里已经 applyCamera() 过一次，这里只需要显式把 needsInitialCamera
      // 关掉——否则若此刻这个 leaf 是尺寸为 0 的后台标签页，之后任意一次尺寸
      // 变化都会让 resizeObserver 补一次初始相机，把保留下来的相机冲掉。
      this.needsInitialCamera = false;
    }
  }

  /** Obsidian 保存时调用，必须返回当前完整文件内容。 */
  override getViewData(): string {
    // 解析错误态：没有可序列化的文档，原样交回未被触碰的原始内容。基类的
    // save() 会看到 getViewData() === lastSavedData 而直接早退，文件不会被写。
    if (this.doc === null) return this.data;
    return serialize(this.withCollapsedInFrontmatter(this.doc));
  }

  /**
   * 「一次文档整体替换」必须收尾的瞬时状态：它们全都以旧文档的节点 id 为键，
   * 重新解析后同名 id 很可能指向完全不同的节点（parser.ts 按前序遍历顺序重新
   * 分配 n0/n1/n2…，插入或删除一个节点就会让后面的 id 整体错位）。
   *
   * 不能指望紧随其后的 clear(this.root) 顺带处理：标记面板、链接浮层、工具栏
   * 的样式菜单各自在 **document** 上挂着 pointerdown/keydown 捕获监听
   * （见 marks-panel.ts、input-popover.ts、toolbar.ts），销毁 DOM 节点不会解绑
   * 它们；拖拽状态更是完全活在 drag.ts 的闭包里，DOM 被清掉之后 state 依然是
   * active，用户松手时照样触发 onDrop，用旧 id 去移动新文档里的某个节点，
   * 并在 400ms 内静默写进磁盘。
   */
  private resetDocBoundState(): void {
    // 未提交的就地编辑：底层 DOM 节点马上要被销毁，若不重置这几个字段，新文档
    // 会继承一个再也不存在的 editingId，isEditing() 永远为真，键盘/选择/拖拽和
    // applyDoc 的重绘会全部失效，直到再切一次文件为止。
    this.editingId = null;
    this.pendingEditId = null;
    this.freshNodeId = null;
    // 工具栏是三者里唯一挂了 document 监听、又没有独立 close() 的一个，
    // 必须在丢弃引用之前 hide() 把样式菜单的监听摘掉。
    this.toolbar?.hide();
    this.marksPanel?.close();
    this.marksPanel = null;
    this.inputPopover?.close();
    this.inputPopover = null;
    this.notePopover?.close();
    this.notePopover = null;
    this.overlayOwnerId = null;
    this.noteTips?.close();
    this.dragControl?.cancel();
  }

  /**
   * 换文件（或关闭视图）时的完整重置：在 resetDocBoundState() 之上，再把所有
   * 「属于当前文件」的展示状态归零。`this.root` 本身不会被重建
   * （见 attachCameraEvents 的 eventsAttached 守卫），但它的子树会被清空，
   * 因此指向子树的引用（layers/controls/toolbar）必须一并置空。
   */
  private resetPerFileState(): void {
    this.clearSaveTimer();
    this.resetDocBoundState();
    this.doc = null;
    this.parseError = null;
    this.layers = null;
    this.lastLayout = null;
    this.selectedId = null;
    this.controls = null;
    this.toolbar = null;
    this.panOrigin = null;
    this.camera = IDENTITY;
    this.needsInitialCamera = false;
    clear(this.root);
  }

  /**
   * 基类只在 `save(true)` 里调用 clear()，而 `save(true)` 在
   * `lastSavedData === getViewData()` 时就早退了——文件切换前 onUnloadFile 已经
   * flush 过保存，所以这条路径在常见场景下压根不会执行。真正每次换文件都会跑的
   * 是 `setViewData(data, true)`，per-file 重置以那里为准，这里只是把同一份逻辑
   * 接到基类约定的钩子上，重复调用是幂等的。
   */
  override clear(): void {
    this.resetPerFileState();
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
    // 有意不调用基类的 requestSave()：那会置位基类的 dirty 标记，进而在外部
    // 修改到来时触发它的按行三路合并——对序列化后的导图 Markdown 做文本合并
    // 只会比「磁盘覆盖本地待存改动」更糟。这里全靠自己的防抖 + save() 落盘。
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
    // 关闭 leaf 与切换文件一样，必须显式收尾浮层与拖拽：标记面板/链接浮层的
    // pointerdown 捕获监听挂在 document 上，视图 DOM 被销毁不会解绑，不清理就会
    // 在整个 Obsidian 会话余下的时间里一直挂着。
    this.resetPerFileState();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    await super.onClose();
  }

  private render(): void {
    // 气泡锚定在一个马上要被重建的角标上，锚点消失后 pointerout 不会再派发，
    // 不主动关就会留一个孤儿浮层挂在画布上。气泡是悬浮触发的、不绑定选中，
    // 所以不走 closeStaleOverlays（那条路径判的是 overlayOwnerId === selectedId）。
    this.noteTips?.close();
    if (this.parseError !== null) {
      clear(this.root);
      this.toolbar = null;
      this.controls = null;
      this.renderError(this.parseError);
      return;
    }
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
        onActualSize: () => this.resetZoom(),
      });
      // 工具栏 DOM 挂在 this.root 下，会被上面的 clear(this.root) 一并清空，
      // 因此和 controls 一样，每次重新进入这个「创建图层」分支都要重建；
      // 不受 eventsAttached 影响——那个守卫只管「事件监听只挂一次」，不管
      // DOM 本身的生命周期。
      this.toolbar = this.createToolbarForView();
      if (!this.eventsAttached) {
        this.attachCameraEvents();
        this.attachInteractionLayer();
        this.attachDragLayer();
        this.attachNoteTipLayer();
        this.eventsAttached = true;
      }
    }
    this.lastLayout = renderMindmap(
      this.layers,
      this.doc.root,
      this.selectedId,
      (target, event) => this.openLink(target, event),
      (id) => this.handleIntent({ kind: "toggleCollapse", id }),
    );
    this.applyCamera();
    this.refreshSelectionClasses();
    this.syncToolbar();
    if (this.pendingEditId !== null) {
      const id = this.pendingEditId;
      this.pendingEditId = null;
      this.beginEdit(id);
    }
  }

  /** parse() 抛异常时的错误提示卡片，附「切换到源码模式」出口。 */
  private renderError(message: string): void {
    // mm-no-pan：画布上「界面元素」的通用标记（见 attachCameraEvents 与
    // interaction.ts 的 pointerdown 守卫）。这张卡片最常见的出现场景是"一个
    // 之前解析成功过的文件被外部改坏了"——也就是说 attachCameraEvents 与
    // attachInteractionLayer 这两组画布级监听器（平移手势、点击取消选中）
    // 早已挂好。不加这个类的话，在卡片里点击、选文字或拖拽都会被当成在空白
    // 画布上操作：触发平移（.mm-panning、光标变成 grabbing）和取消选中。
    const wrap = el("div", "mm-error mm-no-pan", this.root);
    const title = el("div", "mm-error-title", wrap);
    title.textContent = t("view.error.title");
    const detail = el("div", "mm-error-detail", wrap);
    detail.textContent = message;
    const hint = el("div", "mm-error-detail", wrap);
    hint.textContent = t("view.error.hint");

    const button = el("button", "mm-error-btn", wrap);
    button.type = "button";
    button.textContent = t("view.switchToSource");
    button.addEventListener("click", () => this.switchToSource());
  }

  private createToolbarForView(): ReturnType<typeof createToolbar> {
    return createToolbar(this.root, {
      onAddChild: () => this.withSelection((id) => this.handleIntent({ kind: "addChild", id })),
      onAddSibling: () => this.withSelection((id) => this.handleIntent({ kind: "addSibling", id })),
      onRemove: () => this.withSelection((id) => this.handleIntent({ kind: "remove", id })),
      onToggleCollapse: () =>
        this.withSelection((id) => this.handleIntent({ kind: "toggleCollapse", id })),
      onWrap: (marker) => this.withSelection((id) => this.wrapText(id, marker)),
      onMarks: (anchor) => this.withSelection((id) => this.openMarks(id, anchor)),
      onLink: (anchor) => this.withSelection((id) => this.insertLink(id, anchor)),
      onNote: (anchor) => this.withSelection((id) => this.openNote(id, anchor)),
    });
  }

  private withSelection(fn: (id: string) => void): void {
    if (this.selectedId !== null) fn(this.selectedId);
  }

  /** 对整个节点文本做包裹标记的开关：已被该标记包裹则去掉，否则加上。
   *  不做选区级富文本，保持原始 Markdown 简单可读。 */
  private wrapText(id: string, marker: "**" | "*" | "~~"): void {
    if (this.doc === null) return;
    const node = findNode(this.doc.root, id);
    if (node === null) return;

    const wrapped =
      node.text.startsWith(marker) &&
      node.text.endsWith(marker) &&
      // 边界情况：空节点被包一次后文本恰好是 marker+marker（长度等于
      // marker.length*2），例如 "" -> "****"。这种情况必须算作「已包裹」，
      // 否则会被误判成「未包裹」再包一层，永远无法转回空字符串——
      // 用 >= 而不是 >，别再收紧回 >。
      node.text.length >= marker.length * 2;

    const text = wrapped
      ? node.text.slice(marker.length, node.text.length - marker.length)
      : `${marker}${node.text}${marker}`;

    this.applyDoc({ ...this.doc, root: setText(this.doc.root, id, text) });
  }

  private openMarks(id: string, anchor: DOMRect): void {
    if (this.doc === null) return;
    const node = findNode(this.doc.root, id);
    if (node === null) return;

    this.marksPanel?.close();
    this.overlayOwnerId = id;
    this.marksPanel = openMarksPanel(this.root, anchor, node.marks, {
      onToggle: (patch: Marks) => {
        if (this.doc === null) return;
        this.applyDoc({ ...this.doc, root: toggleMark(this.doc.root, id, patch) });
      },
      onClose: () => {
        this.marksPanel = null;
      },
    });
  }

  private insertLink(id: string, anchor: DOMRect): void {
    this.inputPopover?.close();
    this.overlayOwnerId = id;
    this.inputPopover = openInputPopover(this.root, anchor, {
      placeholder: t("view.link.placeholder"),
      onSubmit: (value) => {
        if (this.doc === null) return;
        const node = findNode(this.doc.root, id);
        if (node === null) return;
        const text = node.text === "" ? `[[${value}]]` : `${node.text} [[${value}]]`;
        this.applyDoc({ ...this.doc, root: setText(this.doc.root, id, text) });
      },
      onClose: () => {
        this.inputPopover = null;
      },
    });
  }

  private openNote(id: string, anchor: DOMRect): void {
    if (this.doc === null) return;
    const node = findNode(this.doc.root, id);
    if (node === null) return;

    this.notePopover?.close();
    this.overlayOwnerId = id;
    this.notePopover = openNotePopover(this.root, anchor, {
      initial: node.note?.text ?? "",
      onSubmit: (value) => {
        if (this.doc === null) return;
        this.applyDoc({ ...this.doc, root: setNote(this.doc.root, id, value) });
      },
      onClose: () => {
        this.notePopover = null;
      },
    });
  }

  /** 节点里渲染出的 wikilink 被点击时调用。node-el.ts 刻意不 import "obsidian"，
   *  不接触 `app`，跳转动作由这里注入。openLinkText 的第二个参数是「当前文件的
   *  路径」，用于解析相对链接与未指定 vault 时的兜底解析；`this.file` 在文档
   *  解析失败态也可能是 null（见 setViewData 的 parseError 分支），此时不会有
   *  任何链接被渲染出来，但保底仍传空字符串而不是抛错。 */
  private openLink(target: string, event: MouseEvent): void {
    // Cmd/Ctrl+点击在新标签页打开，与 Obsidian 原生渲染的 wikilink 行为一致。
    const newLeaf = event.metaKey || event.ctrlKey;
    void this.app.workspace.openLinkText(target, this.file?.path ?? "", newLeaf);
  }

  /**
   * 标记面板/输入浮层都绑定着打开它们那一刻的节点 id（闭包捕获，见 openMarks/
   * insertLink）。选中节点变化的路径不止点击一种：方向键 navigate、以及
   * addChild/addSibling/remove 之后把 selectedId 重新指向新节点，都不经过
   * 任何 pointerdown，不会触发这两个浮层自己的「点外部关闭」监听
   * （marks-panel.ts/input-popover.ts 的 document pointerdown 捕获）。
   * 如果不在这里补一次一致性检查，方向键切到别的节点后，面板/浮层其实还在
   * 悄悄操作已经不再选中的旧节点——这正是 Task 14 第一次打通标记面板入口后
   * 才会暴露出来的场景，Task 13 尚无法触发。
   */
  private closeStaleOverlays(): void {
    if (
      this.marksPanel === null &&
      this.inputPopover === null &&
      this.notePopover === null
    ) {
      return;
    }
    if (this.overlayOwnerId === this.selectedId && this.editingId === null) return;
    this.marksPanel?.close();
    this.inputPopover?.close();
    this.notePopover?.close();
    this.marksPanel = null;
    this.inputPopover = null;
    this.notePopover = null;
    this.overlayOwnerId = null;
  }

  /** 选中变化或重绘后同步工具栏位置与按钮可用性。 */
  private syncToolbar(): void {
    if (this.toolbar === null || this.layers === null || this.doc === null) return;
    this.closeStaleOverlays();

    if (this.selectedId === null || this.editingId !== null) {
      this.toolbar.hide();
      return;
    }

    const element = this.layers.nodes.querySelector<HTMLElement>(
      `.mm-node[data-id="${this.selectedId}"]`,
    );
    const node = findNode(this.doc.root, this.selectedId);
    if (element === null || node === null) {
      this.toolbar.hide();
      return;
    }

    // 能力位一律来自 tree-ops：视图层不重新推导「哪些操作对这个节点有效」，
    // 否则两处规则会漂移，出现「按钮亮着但点了没反应」。
    this.toolbar.showFor(element, {
      canCollapse: node.children.length > 0,
      canAddSibling: canAddSibling(this.doc.root, node.id),
      canRemove: canRemove(this.doc.root, node.id),
      canMark: canMark(this.doc.root, node.id),
      canNote: canNote(this.doc.root, node.id),
      hasHiddenContent: hasHiddenContent(node),
    });
  }

  private applyCamera(): void {
    if (this.layers === null) return;
    this.layers.canvas.style.transform = cssTransform(this.camera);
    this.controls?.setScale(this.camera.scale);
    // 缩放/平移后工具栏要跟随选中节点的新屏幕位置移动，否则会和节点脱节。
    // 参见任务报告中的性能说明：这里的额外开销是一次按 id 的 querySelector、
    // 一次树查找与 placeNear 内部的 getBoundingClientRect 读取，量级与已有的
    // controls.setScale()/拖拽逻辑中同样按帧调用的 DOM 读取一致，不构成新的
    // 布局抖动来源。
    this.syncToolbar();
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
    this.dragControl = attachDrag({
      root: this.root,
      on: (type, handler) => this.registerDomEvent(this.root, type, handler),
      isEditing: () => this.editingId !== null,
      onDrop: (sourceId, target) => this.handleDrop(sourceId, target),
    });
  }

  private attachNoteTipLayer(): void {
    this.noteTips = attachNoteTips({
      root: this.root,
      on: (type, handler) => this.registerDomEvent(this.root, type, handler),
      noteOf: (id) => {
        if (this.doc === null) return null;
        return findNode(this.doc.root, id)?.note?.text ?? null;
      },
      onOpenLink: (target, event) => this.openLink(target, event),
    });
  }

  private handleDrop(sourceId: string, target: DropTarget): void {
    if (this.doc === null) return;
    const doc = this.doc;

    if (target.zone === "child") {
      const node = findNode(doc.root, target.targetId);
      if (node === null) return;
      // 落点索引交给 moveNode clamp：它会把下标夹到第一个标题子节点之前，
      // 维护 list-before-heading 不变量（见 tree-ops.firstHeadingIndex）。
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
          // 根节点不能带标记：文件没有 H1 行时根本没有可写的位置，
          // setMarks/toggleMark 在 tree-ops 里对根 id 是有意的 no-op。如果这里
          // 仍然跑 parseMarks，会把用户敲进标题里的 "(p1) " 之类前缀解析成
          // marks 再丢弃（setMarks 对根不生效），造成文字被静默吞掉。根节点的
          // 编辑当纯文本处理。文件里的 H2–H6 走下面的常规分支，可以带标记。
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
    this.syncToolbar();
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
    // 进入编辑态要立刻隐藏工具栏：selectedId 在双击/F2 时通常不变（节点已经是
    // 选中状态），setSelection() 的去重会跳过同步，若这里不显式调用，工具栏会
    // 继续悬浮在正在编辑的节点上方——此时点它的按钮（例如「文字样式」）会读到
    // doc 里尚未提交的旧文本，和 contenteditable 里正在编辑的新内容对不上。
    this.syncToolbar();
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

  /**
   * 恢复 100% 原始大小（右上角的百分比读数就是这个按钮，见 controls.ts）。
   *
   * 以**视口中心**为不动点：正在读的那块内容留在原地变大，不会被拉回根节点——
   * 缩到 32% 时点它是「把眼前这块放大到能看清」，而不是「回到开头」。想回根节点
   * 就先点「适应窗口」再点它。与 `applyInitialCamera()` 的 100% 分支
   * （`actualSize()`，那里要摆放根节点）语义不同，这是有意的：打开文件的那一刻
   * 相机还没有「当前视口中心」可言。
   */
  private resetZoom(): void {
    const rect = this.root.getBoundingClientRect();
    this.camera = zoomTo(this.camera, 1, rect.width / 2, rect.height / 2);
    this.applyCamera();
  }

  /** 让整图适应当前视口。 */
  fitToView(): void {
    this.placeCamera(fit);
  }

  /** 打开一张导图时的初始相机：按设置项 `defaultZoom` 选「适应窗口」或 100%。
   *  设置是 getter 读的，所以改完设置对之后打开的视图立刻生效。 */
  private applyInitialCamera(): void {
    this.placeCamera(this.settings().defaultZoom === "actual" ? actualSize : fit);
  }

  /** `fitToView()` 与 `applyInitialCamera()` 的共同外壳：两者只差用哪个纯函数
   *  算相机，其余（拿视口尺寸、跳过零尺寸视口、落地相机、清 needsInitialCamera）
   *  完全一致。 */
  private placeCamera(compute: (content: Size, viewport: Size) => Camera): void {
    if (this.lastLayout === null) return;
    const rect = this.root.getBoundingClientRect();
    // 视口尚未完成布局时尺寸为 0：fit()/actualSize() 对此返回单位相机（不产生
    // NaN），但那不是我们想要的结果，所以在这里直接跳过、保留
    // needsInitialCamera，等 resizeObserver 在视口拿到真实尺寸后再补一次。
    if (rect.width <= 0 || rect.height <= 0) return;
    this.camera = compute(
      { width: this.lastLayout.width, height: this.lastLayout.height },
      { width: rect.width, height: rect.height },
    );
    this.applyCamera();
    this.needsInitialCamera = false;
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
