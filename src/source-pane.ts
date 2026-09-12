/**
 * 源码分屏：把「点一下按钮该发生什么」的全部判断收在一个纯函数里，
 * `SourcePaneController` 只做 Obsidian API 的适配。
 *
 * 设计文档：docs/superpowers/specs/2026-09-12-source-split-design.md
 */

// **全文只允许 `import type`。** `obsidian` npm 包只有类型声明没有实现，任何在
// 运行时 import 它的模块都无法被 vitest 加载——`decidePaneAction` 的单测是本
// 特性唯一的自动化覆盖，不能为了一个 `instanceof` 把它丢掉。同款理由见
// `src/view/drag.ts`（一个 obsidian 都不 import，所以 zoneFromOffset 可单测）。
import type { App, TFile, WorkspaceLeaf } from "obsidian";

/** 一个 markdown 面板的快照：它是哪个 leaf、此刻显示着哪个文件。 */
export interface PaneSnapshot<T> {
  readonly leaf: T;
  readonly path: string | null;
}

/** 按钮/命令被触发后该做的事。 */
export type PaneAction<T> =
  | { readonly kind: "close"; readonly leaf: T }
  | { readonly kind: "reveal"; readonly leaf: T }
  | { readonly kind: "create" };

/**
 * 决定按钮该做什么。
 *
 * `markdownPanes` 由调用方从 `getLeavesOfType("markdown")` 现场取，因此
 * 「这个 leaf 还活着」与「它是个 markdown 面板」两件事**已经由它的成员资格
 * 蕴含**，这里不再单独判断。设计文档 §5.2 的三条失效判据于是全部收敛成同
 * 一条：记忆中的配对面板还在不在「当前显示着 `path` 的 markdown 面板」这个
 * 集合里。
 *
 * - 面板被用户关掉 → 不在 `markdownPanes` 里。
 * - 面板被挪去开了别的文件 → 在列表里但 `path` 不匹配。
 * - 面板被手动切成了导图视图 → 它不再属于 `getLeavesOfType("markdown")`。
 *
 * 泛型而不是直接写 `WorkspaceLeaf`：让这个决定可以在不 mock 整个 Workspace
 * 的情况下被单测覆盖（与 `src/view/drag.ts` 的 `zoneFromOffset` 同一套路）。
 */
export function decidePaneAction<T>(
  markdownPanes: readonly PaneSnapshot<T>[],
  remembered: T | null,
  path: string,
): PaneAction<T> {
  const showing = markdownPanes.filter((candidate) => candidate.path === path);
  if (remembered !== null && showing.some((candidate) => candidate.leaf === remembered)) {
    return { kind: "close", leaf: remembered };
  }
  const reusable = showing[0];
  if (reusable !== undefined) return { kind: "reveal", leaf: reusable.leaf };
  return { kind: "create" };
}

/**
 * controller 只需要导图视图的这两样东西。
 *
 * 用结构化接口而不是 `import { MindmapView }`：`view.ts` 需要 controller 的
 * 类型，controller 若反过来在运行时 import `view.ts` 就成了循环依赖。同款做法
 * 见 `src/view/drag.ts` 的 `DragHost`。`MindmapView` 天然满足它——`leaf` 来自
 * `View`，`file` 来自 `FileView`。
 */
export interface MindmapHost {
  readonly leaf: WorkspaceLeaf;
  readonly file: TFile | null;
}

/**
 * 源码分屏的开关。**分屏的唯一状态持有者。**
 *
 * `pairs` 用 `WeakMap` 而不是 `Map`：`WorkspaceLeaf` 没有公开的 `id` 字段
 * （`obsidian.d.ts` 只暴露 `parent` 与 `view`），拿 leaf 对象本身当键最直接，
 * 顺带免掉「leaf 关闭后要记得从 Map 里删」的泄漏面。所有查询都是「给定导图
 * leaf 找源码 leaf」，从不需要遍历。
 *
 * **`pairs` 只服务于按钮的开/关语义，不承担正确性。** 它是内存态，Obsidian
 * 重启后必然为空；`autoOpen` 的豁免规则被刻意设计成不依赖它（见 `main.ts` 的
 * `file-open` 处理器与设计文档 §4.1），所以 `pairs` 丢了最多是「按钮以为没开
 * 过，再点一次会复用到已有面板」，不会让分屏坏掉。
 */
export class SourcePaneController {
  private readonly pairs = new WeakMap<WorkspaceLeaf, WorkspaceLeaf>();

  constructor(private readonly app: App) {}

  /** 有配对的源码面板就关掉，没有就开一个。按钮与命令共用的唯一入口。 */
  async toggle(host: MindmapHost): Promise<void> {
    const file = host.file;
    if (file === null) return;

    const action = decidePaneAction(this.snapshot(), this.pairs.get(host.leaf) ?? null, file.path);
    switch (action.kind) {
      case "close":
        this.pairs.delete(host.leaf);
        action.leaf.detach();
        return;
      case "reveal":
        // 用户自己已经开着这个文件的源码面板：登记为配对并聚焦过去，
        // 不新开第三个面板（设计文档 §5.1）。
        this.pairs.set(host.leaf, action.leaf);
        await this.app.workspace.revealLeaf(action.leaf);
        return;
      case "create": {
        // before = true 是必需的：workspace.getLeaf("split") 默认往右开，
        // 那会得到「左导图 / 右源码」，与需求相反（设计文档 §3.1）。
        const pane = this.app.workspace.createLeafBySplit(host.leaf, "vertical", true);
        await pane.openFile(file, { state: { mode: "source" } });
        this.pairs.set(host.leaf, pane);
        return;
      }
    }
  }

  /**
   * 当前所有 markdown 面板各自显示着哪个文件。
   *
   * 路径取自 `leaf.getViewState().state.file` 而不是 `leaf.view.file`：后者要
   * 先用 `view instanceof MarkdownView` 收窄，而那是个值导入（见文件顶部）。
   * `FileView.getState()` 返回的 `state.file` 就是文件路径，`state` 的类型是
   * `Record<string, unknown>`，用 typeof 守卫读出来即可，不需要 any 或断言。
   */
  private snapshot(): PaneSnapshot<WorkspaceLeaf>[] {
    return this.app.workspace.getLeavesOfType("markdown").map((leaf) => {
      const file = leaf.getViewState().state?.file;
      return { leaf, path: typeof file === "string" ? file : null };
    });
  }
}
