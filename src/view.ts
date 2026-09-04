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
  findNode,
  findParent,
  moveNode,
  navigate,
  removeNode,
  setMarks,
  setText,
  toggleCollapse,
  toggleMark,
} from "./model/tree-ops";
import { parseMarks } from "./model/marks";
import type { Marks, MindDoc, MindNode } from "./model/types";
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
import { openInputPopover } from "./view/input-popover";
import {
  attachInteractions,
  startInlineEdit,
  type Intent,
} from "./view/interaction";
import type { LayoutResult } from "./view/layout";
import { openMarksPanel } from "./view/marks-panel";
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
  private toolbar: ReturnType<typeof createToolbar> | null = null;
  private marksPanel: { close(): void } | null = null;
  /** 插入链接的输入浮层；文件切换/重建图层时必须显式 close()，否则它注册在
   *  document 上的 pointerdown 捕获监听会在浮层 DOM 被 clear(this.root) 销毁后
   *  继续存在，成为跨文件的监听器泄漏（见 clear()）。 */
  private inputPopover: { close(): void } | null = null;
  /** marksPanel/inputPopover 当前绑定的节点 id，见 closeStaleOverlays()。 */
  private overlayOwnerId: string | null = null;
  /** parse() 抛异常时的错误信息；非 null 时 render() 走错误态分支，doc 为 null。 */
  private parseError: string | null = null;
  /** 本视图最近一次通过 getViewData() 写出的文件内容，用于在 vault "modify"
   *  回调里区分「这是我们自己的保存触发的回声」还是「文件在外部被真的改动了」。 */
  private lastWritten: string | null = null;

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

    // AI 协同的关键路径：任意外部程序（或用户在源码模式里）直接改这个文件后，
    // 画布要自动刷新。见 reloadFromDisk() 里对「自己的保存触发的回声」与
    // 「真正的外部修改」的区分。
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.path !== this.file?.path) return;
        void this.reloadFromDisk(file);
      }),
    );
  }

  getDoc(): MindDoc | null {
    return this.doc;
  }

  /** Obsidian 读取文件内容后调用；reloadFromDisk() 里外部变更同步也复用这条路径。 */
  override setViewData(data: string, _clear: boolean): void {
    // 防御性清理：正常情况下 onUnloadFile 已经在文件切换前把上一份文档的待保存
    // 计时器 flush 掉了；这里再兜底一次，避免任何遗漏路径下的计时器在新文档加载
    // 后触发，把新文档的内容错误地当成旧文档保存。
    this.clearSaveTimer();
    const fileName = this.file?.name ?? "未命名.md";
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
    }
    // 强制走 render() 里「layers === null」的重建分支：不仅重建图层/控件/
    // 工具栏，还会 clear(this.root) 一次，顺带清掉任何不属于当前渲染路径、
    // 直接挂在 this.root 下的浮层残留（例如 reloadFromDisk() 场景下一次被
    // 外部变更打断的拖拽留下的 ghost/drop-indicator 元素）。普通首次加载时
    // this.layers 本来就是 null，这里是无操作。
    this.layers = null;
    this.render();
    if (this.parseError !== null) return;
    // 视口此时可能还没有完成布局（尺寸为 0），fitToView() 在那种情况下是无操作。
    // needsFit 置位后由 resizeObserver 在视口拿到非零尺寸时补一次。
    this.needsFit = true;
    this.fitToView();
  }

  /** Obsidian 保存时调用，必须返回当前完整文件内容。 */
  override getViewData(): string {
    if (this.doc === null) {
      // 解析错误态：没有可序列化的文档，原样交回未被触碰的原始内容。同时把它
      // 记为“我们自己写出的内容”，避免它被外部程序（例如 Obsidian 在错误态下
      // 仍然做的一次全局保存）原样写回磁盘后，被 reloadFromDisk() 的自写检测
      // 误判成一次外部修改而弹出多余的“以磁盘内容为准”提示。
      this.lastWritten = this.data;
      return this.data;
    }
    const output = serialize(this.withCollapsedInFrontmatter(this.doc));
    this.lastWritten = output;
    return output;
  }

  /**
   * 外部（例如 AI 直接改文件，或用户在源码模式手改）修改后重新解析，保留相机
   * 与选中——这是整个插件「不内置 AI、靠外部程序改 .md 文件」这条设计的关键
   * 落地点，见 vault.on("modify") 的注册处。
   *
   * 自写检测：本视图每次保存都会先经过 getViewData()，那里把即将写出的内容
   * 记进 lastWritten，随后 Obsidian 才会把同一份内容通过 vault.modify 落盘，
   * 触发这里监听的 "modify" 事件——这个「回声」事件读回的内容与 lastWritten
   * 逐字节相同，据此可靠地和「文件真的被别的程序改了」区分开，对首次加载
   * （lastWritten 仍是 null，不会误判成自写）、以及外部编辑恰好把内容改回
   * 和 lastWritten 相同字节序列（此时确实不需要重绘，因为内存里的文档本就
   * 与磁盘一致）这两种边界情况都成立。
   */
  private async reloadFromDisk(file: TFile): Promise<void> {
    // vault.read() 是一次真正的磁盘 I/O，之后才能判断这是不是自己的回声；
    // 但等待期间事件循环仍会正常跑定时器——如果本地正好有一个即将在这几毫秒
    // 内触发的防抖保存，它会在我们判断出「这是外部修改」之前抢先把内存里旧的
    // （尚未包含这次外部变更的）内容写回磁盘，覆盖掉外部刚写入的内容。因此必须
    // 在发起读取之前就先把计时器挪开，而不是等读完、判断完之后再挪；如果读完
    // 发现其实并没有真外部变化（见下面 lastWritten 比较），再把计时器原样接
    // 回去，不丢用户尚未落盘的本地编辑。
    const wasPending = this.saveTimer !== null;
    if (wasPending) this.clearSaveTimer();

    const content = await this.app.vault.read(file);
    if (content === this.lastWritten) {
      if (wasPending) this.scheduleSave();
      return;
    }

    // 到这里才能确认是一次真正的外部修改。下面这几类瞬时 UI 状态都引用着
    // 即将被整体替换掉的旧文档，必须显式收尾，不能指望马上要发生的
    // clear(this.root) 顺带处理——标记面板/输入浮层/工具栏样式菜单各自还在
    // document 上挂着 pointerdown/keydown 捕获监听（见 marks-panel.ts、
    // input-popover.ts、toolbar.ts），只销毁 DOM 节点不会解绑这些监听，会在
    // 每次外部变更刷新后都泄漏一组。
    const hadUnsavedEdit = this.editingId !== null;
    if (hadUnsavedEdit) {
      // 与 onUnloadFile 同一手法：blur() 会同步走 startInlineEdit 里的
      // onBlur -> finish(true) -> commitText，把编辑框里当前的文字当一次正常
      // 提交收尾。提交去哪儿并不重要——旧文档整体都要被下面的磁盘内容替换掉，
      // 这一步真正要的是用一条已知、确定性的路径结束编辑态，而不是依赖
      // “聚焦元素被移出文档时浏览器是否补发 blur”这种因浏览器而异的行为。
      this.root.querySelector<HTMLElement>(".mm-text.mm-editing")?.blur();
    }
    // 标记面板/输入浮层各自捕获着打开它们那一刻的节点 id（对标记面板而言还有
    // marks 快照）；重新解析后同名 id 是否还指向同一节点、marks 是否还是面板
    // 里显示的那份，都不再有保证。工具栏的样式菜单同理，且它是三者里唯一挂了
    // document 监听、又没有独立 close() 方法的一个，必须在丢弃 this.toolbar
    // 引用之前调用 hide() 把监听摘掉。
    this.toolbar?.hide();
    this.marksPanel?.close();
    this.marksPanel = null;
    this.inputPopover?.close();
    this.inputPopover = null;
    this.overlayOwnerId = null;

    if (wasPending || hadUnsavedEdit) {
      new Notice("文件已在外部修改，以磁盘内容为准。");
    }

    const camera = this.camera;
    const selectedId = this.selectedId;

    this.data = content;
    this.setViewData(content, false);

    // setViewData() 内部会尝试 fitToView()：视口通常已有非零尺寸，fitToView
    // 会立即成功并把 needsFit 置回 false；但如果这个 leaf 当前是隐藏的后台
    // 标签页（尺寸为 0），fitToView 会是无操作、needsFit 会保持 true——那样
    // 的话，之后任何一次真实的窗口/面板尺寸变化都会触发 resizeObserver 里
    // 排队的那次补拍 fitToView()，把下面刻意恢复的相机又冲掉。外部改文件不
    // 应该在未来任何时间点让视口跳动，所以这里连同 needsFit 一并显式收尾。
    this.camera = camera;
    this.selectedId = selectedId;
    this.needsFit = false;
    this.applyCamera();
    this.refreshSelectionClasses();
    this.syncToolbar();
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
    // 同上：工具栏与浮层同样是「当前文档」的展示状态，且标记面板/输入浮层各自
    // 在 document 上挂了 pointerdown/keydown 捕获监听（见 marks-panel.ts、
    // input-popover.ts）。必须显式 close() 让它们摘掉这些监听，仅仅依赖下面的
    // clear(this.root) 销毁 DOM 节点是不够的——监听器挂在 document 而非
    // this.root 上，不会随 DOM 移除自动解绑，否则每切换一次文件就泄漏一组。
    this.toolbar = null;
    this.marksPanel?.close();
    this.marksPanel = null;
    this.inputPopover?.close();
    this.inputPopover = null;
    this.overlayOwnerId = null;
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
        this.eventsAttached = true;
      }
    }
    this.lastLayout = renderMindmap(this.layers, this.doc.root, this.selectedId);
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
    const wrap = el("div", "mm-error", this.root);
    const title = el("div", "mm-error-title", wrap);
    title.textContent = "无法解析为思维导图";
    const detail = el("div", "mm-error-detail", wrap);
    detail.textContent = message;
    const hint = el("div", "mm-error-detail", wrap);
    hint.textContent = "文件未被修改。可切到源码模式检查内容。";

    const button = el("button", "mm-error-btn", wrap);
    button.type = "button";
    button.textContent = "切换到源码模式";
    button.addEventListener("click", () => {
      const path = this.file?.path;
      if (path === undefined) return;
      void this.leaf.setViewState({
        type: "markdown",
        state: { file: path, mode: "source" },
        active: true,
      });
    });
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
      placeholder: "链接目标（笔记名）",
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
    if (this.marksPanel === null && this.inputPopover === null) return;
    if (this.overlayOwnerId === this.selectedId && this.editingId === null) return;
    this.marksPanel?.close();
    this.inputPopover?.close();
    this.marksPanel = null;
    this.inputPopover = null;
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

    this.toolbar.showFor(element, node.children.length > 0, node.id === this.doc.root.id);
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
