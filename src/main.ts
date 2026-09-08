import { getLanguage, MarkdownView, Notice, Plugin, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { setMindmapFlag } from "./model/collapse-state";
import { resolveLocale, setLocale, t } from "./i18n";
import { newMindmapContent, uniqueMindmapPath } from "./model/new-file";
import {
  DEFAULT_SETTINGS,
  MindmapSettingTab,
  type MindmapSettings,
} from "./settings";
import { MINDMAP_VIEW_TYPE, MindmapView } from "./view";

/** 自动切换被 Obsidian 的 setViewState 重入守卫丢弃时的重试间隔与上限（见 flipToMindmap）。 */
const FLIP_RETRY_MS = 50;
const FLIP_MAX_ATTEMPTS = 20;

export default class MindmapPlugin extends Plugin {
  override settings: MindmapSettings = { ...DEFAULT_SETTINGS };

  /** 正在切换视图的文件路径，避免 file-open 事件递归。 */
  private readonly flipping = new Set<string>();

  override async onload(): Promise<void> {
    await this.loadSettings();

    // 语言必须在**任何**读 t() 的东西之前定下来，所以它紧跟 loadSettings()。
    // 最硬的那条是命令名：addCommand 时就求值，之后改语言只能靠 applyLanguage()
    // 整个重注册一遍。设置页现在走 display()（用户点开时才求值），对顺序不敏感，
    // 但曾经用声明式 getSettingDefinitions() 时是敏感的——addSettingTab 会立刻
    // 调一次去建搜索索引，setLocale 排在它之后就出现过「语言那一行是中文、其余
    // 行是英文」的混排。顺序保持现状，别再把 setLocale 往后挪。
    setLocale(resolveLocale(this.settings.language, getLanguage()));

    this.registerView(
      MINDMAP_VIEW_TYPE,
      // 设置以 getter 注入，不是拷一份值：用户改完设置立刻生效，视图不需要被
      // 重建，也不用像 i18n 那样再开一处模块级可变状态（见 i18n.ts 的说明）。
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, () => this.settings),
    );

    this.addSettingTab(new MindmapSettingTab(this.app, this));
    this.registerCommands();

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.newMindmap"))
              .setIcon("git-fork")
              .onClick(() => void this.createMindmapInFolder(file)),
          );
          return;
        }
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle(t("menu.openAsMindmap"))
            .setIcon("git-fork")
            .onClick(() => this.openAsMindmap(file)),
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
        void this.flipToMindmap(leaf, file).finally(() => this.flipping.delete(file.path));
      }),
    );
  }

  /**
   * 把 leaf 切到导图视图，并确认切换真的生效——不生效就短间隔重试。
   *
   * 为什么不能只调一次 setViewState：`WorkspaceLeaf.setViewState` 有一个私有重入守卫
   * （`this.working`），同一 leaf 上有另一次 setViewState 尚未结束时，新的调用会被
   * **静默丢弃**——不抛错、promise 正常 resolve。从文件浏览器点开文件恰好撞上它：
   * 点击先经 leaf 容器的 pointerdown 把侧栏 leaf 设为 activeLeaf；随后 onSelfClick
   * 调 `openFile(file)`（不 await，其内部 setViewState 挂起在读盘上、working=true），
   * 再同步调 `setActiveLeaf(getMostRecentLeaf())` → 防抖 0ms 后触发 file-open。此时目标
   * leaf 仍在 working，我们的切换被丢掉；等 openFile 读完盘再触发 activeLeafEvents 时，
   * getActiveFile 已等于 lastActiveFile，不会再有第二次 file-open。表现就是"设置开着、
   * frontmatter 也对，从文件浏览器点开却停在源码模式"。只有目标 leaf 原先是别的视图
   * 类型（比如另一张导图）时才碰巧能成功，因为那条路径会多触发一次 file-open。
   * 以上均从 obsidian.asar（1.12.7）反编译核实。
   *
   * `working` 是私有字段，这里不读它，而是以「leaf.view 是否真的变成了导图视图」为判据。
   * leaf 已经换了文件（用户又点了别的）就放弃，不去抢用户的操作。
   */
  private async flipToMindmap(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    for (let attempt = 0; attempt < FLIP_MAX_ATTEMPTS; attempt++) {
      const view = leaf.view;
      if (view.getViewType() === MINDMAP_VIEW_TYPE) return;
      if (!(view instanceof MarkdownView) || view.file?.path !== file.path) return;
      await leaf.setViewState({
        type: MINDMAP_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      });
      if (leaf.view.getViewType() === MINDMAP_VIEW_TYPE) return;
      await new Promise<void>((resolve) => window.setTimeout(resolve, FLIP_RETRY_MS));
    }
  }

  /** 两个命令的 id。removeCommand 要用，必须与 addCommand 的 id 逐字一致。 */
  private static readonly COMMAND_IDS = [
    "toggle-mindmap-view",
    "mark-as-mindmap",
  ] as const;

  /**
   * 注册两个命令。可重复调用——`applyLanguage()` 换语言时先移除再注册，
   * 让命令面板里的名字立即变成新语言。
   */
  private registerCommands(): void {
    this.addCommand({
      id: "toggle-mindmap-view",
      name: t("command.toggleView"),
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

    this.addCommand({
      id: "mark-as-mindmap",
      name: t("command.markAsMindmap"),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file === null || file.extension !== "md") return false;
        if (checking) return true;
        void this.markAsMindmap(file);
        return true;
      },
    });
  }

  /**
   * 按当前设置确定界面语言，并让它在所有已渲染的界面上生效。
   *
   * `t()` 自己不通知任何人（见 i18n.ts 的 setLocale 说明），所以这里要显式做
   * 三件事：
   * 1. 设语言；
   * 2. 重注册命令——`removeCommand` 的 id 必须与注册时逐字一致，写错会表现为
   *    命令重复出现或直接消失，而五条门禁看不到这一点，只能人工验；
   * 3. 让每个已打开的导图视图重建图层（`refreshLocale()` 走的是
   *    `layers = null` + `render()`，与 setViewData 同一条路径）。
   */
  applyLanguage(): void {
    setLocale(resolveLocale(this.settings.language, getLanguage()));

    for (const id of MindmapPlugin.COMMAND_IDS) {
      this.removeCommand(id);
    }
    this.registerCommands();

    for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof MindmapView) view.refreshLocale();
    }
  }

  /** 在当前面板用思维导图视图打开文件。 */
  private openAsMindmap(file: TFile): Promise<void> {
    return this.app.workspace.getLeaf(false).setViewState({
      type: MINDMAP_VIEW_TYPE,
      state: { file: file.path },
      active: true,
    });
  }

  /**
   * 在 folder 下新建一个带 `mindmap: true` 与一级标题的文件并立即以导图视图打开。
   * 文件名沿用 Obsidian「未命名 / 未命名 1 / …」的去重规则，见 model/new-file.ts。
   */
  private async createMindmapInFolder(folder: TFolder): Promise<void> {
    const path = uniqueMindmapPath(
      folder.path,
      t("newFile.basename"),
      (candidate: string) => this.app.vault.getAbstractFileByPath(candidate) !== null,
    );
    const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    let file: TFile;
    try {
      file = await this.app.vault.create(path, newMindmapContent(title));
    } catch (error) {
      new Notice(t("notice.createFailed", { error: String(error) }));
      return;
    }
    await this.openAsMindmap(file);
  }

  /**
   * 直接对文件文本做 frontmatter 补丁，不经过 MindmapView：文件不必是当前
   * 打开的、更不必已经是导图视图，才能执行这条命令。
   */
  private async markAsMindmap(file: TFile): Promise<void> {
    await this.app.vault.process(file, (raw) => {
      // 先归一化 CRLF → LF，再拼接 frontmatter：如果不做这一步，当原文件
      // 是 CRLF 时，下面重建的 frontmatter 块（固定用 \n 拼接）会和原样保留的
      // 正文（仍是 \r\n）拼在一起，产生一个换行符混用的文件。归一成 LF 与
      // model/parser.ts 对同一 frontmatter 正则的处理方式保持一致，也是
      // README 里写明的三种写回归一化之一。
      const content = raw.replace(/\r\n/g, "\n");
      // 第 2 组是结束围栏 `---` 后的尾随空白，原样重放，和 model/parser.ts
      // 一致——这条命令只负责改 frontmatter 里的一个键，不该顺带改别的字节。
      const match = /^---\r?\n([\s\S]*?)\r?\n---([ \t]*)(?:\r?\n|$)/.exec(content);
      if (match === null) {
        return `---\n${setMindmapFlag(null, true)}\n---\n\n${content}`;
      }
      const updated = setMindmapFlag(match[1], true);
      return `---\n${updated}\n---${match[2]}\n${content.slice(match[0].length)}`;
    });
    new Notice(t("notice.marked"));
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
      new Notice(t("notice.toggleFailed", { error: String(error) }));
    } finally {
      this.flipping.delete(file.path);
    }
  }

  async loadSettings(): Promise<void> {
    // loadData() 返回 any；先收窄成 unknown 再逐字段校验类型，data.json 被手改坏
    // （比如 autoOpen 写成字符串）时回落到默认值，而不是把脏值灌进 settings。
    const raw: unknown = await this.loadData();
    const stored: Record<string, unknown> =
      typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    this.settings = {
      autoOpen:
        typeof stored.autoOpen === "boolean" ? stored.autoOpen : DEFAULT_SETTINGS.autoOpen,
      // 同上：只接受三个已知取值，其余（含手改成别的字符串、或旧版本没有这个
      // 键）一律回落到 "auto"。收窄成联合类型也让 resolveLocale 不用兜底。
      language:
        stored.language === "auto" ||
        stored.language === "zh" ||
        stored.language === "en"
          ? stored.language
          : DEFAULT_SETTINGS.language,
      // 同上：只接受两个已知取值。旧版本的 data.json 没有这个键，回落到 "fit"，
      // 也就是这个设置项存在之前的行为。
      defaultZoom:
        stored.defaultZoom === "fit" || stored.defaultZoom === "actual"
          ? stored.defaultZoom
          : DEFAULT_SETTINGS.defaultZoom,
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
