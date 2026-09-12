# 源码 / 导图左右分屏 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在导图视图里加一个标题栏按钮与一条命令，一键把同一个文件在左侧以 Markdown 源码模式、右侧以导图视图并排打开，再点一次关闭。

**Architecture:** 分屏由**两个 leaf** 承载，用 Obsidian 公开 API `createLeafBySplit(leaf, "vertical", true)` + `openFile(file, { state: { mode: "source" } })`。两侧内容的同步完全交给 Obsidian（两个视图读写同一个 vault 文件），插件**不搬运任何文本**。新增 `src/source-pane.ts` 收拢全部逻辑：一个可单测的纯决策函数 `decidePaneAction` + 一个薄适配层 `SourcePaneController`。`main.ts` 里给 `autoOpen` 的自动翻转加一条**无状态**豁免规则。

**Tech Stack:** TypeScript（`strict: true`）、Obsidian 1.8.7+ 公开 API、vitest、esbuild。

**设计文档：** [docs/superpowers/specs/2026-09-12-source-split-design.md](../specs/2026-09-12-source-split-design.md)。本计划的每个决定都能在那里找到出处，章节号（§4.1 等）指的是那份文档。

## Global Constraints

- **`src/model/`、`src/view/layout.ts`、`src/view/camera.ts` 一行都不许动。** 本特性 100% 在视图层与工作区层。
- **面向用户的字符串一律走 `t()`（`src/i18n.ts`），不写死任何语言。** 中文表 `zh` 是 key 的唯一来源，英文表 `en` 声明为 `Record<MessageKey, string>`，漏译是编译错误。
- **不用 `any`。** 必要时 `unknown` + 类型守卫。`tsconfig` 开了 `strict` / `noUnusedLocals` / `noUnusedParameters` / `noImplicitOverride`。
- **不引入任何新依赖。**
- **不调用 `requestSave()`**（AGENTS.md 第 5 条），本特性不碰保存路径。
- **不监听 `editor-change`、不做跨 leaf 的内存文本同步**（spec §2）。
- 每个任务结束前跑五条门禁：`npm run typecheck` / `npm test` / `npm run build` / `npm run check:purity` / `npm run check:i18n`。全绿才提交。
- 提交信息用中文，结尾附 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- **报告里不得声称视觉或交互行为正确**（AGENTS.md「自动化测不到什么」）。门禁看不到本特性的任何行为，只能保证不编译错、不越界。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `src/source-pane.ts`（新建） | 纯决策函数 `decidePaneAction` + 适配层 `SourcePaneController`。分屏的**唯一**状态持有者。 |
| `tests/source-pane.test.ts`（新建） | `decidePaneAction` 的单测。`SourcePaneController` 无法单测（要 mock 整个 Workspace），靠人工验证。 |
| `src/main.ts`（改） | 创建 controller、注入给视图工厂、`file-open` 豁免、注册命令 `open-source-pane`、`COMMAND_IDS` 加一项。 |
| `src/view.ts`（改） | 构造函数第三个参数收 controller；多一个 `addAction` 按钮。 |
| `src/i18n.ts`（改） | 新增 `command.openSourcePane` / `view.openSourcePane` 两条中英文案。 |
| `scripts/check-i18n.mjs`（改） | `SCAN_FILES` 加 `src/source-pane.ts`，否则新文件里的字符串字面量绕过门禁。 |
| `README.md` / `README.zh-CN.md`（改） | 「命令」一节加一条，含两条已知限制。 |
| `docs/MANUAL-VERIFICATION.md`（改） | 新增 §9e，九条人工用例。 |
| `AGENTS.md`（改） | §10 里 check:i18n 扫描范围那句话要同步；「设计文档」一节加本 spec 链接。 |

---

### Task 1: `decidePaneAction` 纯决策函数

这是本特性唯一能被自动化门禁真正覆盖的部分。它把「点一下按钮该发生什么」的全部判断（§5.1 复用、§5.2 三条失效判据、toggle 语义）收敛成一个不碰 Obsidian 的函数，`SourcePaneController` 退化成薄适配层。做法对齐仓库既有先例 `src/view/drag.ts` 的 `zoneFromOffset` —— 视图层文件导出一个纯决策函数，单独建测试文件测它。

**Files:**
- Create: `src/source-pane.ts`
- Test: `tests/source-pane.test.ts`

**Interfaces:**
- Consumes: 无（本任务不 import 任何东西）。
- Produces:
  ```ts
  export type PaneAction<T> =
    | { readonly kind: "close"; readonly leaf: T }
    | { readonly kind: "reveal"; readonly leaf: T }
    | { readonly kind: "create" };

  export interface PaneSnapshot<T> {
    readonly leaf: T;
    readonly path: string | null;
  }

  export function decidePaneAction<T>(
    markdownPanes: readonly PaneSnapshot<T>[],
    remembered: T | null,
    path: string,
  ): PaneAction<T>;
  ```
  Task 2 的 `SourcePaneController` 是它唯一的调用方。

- [ ] **Step 1: 写下失败的测试**

新建 `tests/source-pane.test.ts`。用字符串当 leaf，泛型 `T` 因此被实例化成 `string`——这正是把它做成泛型的目的：测试不需要 Obsidian。

```ts
import { describe, expect, it } from "vitest";
import { decidePaneAction, type PaneSnapshot } from "../src/source-pane";

/** 便于读的构造器：pane("a", "note.md") 表示 leaf "a" 正显示 note.md。 */
function pane(leaf: string, path: string | null): PaneSnapshot<string> {
  return { leaf, path };
}

describe("decidePaneAction", () => {
  it("没有配对、也没有任何面板显示该文件 → 新建分屏", () => {
    expect(decidePaneAction([], null, "note.md")).toEqual({ kind: "create" });
  });

  it("没有配对，但用户自己已经开着显示该文件的面板 → 复用它，不新开第三个", () => {
    const panes = [pane("other", "别的.md"), pane("mine", "note.md")];
    expect(decidePaneAction(panes, null, "note.md")).toEqual({
      kind: "reveal",
      leaf: "mine",
    });
  });

  it("有配对且它仍显示该文件 → 关掉它（按钮是 toggle）", () => {
    const panes = [pane("paired", "note.md")];
    expect(decidePaneAction(panes, "paired", "note.md")).toEqual({
      kind: "close",
      leaf: "paired",
    });
  });

  it("配对面板已被用户关掉（不在列表里）→ 新建，不报错", () => {
    expect(decidePaneAction([], "gone", "note.md")).toEqual({ kind: "create" });
  });

  it("配对面板被挪去开了别的文件 → 视为配对已断，新建", () => {
    const panes = [pane("paired", "别的.md")];
    expect(decidePaneAction(panes, "paired", "note.md")).toEqual({ kind: "create" });
  });

  it("配对面板被手动切成了导图视图（不再出现在 markdown 面板列表里），但另有面板显示该文件 → 复用那个，而不是关掉", () => {
    const panes = [pane("another", "note.md")];
    expect(decidePaneAction(panes, "flipped", "note.md")).toEqual({
      kind: "reveal",
      leaf: "another",
    });
  });

  it("多个面板显示该文件时，关掉的是配对的那个，不是列表里第一个", () => {
    const panes = [pane("first", "note.md"), pane("paired", "note.md")];
    expect(decidePaneAction(panes, "paired", "note.md")).toEqual({
      kind: "close",
      leaf: "paired",
    });
  });

  it("path 为 null 的面板（视图还没绑上文件）永不被选中", () => {
    const panes = [pane("blank", null)];
    expect(decidePaneAction(panes, null, "note.md")).toEqual({ kind: "create" });
    expect(decidePaneAction(panes, "blank", "note.md")).toEqual({ kind: "create" });
  });
});
```

- [ ] **Step 2: 跑测试，确认它以「模块不存在」失败**

```bash
npx vitest run tests/source-pane.test.ts
```

Expected: FAIL，报 `Failed to resolve import "../src/source-pane"`。

- [ ] **Step 3: 写最小实现**

新建 `src/source-pane.ts`。本任务只写纯函数部分，**不要** import `obsidian`。

```ts
/**
 * 源码分屏：把「点一下按钮该发生什么」的全部判断收在一个纯函数里，
 * `SourcePaneController` 只做 Obsidian API 的适配。
 *
 * 设计文档：docs/superpowers/specs/2026-09-12-source-split-design.md
 */

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
 * 蕴含**，这里不再单独判断。spec §5.2 的三条失效判据于是全部收敛成同一条：
 * 记忆中的配对面板还在不在「当前显示着 `path` 的 markdown 面板」这个集合里。
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
```

- [ ] **Step 4: 跑测试，确认全绿**

```bash
npx vitest run tests/source-pane.test.ts
```

Expected: PASS，8 个用例全过。

- [ ] **Step 5: 跑全套门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

Expected: 五条全绿。`check:purity` 不扫 `src/source-pane.ts`（它只管 `src/model/` 与两个指定文件），`check:i18n` 此刻也还没扫它——那是 Task 2 的事。

- [ ] **Step 6: 提交**

```bash
git add src/source-pane.ts tests/source-pane.test.ts
git commit -m "$(cat <<'EOF'
feat: 源码分屏的纯决策函数 decidePaneAction

把「点一下分屏按钮该发生什么」收敛成一个不碰 Obsidian 的纯函数：
已有配对且仍显示该文件就关掉（toggle），否则复用任一已显示该文件的
markdown 面板，都没有才新建分屏。

spec §5.2 的三条失效判据（面板已关闭 / 被挪去开别的文件 / 被切成导图
视图）在这里是同一条：记忆中的配对还在不在「当前显示该文件的 markdown
面板」集合里——前两条显然，第三条是因为切成导图后它不再属于
getLeavesOfType("markdown")。

泛型化是为了能单测，与 view/drag.ts 的 zoneFromOffset 同一套路。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `SourcePaneController` 适配层与文案

把纯函数接到 Obsidian 上。本任务结束时 controller 完整可用，但**还没有任何入口调用它**（那是 Task 4），所以界面上看不出变化——这是刻意的，让「适配层写得对不对」和「接线接得对不对」可以被分开评审。

**Files:**
- Modify: `src/source-pane.ts`（在 Task 1 的纯函数之上追加）
- Modify: `src/i18n.ts`
- Modify: `scripts/check-i18n.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 1 的 `decidePaneAction` / `PaneSnapshot` / `PaneAction`。
- Produces:
  ```ts
  export interface MindmapHost {
    readonly leaf: WorkspaceLeaf;
    readonly file: TFile | null;
  }

  export class SourcePaneController {
    constructor(app: App);
    toggle(host: MindmapHost): Promise<void>;
  }
  ```
  新的 i18n key：`"command.openSourcePane"`、`"view.openSourcePane"`。Task 4 会同时用到这两样。

- [ ] **Step 1: 加两条文案**

`src/i18n.ts`。**两张表都要加，且 key 顺序对齐现有风格**（中文表分区带注释，英文表不带注释但按同样顺序）。

中文表 `zh`，在 `"command.markAsMindmap"` 那行**之后**加：

```ts
  "command.openSourcePane": "并排打开源码面板",
```

中文表 `zh` 的「视图」分区，在 `"view.switchToSource"` 那行**之后**加：

```ts
  "view.openSourcePane": "并排打开源码",
```

英文表 `en`，在 `"command.markAsMindmap"` 之后加：

```ts
  "command.openSourcePane": "Open source pane side by side",
```

英文表 `en`，在 `"view.switchToSource"` 之后加：

```ts
  "view.openSourcePane": "Open source side by side",
```

不需要改 `tests/i18n.test.ts`：它已有的「两表 key 集合完全相同」与「没有空串值」两条会自动覆盖新 key，而漏译本身是编译错误（`en` 声明为 `Record<MessageKey, string>`）。

- [ ] **Step 2: 把新文件纳入 check:i18n 的扫描范围**

`scripts/check-i18n.mjs` 第 7 行：

```js
const SCAN_FILES = ["src/main.ts", "src/settings.ts", "src/view.ts"];
```

改成：

```js
const SCAN_FILES = ["src/main.ts", "src/settings.ts", "src/view.ts", "src/source-pane.ts"];
```

这是**收紧**而不是放宽扫描范围——AGENTS.md §10 禁止的是「放宽扫描范围或加豁免名单」。不加这一行，`src/source-pane.ts` 里任何写死的中文都能绕过门禁。

同步改 `AGENTS.md` §10 里那句枚举（原文：「`npm run check:i18n` 扫 `src/main.ts` / `src/settings.ts` / `src/view.ts` / `src/view/**` 的字符串字面量」），加上 `src/source-pane.ts`：

```
`npm run check:i18n` 扫 `src/main.ts` / `src/settings.ts` / `src/view.ts` / `src/source-pane.ts` / `src/view/**` 的字符串字面量
```

- [ ] **Step 3: 写 controller**

`src/source-pane.ts` 文件**顶部**加 import（放在文件开头的块注释之后、`PaneSnapshot` 之前）：

```ts
import { MarkdownView, type App, type TFile, type WorkspaceLeaf } from "obsidian";
```

文件**末尾**追加：

```ts
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
 * `file-open` 处理器与 spec §4.1），所以 `pairs` 丢了最多是「按钮以为没开过，
 * 再点一次会复用到已有面板」，不会让分屏坏掉。
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
        // 不新开第三个面板（spec §5.1）。
        this.pairs.set(host.leaf, action.leaf);
        await this.app.workspace.revealLeaf(action.leaf);
        return;
      case "create": {
        // before = true 是必需的：workspace.getLeaf("split") 默认往右开，
        // 那会得到「左导图 / 右源码」，与需求相反（spec §3.1）。
        const pane = this.app.workspace.createLeafBySplit(host.leaf, "vertical", true);
        await pane.openFile(file, { state: { mode: "source" } });
        this.pairs.set(host.leaf, pane);
        return;
      }
    }
  }

  /** 当前所有 markdown 面板各自显示着哪个文件。 */
  private snapshot(): PaneSnapshot<WorkspaceLeaf>[] {
    return this.app.workspace.getLeavesOfType("markdown").map((leaf) => ({
      leaf,
      path: leaf.view instanceof MarkdownView ? (leaf.view.file?.path ?? null) : null,
    }));
  }
}
```

- [ ] **Step 4: 跑门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

Expected: 五条全绿。特别确认 `check:i18n` 打印的扫描文件数比上一次多 1。

- [ ] **Step 5: 提交**

```bash
git add src/source-pane.ts src/i18n.ts scripts/check-i18n.mjs AGENTS.md
git commit -m "$(cat <<'EOF'
feat: 源码分屏的 SourcePaneController

把 decidePaneAction 接到 Obsidian 上：创建走
createLeafBySplit(leaf, "vertical", before=true) + openFile 的
state.mode = "source"，复用走 revealLeaf，关闭走 detach。
before=true 是必需的，getLeaf("split") 默认往右开会得到左导图右源码。

配对表用 WeakMap：WorkspaceLeaf 没有公开 id，拿 leaf 当键最直接，
也免掉关闭后从 Map 删除的泄漏面。它只服务于按钮的 toggle 语义，
不承担正确性——豁免规则不依赖它，见 spec §4.1。

host 用结构化接口而不是 import MindmapView，避免 view.ts 与
source-pane.ts 的运行时循环依赖（同 drag.ts 的 DragHost）。

check-i18n.mjs 的 SCAN_FILES 补上新文件，否则它里面写死的中文能绕过
门禁；AGENTS.md §10 的枚举同步。

本任务还没有任何入口调用 controller，界面上看不出变化。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `autoOpen` 自动翻转的无状态豁免

**这条豁免不是锦上添花，是整个特性能否成立的前提。** 不加它，Task 4 的按钮打开源码面板后，`openFile` 触发的 `file-open` 会立刻把那个面板翻成导图，结果是**左右两个导图**。

本任务独立于入口：它单独改变现有行为（同一文件已有导图面板时，其它 markdown 面板不再被自动翻转），可以被单独评审、单独接受或拒绝。

**Files:**
- Modify: `src/main.ts`（`onload` 里的 `file-open` 处理器，约 65–84 行）

**Interfaces:**
- Consumes: 已有的 `MINDMAP_VIEW_TYPE`、`MindmapView`（`src/main.ts` 顶部已经 import 了两者）。
- Produces: 无新导出。

- [ ] **Step 1: 插入豁免判断**

`src/main.ts` 的 `file-open` 处理器里，在 `if (frontmatter?.mindmap !== true) return;` 之后、取 `leaf` 的那段之前，插入：

```ts
        // 该文件已经在某个面板上以导图视图显示时，不再把显示它的 markdown
        // 面板翻成导图——那个面板是用户特意留的源码侧（源码分屏，spec §4.1）。
        //
        // 这条判据刻意**不**依赖 SourcePaneController 的内存配对表：Obsidian
        // 重启会恢复工作区布局（源码面板被恢复出来）但配对表是空的，依赖它
        // 会让分屏在每次重启后被翻掉。无状态规则在重启后依然成立。
        //
        // 已知代价：同一文件想开**两个**导图面板时，第二个会停在源码模式，
        // 需要手动切一次。这个场景罕见，换「重启后不坏」是划算的。
        const alreadyOpenAsMindmap = this.app.workspace
          .getLeavesOfType(MINDMAP_VIEW_TYPE)
          .some(
            (candidate) =>
              candidate.view instanceof MindmapView && candidate.view.file?.path === file.path,
          );
        if (alreadyOpenAsMindmap) return;
```

用 `instanceof` 而不是 `as MindmapView`：与同一个处理器下面那段对 `MarkdownView` 的写法保持一致，也避免 view 不是导图时读到 `undefined.path`。

**不要动 `this.flipping`。** 它防的是 `file-open` 递归，与本条无关；两条守卫各管各的——`flipping` 管「翻转过程中不要再翻」，这一条管「这个文件不该被翻」。

- [ ] **Step 2: 跑门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

Expected: 五条全绿。门禁**看不到**这条规则的任何行为，它只能保证代码编译得过——真正的验证在 Task 5 的人工清单第 1、2 条。

- [ ] **Step 3: 提交**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat: 文件已有导图面板时不再自动翻转其它 markdown 面板

源码分屏的前提。不加这条，分屏打开的源码面板会被 file-open 立刻翻成
导图，结果是左右两个导图。

判据刻意无状态（「该文件此刻是否已在某个 leaf 上以导图视图显示」），
不依赖 SourcePaneController 的内存配对表：Obsidian 重启会恢复工作区
布局但配对表是空的，依赖它会让分屏在每次重启后被翻掉。

代价是同一文件想开两个导图面板时第二个会停在源码，需要手动切一次。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 接线入口 —— 标题栏按钮与命令

**Files:**
- Modify: `src/main.ts`（字段、`onload`、`registerView`、`COMMAND_IDS`、`registerCommands`）
- Modify: `src/view.ts`（import、构造函数）

**Interfaces:**
- Consumes: Task 2 的 `SourcePaneController` / `MindmapHost`、i18n key `command.openSourcePane` 与 `view.openSourcePane`。
- Produces: 无新导出。`MindmapView` 的构造签名变成三参：`(leaf, settings, sourcePane)`。

- [ ] **Step 1: `main.ts` 创建并注入 controller**

顶部 import 加上 `Platform` 与 controller：

```ts
import { getLanguage, MarkdownView, Notice, Platform, Plugin, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
```

```ts
import { SourcePaneController } from "./source-pane";
```

类字段（放在 `flipping` 旁边）：

```ts
  /** 源码分屏的开关。`onload` 里第一件事就赋值，早于任何可能用到它的注册。 */
  private sourcePane!: SourcePaneController;
```

`onload()` 里 `await this.loadSettings();` 之后、`setLocale(...)` 之前加：

```ts
    this.sourcePane = new SourcePaneController(this.app);
```

`registerView` 的工厂多传一个参数：

```ts
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, () => this.settings, this.sourcePane),
```

- [ ] **Step 2: `main.ts` 注册命令**

`COMMAND_IDS` 加一项——**id 必须与 `addCommand` 逐字一致**，写错会表现为命令重复出现或直接消失，五条门禁都看不到（AGENTS.md §10）：

```ts
  private static readonly COMMAND_IDS = [
    "toggle-mindmap-view",
    "mark-as-mindmap",
    "open-source-pane",
  ] as const;
```

上面那段 JSDoc 里的「注册两个命令」改成「注册三个命令」。

`registerCommands()` 末尾（`mark-as-mindmap` 之后）加：

```ts
    this.addCommand({
      id: "open-source-pane",
      name: t("command.openSourcePane"),
      checkCallback: (checking: boolean) => {
        // 手机上左右分屏没有意义，入口整体不提供（spec §5.4）。
        if (Platform.isMobile) return false;
        const view = this.app.workspace.getActiveViewOfType(MindmapView);
        if (view === null || view.file === null) return false;
        if (checking) return true;
        void this.sourcePane.toggle(view);
        return true;
      },
    });
```

这里用 `getActiveViewOfType(MindmapView)` 而不是像 `toggle-mindmap-view` 那样兼顾 `MarkdownView`：这条命令只在导图视图里有意义，源码侧不需要它。

- [ ] **Step 3: `view.ts` 加按钮**

顶部 import 加 `Platform`：

```ts
import { Notice, Platform, TextFileView, TFile, type WorkspaceLeaf } from "obsidian";
```

加 controller 的**类型** import（与 `MindmapSettings` 同样的理由，放在它旁边）：

```ts
import type { SourcePaneController } from "./source-pane";
```

构造函数改成：

```ts
  constructor(
    leaf: WorkspaceLeaf,
    private readonly settings: () => MindmapSettings,
    private readonly sourcePane: SourcePaneController,
  ) {
    super(leaf);
    this.root = el("div", "mindmap-view", this.contentEl);
    // 视图标题栏右上角的动作按钮（与 Obsidian 自带视图的图标按钮同一位置）。
    // 命令面板里的「切换思维导图 / 源码视图」仍然可用，这是它的鼠标入口。
    this.addAction("file-text", t("view.switchToSource"), () => this.switchToSource());
    // 源码分屏。`this` 满足 MindmapHost（leaf 来自 View，file 来自 FileView）。
    // 手机上左右分屏没有意义，按钮整体不出现（spec §5.4）。
    if (!Platform.isMobile) {
      this.addAction("panel-left", t("view.openSourcePane"), () => void this.sourcePane.toggle(this));
    }
  }
```

**关于图标名**：`panel-left` 来自 Obsidian 捆绑的 lucide 集合。若这个 Obsidian 版本里没有它，按钮会渲染成**空白方块**而不是报错——仓库历史上 `sticky-note` 就踩过这个坑（见 `docs/MANUAL-VERIFICATION.md` §9d 第 7 条）。人工验证第 1 条要专门看这个；真的空白就换成 `layout`。**五条门禁看不到图标缺失。**

- [ ] **Step 4: 跑门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

Expected: 五条全绿。`typecheck` 会同时证明 `MindmapView` 满足 `MindmapHost`（`toggle(this)` 传得进去）。

- [ ] **Step 5: 在真实 Obsidian 里冒烟一次**

把 `main.js` / `manifest.json` / `styles.css` 装进测试 vault（`test-vault/`），打开一个 `mindmap: true` 的文件：

- [ ] 标题栏出现两个图标按钮，第二个不是空白方块。
- [ ] 点它 → 左源码、右导图，**左侧保持源码模式没有被翻回导图**。
- [ ] 再点一次 → 源码面板关闭。

三条里任何一条不过，**先修再提交**——完整的人工清单在 Task 5，这里只是不把明显坏掉的东西提交上去。

- [ ] **Step 6: 提交**

```bash
git add src/main.ts src/view.ts
git commit -m "$(cat <<'EOF'
feat: 源码分屏的入口（标题栏按钮 + 命令）

导图视图标题栏多一个按钮，与「切换到源码模式」并列；命令面板多一条
open-source-pane（id 已同步进 COMMAND_IDS，换语言时要靠它重注册）。
两个入口都走 SourcePaneController.toggle，再点一次关闭。

controller 以构造参数注入，与 settings 的 getter 注入同一套路，view.ts
因此仍然不在运行时 import main.ts。Platform.isMobile 时按钮与命令都
不提供。

图标 panel-left 若在某个 Obsidian 版本的 lucide 集合里缺失会渲染成空白
方块而不报错（sticky-note 踩过），只能人工验。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 文档与人工验证清单

代码到此为止已完整。本任务把这个特性和它的两条已知限制写进用户能看到的地方，并补上回归清单——尤其是 §4.1 那条「重启后分屏是否还在」的回归点。

**Files:**
- Modify: `README.zh-CN.md`（「命令」一节，约 249–253 行）
- Modify: `README.md`（「Commands」一节，约 248–252 行）
- Modify: `docs/MANUAL-VERIFICATION.md`（新增 §9e）
- Modify: `AGENTS.md`（「设计文档」一节）

**Interfaces:** 无代码改动。

- [ ] **Step 1: 中文 README**

`README.zh-CN.md` 的「## 命令」一节，在「**切换思维导图 / 源码视图**」那条**之后**插入：

```markdown
- **并排打开源码面板** —— 导图视图右上角标题栏也有对应的图标按钮。在左侧新开一个面板、以源码模式显示同一个文件，再点一次关闭；已经有面板在显示该文件时复用它，不新开第三个。两侧都可以编辑，内容的同步完全由 Obsidian 负责（两个视图读写同一个文件），插件不搬运任何文本。两点已知限制：**左侧打字后右侧导图约 2 秒才跟上**（那是 Obsidian 编辑器自己的保存节奏，导图侧写回则是 400ms）；**同一时刻只在一侧编辑**——两侧同时改会触发 Obsidian 自己的冲突合并，行为不由本插件控制。移动端不提供这个入口。
```

同一节「**标记为思维导图**」那条之后，另起一段说明豁免规则带来的行为变化：

```markdown
开启「自动以思维导图打开」时，一个文件**已经**在某个面板上以导图视图显示后，其它显示同一文件的面板不会再被自动翻成导图——源码分屏正是靠这条规则活下来的。代价是同一个文件想开两个导图面板时，第二个会停在源码模式，用上面的「切换思维导图 / 源码视图」手动切一次即可。
```

- [ ] **Step 2: 英文 README**

`README.md` 的「## Commands」一节，在「**Toggle mindmap / source view**」那条之后插入：

```markdown
- **Open source pane side by side** — the mindmap view header has a matching icon button. Opens the same file in source mode in a new pane to the left; click again to close it. If a pane is already showing that file it is reused rather than opening a third one. Both sides are editable and Obsidian handles the syncing (both views read and write the same file) — the plugin moves no text of its own. Two known limits: **typing on the left takes about 2 seconds to reach the map on the right** (that is Obsidian's own editor save debounce; the map writes back after 400ms), and **edit one side at a time** — editing both at once runs into Obsidian's own conflict merge, which this plugin does not control. The entry point is hidden on mobile.
```

「**Mark as mindmap**」那条之后：

```markdown
With auto-open enabled, once a file is **already** showing in mindmap view in some pane, other panes showing the same file are no longer flipped automatically — this is the rule that keeps the source split alive. The cost: opening the same file as a mindmap in a second pane leaves that pane in source mode; use **Toggle mindmap / source view** to switch it by hand.
```

- [ ] **Step 3: 人工验证清单**

`docs/MANUAL-VERIFICATION.md`，在「## 9d. 节点备注」一节**之后**、「## 附：高价值项速查」之前，加一节：

```markdown
## 9e. 源码分屏（左源码 / 右导图）

这个特性 100% 在视图层与工作区层，**五条门禁看不到它的任何行为**，
只有 `decidePaneAction` 的 8 个单测覆盖了「点一下该做什么」的判断。
分屏是否真的开出来、开在哪一侧、重启后还在不在，全部只能人工验。

1. 打开一个 `mindmap: true` 的文件，标题栏右上角应有两个图标按钮。
   - [ ] 第二个按钮**不是空白方块**（图标名 `panel-left`；若这个 Obsidian
         版本的 lucide 集合里没有它会渲染成空白，换成 `layout`）。
2. 点第二个按钮。
   - [ ] 左侧出现源码面板、右侧仍是导图（**不是反过来**）。
   - [ ] 左侧**保持源码模式**，没有被「自动以思维导图打开」翻成导图。
         这是本特性最关键的一条，翻了就是左右两个导图。
3. **重启 Obsidian**（完全退出再打开，不是禁用/启用插件）。
   - [ ] 恢复出来的布局仍是左源码、右导图，左侧没有被翻转。
         这是无状态豁免规则的回归点，也是它当初被这样设计的原因——
         依赖内存配对表的写法在这一步必然失败。
4. 再点一次那个按钮。
   - [ ] 源码面板关闭，导图面板留在原地。
5. 在左侧源码里改一行文字，等一会儿。
   - [ ] 约 2 秒后右侧导图更新（这是 Obsidian 的保存节奏，不是缺陷）。
   - [ ] 更新时**视口与选中不跳动**（相机不回到「适应窗口」、选中的节点
         仍然选中）。
6. 在右侧导图上拖一个节点。
   - [ ] 左侧源码随之更新（约 400ms）。
7. 手动关掉源码面板（点面板的关闭按钮），再点导图标题栏的按钮。
   - [ ] 能重新开出来，不会因为配对表里的死引用而失效或报错。
8. 点按钮开出源码面板，然后在那个面板里改去打开**另一个**文件，再点导图
   标题栏的按钮。
   - [ ] 新开一个源码面板，不会错误地把那个已经在看别的文件的面板关掉。
9. 点按钮开出源码面板，然后把**源码面板**手动切成导图视图，再点原导图
   标题栏的按钮。
   - [ ] 不报错；行为是「新开一个源码面板」或「复用另一个正显示该文件的
         markdown 面板」，不是关掉那个已经变成导图的面板。
10. 先不点按钮，自己用 Obsidian 原生分屏把同一个文件开成一个 markdown
    面板，再点导图标题栏的按钮。
    - [ ] **复用**那个已有面板并聚焦过去，不新开第三个面板。
11. 在手机端（或任何 `Platform.isMobile` 为真的环境）打开导图。
    - [ ] 标题栏没有这个按钮，命令面板里也搜不到「并排打开源码面板」。
12. 点按钮开出源码面板，然后关掉**导图**那一侧的面板。
    - [ ] 源码面板**留在原地**，不被连带关闭（spec §5.3：关闭用户的面板是
          不可逆动作，不该由插件替他做）。
13. 设置 → Rich Mindmap → 界面语言切到 English，再切回简体中文。
    - [ ] 命令面板里「并排打开源码面板」的名字跟着变（它的 id 必须在
          `COMMAND_IDS` 里，否则会重复出现或直接消失）。
    - [ ] 标题栏按钮的 tooltip **不会**跟着变——`addAction` 在构造函数里
          求值，`refreshLocale()` 不重建它。这与既有的「切换到源码模式」
          按钮行为一致，是已知限制，不要报告。
```

- [ ] **Step 4: AGENTS.md 的设计文档索引**

「## 设计文档」一节的列表加一条：

```markdown
- 源码 / 导图左右分屏：[docs/superpowers/specs/2026-09-12-source-split-design.md](docs/superpowers/specs/2026-09-12-source-split-design.md)，§4.1 解释了自动翻转的豁免为什么必须无状态
```

- [ ] **Step 5: 跑门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

Expected: 五条全绿（本任务只改文档，但仍要确认没有手滑）。

- [ ] **Step 6: 提交**

```bash
git add README.md README.zh-CN.md docs/MANUAL-VERIFICATION.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: 源码分屏的说明与人工验证清单

两份 README 的「命令」一节加入并排打开源码面板，连同它的两条已知限制
（左→右约 2 秒、同一时刻只在一侧编辑），并说明自动翻转豁免带来的行为
变化：同一文件的第二个面板不再被自动翻成导图。

MANUAL-VERIFICATION 新增 §9e 共 13 条，其中第 3 条「重启 Obsidian 后
分屏仍在、左侧仍是源码」是无状态豁免规则的回归点。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完成后的报告要求

按 AGENTS.md「自动化测不到什么」，实现完成的报告必须明确区分：

- **机械验证过的**：五条门禁、`decidePaneAction` 的 8 个单测。
- **需人在真实 Obsidian 里确认的**：`docs/MANUAL-VERIFICATION.md` §9e 的全部 13 条。

**不得声称视觉或交互行为正确。** 图标是否渲染、分屏开在哪一侧、重启后是否还在，门禁一条都看不到。
