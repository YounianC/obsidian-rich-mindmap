import { Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
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
        const leaf = this.app.workspace.getMostRecentLeaf();
        const file = this.app.workspace.getActiveFile();
        if (leaf === null || file === null || file.extension !== "md") return false;
        if (checking) return true;
        void this.toggleView(leaf, file);
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

        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf === null || leaf.view.getViewType() !== "markdown") return;

        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (frontmatter?.mindmap !== true) return;

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
