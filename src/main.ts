import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  MindmapSettingTab,
  type MindmapSettings,
} from "./settings";
import { MINDMAP_VIEW_TYPE, MindmapView } from "./view";

export default class MindmapPlugin extends Plugin {
  override settings: MindmapSettings = { ...DEFAULT_SETTINGS };

  /** 正在切换视图的文件路径，避免 file-open 事件递归。 */
  private readonly flipping = new Set<string>();

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      MINDMAP_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MindmapView(leaf),
    );

    this.addSettingTab(new MindmapSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-mindmap-view",
      name: "切换思维导图 / 源码视图",
      checkCallback: (checking: boolean) => {
        // 用「哪个视图持有目标文件」反推 leaf，而不是用 getMostRecentLeaf() 去配
        // getActiveFile()：分屏或侧栏聚焦时二者可能指向不同的 leaf，导致命令误
        // 切一个没有显示该文件的面板。leaf 可能当前是 MarkdownView 也可能是
        // MindmapView，两种都要处理。
        const view =
          this.app.workspace.getActiveViewOfType(MarkdownView) ??
          this.app.workspace.getActiveViewOfType(MindmapView);
        const file = view?.file ?? null;
        if (view === null || file === null || file.extension !== "md") return false;
        if (checking) return true;
        void this.toggleView(view.leaf, file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle("以思维导图打开")
            .setIcon("git-fork")
            .onClick(() => {
              const leaf = this.app.workspace.getLeaf(false);
              void leaf.setViewState({
                type: MINDMAP_VIEW_TYPE,
                state: { file: file.path },
                active: true,
              });
            }),
        );
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!this.settings.autoOpen || file === null) return;
        if (file.extension !== "md" || this.flipping.has(file.path)) return;

        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (frontmatter?.mindmap !== true) return;

        // file-open 事件不带 leaf，不能靠 getMostRecentLeaf() 猜：分屏/侧栏场景下
        // 它可能不是显示这个文件的面板。改为遍历所有 markdown leaf，只挑视图里
        // file.path 与打开的文件一致的那个；找不到就什么都不做。
        const leaf = this.app.workspace
          .getLeavesOfType("markdown")
          .find(
            (candidate) =>
              candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path,
          );
        if (leaf === undefined) return;

        this.flipping.add(file.path);
        void leaf
          .setViewState({
            type: MINDMAP_VIEW_TYPE,
            state: { file: file.path },
            active: true,
          })
          .finally(() => this.flipping.delete(file.path));
      }),
    );
  }

  private async toggleView(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    const isMindmap = leaf.view.getViewType() === MINDMAP_VIEW_TYPE;
    this.flipping.add(file.path);
    try {
      await leaf.setViewState({
        type: isMindmap ? "markdown" : MINDMAP_VIEW_TYPE,
        state: isMindmap
          ? { file: file.path, mode: "source" }
          : { file: file.path },
        active: true,
      });
    } catch (error) {
      new Notice(`切换视图失败：${String(error)}`);
    } finally {
      this.flipping.delete(file.path);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
