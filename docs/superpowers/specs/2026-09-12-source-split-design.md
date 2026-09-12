# 源码 / 导图左右分屏 — 设计文档

日期：2026-09-12

## 1. 目标

在导图视图里加一个入口（标题栏按钮 + 命令），一键把**同一个文件**在左侧以 Markdown 源码模式、右侧以导图视图并排打开，两侧都可编辑、内容双向保持一致。

直接动机是用户反馈：想一边看源码一边看导图。今天要达成这个效果，用户得手动分屏、手动在左侧打开文件、再手动把被自动翻转成导图的左侧面板切回源码——第三步还会被 `autoOpen` 反复翻回去（见 4.1）。

## 2. 非目标

- **不自己搬运文本。** 两侧内容的同步完全交给 Obsidian：两个视图读写同一个 vault 文件，Obsidian 自带回声抑制与冲突合并。插件不监听 `editor-change`、不做跨 leaf 的内存同步。代价是左→右约 2 秒延迟，见 6.1。
- **不做「选中节点 ↔ 源码行」的光标联动。** 那需要给 `MindNode` 加行号、`parse` 与 `serialize` 两边都改，会动到纯函数层及其测试。本次不做。
- **不在导图视图内部自建分栏。** 不在 `MindmapView` 里嵌 CodeMirror 实例——那意味着重建一个没有补全、没有双链、没有原生快捷键的编辑器，或依赖未公开的内部 API，且要接管保存路径，与 AGENTS.md 第 5 条正面冲突。分屏由两个 leaf 承载。
- **不做移动端。** 手机上左右分屏没有意义，入口在移动端隐藏，见 5.4。
- **不加设置项。** 没有「打开导图文件时自动分屏」的开关；完全手动触发。

## 3. 架构

新增 `src/source-pane.ts`，把「分屏这件事」收在一个模块里：

```
SourcePaneController（插件级单例，onload 时创建）
  ├─ pairs: WeakMap<WorkspaceLeaf /* 导图 leaf */, WorkspaceLeaf /* 源码 leaf */>
  ├─ toggle(view)   有配对面板就关，没有就开
  ├─ open(view)     复用已有面板，否则 createLeafBySplit 新建
  └─ close(view)    detach 配对面板，解除配对
```

`pairs` 用 `WeakMap` 而不是 `Map`：`WorkspaceLeaf` 没有公开的 `id` 字段（`obsidian.d.ts` 只暴露 `parent` 与 `view`），拿 leaf 对象本身当键最直接，顺带免掉「leaf 关闭后要记得从 Map 里删」的泄漏面。所有查询都是「给定导图 leaf 找源码 leaf」，不需要遍历。

`pairs` **只服务于按钮的开/关语义，不承担正确性**。它是内存态，Obsidian 重启后必然为空；豁免规则被刻意设计成不依赖它（见 4.1），所以丢了 `pairs` 最多是「按钮以为没开过，再点一次会复用到已有面板」，不会让分屏坏掉。

`src/model/`、`src/view/layout.ts`、`src/view/camera.ts` 一行不动，`npm run check:purity` 的边界不受影响。

### 3.1 打开分屏

```ts
const pane = app.workspace.createLeafBySplit(view.leaf, "vertical", true);
await pane.openFile(file, { state: { mode: "source" } });
```

`createLeafBySplit(leaf, direction, before)` 与 `OpenViewState.state` 都是 `obsidian.d.ts` 里的公开签名（8029 行一带）。`before = true` 是必需的：`workspace.getLeaf("split")` 默认往**右**开，那会得到「左导图 / 右源码」，与需求相反。

### 3.2 接线点

| 文件 | 改动 |
| --- | --- |
| `src/main.ts` | `onload` 里创建 controller；`file-open` 处理器加豁免判断；注册命令 `open-source-pane` |
| `src/view.ts` | 构造函数里多一个 `addAction(...)`；controller 由第三个构造参数注入 |
| `src/i18n.ts` | 新增 `command.openSourcePane` / `view.openSourcePane` 两条中英文案 |

controller 走构造参数注入，与现有的 `settings` getter 注入同一个套路——`view.ts` 因此仍然不在**运行时** import `main.ts`，不产生循环依赖（见 `view.ts` 顶部关于 `import type` 的注释）。

## 4. 与 autoOpen 的冲突

### 4.1 豁免规则必须是无状态的

`pane.openFile()` 会触发 `file-open`，而 `main.ts:65` 的自动打开逻辑会遍历所有 markdown leaf、找到显示该文件的那个、把它翻成导图视图。不加处理的结果是**左右两个导图**——按钮直接失效。所以豁免不是锦上添花，是本特性能否成立的前提。

豁免规则：

> `file-open` 时，若该文件**已经**在某个 leaf 上以 `MINDMAP_VIEW_TYPE` 显示，就不再自动翻转显示它的 markdown leaf。

即在现有的 `getLeavesOfType("markdown").find(...)` 之前加一条早退：

```ts
const alreadyOpenAsMindmap = this.app.workspace
  .getLeavesOfType(MINDMAP_VIEW_TYPE)
  .some((leaf) => leaf.view instanceof MindmapView && leaf.view.file?.path === file.path);
if (alreadyOpenAsMindmap) return;
```

**为什么不用 `pairs` 里的 leaf 集合做豁免**：`pairs` 是内存态，Obsidian 重启时会恢复工作区布局（源码面板被恢复出来）但 `pairs` 是空的，于是恢复出来的源码面板不再被豁免，`autoOpen` 当场把它翻成导图——**分屏在每次重启后都会坏掉**。无状态规则在重启后依然成立，且语义更准：已经有导图在看这个文件了，那个 markdown 面板就是用户特意留的源码侧。

已知代价：同一文件想开**两个**导图面板时，第二个会停在源码模式，需要手动切一次。这个场景罕见，换「重启后不坏」是划算的。

### 4.2 与 `flipping` 集合的关系

`main.ts` 现有的 `flipping: Set<string>` 是防 `file-open` 递归的，与本特性无关，不动。两条守卫各管各的：`flipping` 管「翻转过程中不要再翻」，4.1 的规则管「这个文件不该被翻」。

## 5. 边界情况

### 5.1 已有该文件的 markdown 面板

`open()` 先在 `getLeavesOfType("markdown")` 里找 `view.file?.path === file.path` 的面板；找到就 `revealLeaf(it)` 并登记配对，**不新开第三个面板**。

### 5.2 配对面板失效

每次用 `pairs` 里的 leaf 之前都要校验，任一条不成立即视为配对已断、从 `pairs` 移除：

- leaf 已被用户关掉 —— 用 `getLeavesOfType("markdown").includes(pane)` 判断，不读私有字段。
- leaf 被挪去开了别的文件 —— `pane.view.file?.path !== file.path`。
- leaf 被用户手动切成了导图视图 —— 它不再出现在 `getLeavesOfType("markdown")` 里，与第一条同一判据。

### 5.3 导图侧消失

导图 leaf 被关闭、或用户点「切换到源码模式」把它切走时，**不连带关闭源码面板**，只解除配对。关闭用户的面板是不可逆动作，不该由插件替他做。

### 5.4 移动端

`Platform.isMobile` 为真时不注册按钮、命令的 `checkCallback` 返回 false。`manifest.json` 是 `isDesktopOnly: false`，插件其余部分在手机上正常工作，只是这个入口不出现。

### 5.5 命令可用性

命令 `open-source-pane` 用 `checkCallback`，仅当当前 leaf 是 `MINDMAP_VIEW_TYPE` 且持有文件时可用，与现有 `toggle-mindmap-view` 的写法保持一致。

## 6. 已知限制（写入 README 的「已知限制」一节）

### 6.1 左→右约 2 秒

在左侧打字后，Obsidian 的编辑器保存是 2 秒防抖（`obsidian.d.ts` 对 `requestSave` 的注释），落盘后才由 `TextFileView` 基类的 `vault.on("modify")` 喂给导图视图。右→左快得多：导图侧是 400ms 防抖（`view.ts` 的 `SAVE_DEBOUNCE_MS`）。这是刻意接受的代价，换取「插件不自己搬运文本」。

### 6.2 两侧同时编辑会触发 Obsidian 的冲突合并

两个视图持有同一个文件，同一时刻在两侧都改，合并行为由 Obsidian 决定，不由本插件控制。文档里建议同一时刻只在一侧编辑。

一个具体表现：导图侧提交编辑后 400ms 写盘，此时若左侧编辑器有未保存的改动，Obsidian 会走它自己的合并路径。插件**刻意不调用 `requestSave()`**（AGENTS.md 第 5 条），因此不参与这个合并。

### 6.3 左侧改出无法解析的内容

右侧显示现有的错误提示卡片，`doc` 保持 null、`getViewData()` 原样返回未触碰的内容，文件不会被写回。这是既有行为，分屏下不需要额外处理。

## 7. 验证

本特性 100% 落在视图层与工作区层。四条门禁（typecheck / test / build / check:purity）**看不到它的任何行为**，只能保证不编译错、不越界。`check:i18n` 能保证新增文案没写死中文。

`docs/MANUAL-VERIFICATION.md` 追加一组人工用例，至少覆盖：

1. 点按钮 → 左源码右导图，左侧**保持**源码模式不被翻转（4.1 的主路径）。
2. **重启 Obsidian 后**，恢复出来的分屏仍是左源码右导图（4.1 的回归点，也是这次设计改动的直接原因）。
3. 再点按钮 → 源码面板关闭。
4. 左侧改文本 → 约 2 秒后右侧导图更新，且**视口与选中不跳动**（`setViewData` 的 `clear === false` 分支已有的承诺）。
5. 右侧拖节点 → 左侧源码更新。
6. 手动关掉源码面板后再点按钮 → 能重新开出来，不会因为 `pairs` 里的死引用而失效（5.2）。
7. 手动把源码面板挪去开别的文件后再点按钮 → 新开一个，不会错误复用（5.2）。
8. 关掉导图面板 → 源码面板留在原地（5.3）。
9. 移动端（或 `Platform.isMobile` 模拟）→ 按钮与命令都不出现（5.4）。

按 AGENTS.md「自动化测不到什么」，实现完成后的报告里必须把以上九条标为「需人在真实 Obsidian 里确认」，不得声称视觉或交互行为正确。
