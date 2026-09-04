# 文件夹右键菜单「新建思维导图」— 设计文档

日期：2026-09-04

## 1. 目标

用户在文件浏览器里右键任意文件夹，菜单中出现「新建思维导图」。点击后插件在该文件夹下创建一个新的 `.md` 文件，写入初始内容，并立刻在当前面板用思维导图视图打开。用户落地时看到一个只有根节点的画布，按 Tab 即可开始添加子节点。

## 2. 非目标

- 不加命令面板命令、不加 ribbon 图标、不加设置项。
- 不提供文件名输入框：沿用 Obsidian「新建笔记」的做法，先用默认名创建，用户之后自行重命名。
- 不改动解析器 / 序列化器 / 写回归一化规则。

## 3. 行为

### 3.1 入口

复用 `main.ts` 里已经注册的 `workspace.on("file-menu")` 事件处理器。现有分支只处理 `TFile`；新增一个 `TFolder` 分支，添加菜单项「新建思维导图」，图标沿用 `git-fork`。

### 3.2 文件位置与命名

- 位置：被右键的文件夹本身。库根目录（`folder.path === "/"`）下创建时路径不带前缀。
- 文件名：`未命名思维导图.md`。若已存在，依次尝试 `未命名思维导图 1.md`、`未命名思维导图 2.md`……直到找到不存在的名字。与 Obsidian 自带「未命名 1」规则一致。
- 存在性判断通过 `vault.getAbstractFileByPath` 完成，由纯函数层以回调形式接收。

### 3.3 初始内容

```markdown
---
mindmap: true
---

# 未命名思维导图
```

- frontmatter 通过现有的 `setMindmapFlag(null, true)` 生成，保证与「标记为思维导图」命令写出的内容一致，之后每次打开都自动进入导图视图（受设置项「自动以思维导图打开」控制）。
- 一级标题文字与文件名（去掉 `.md`）一致。**写入 H1 是有意为之**：解析器在文件没有 H1 时用文件名当根节点文字，且序列化时不写标题行，根节点的文字改动因此不会落盘。带上 H1 后用户双击根节点即可改名并保存。代价是之后重命名文件不会同步改根节点文字，这与仓库示例文件 `工作内容.md` 的形态一致。
- 文件末尾带换行，符合写回归一化第 1 条，导图视图打开后不做任何改动再切走时不会产生 diff。

### 3.4 打开方式

与现有文件右键菜单「以思维导图打开」相同：`workspace.getLeaf(false)` 取当前面板，`setViewState({ type: MINDMAP_VIEW_TYPE, state: { file }, active: true })`。

### 3.5 错误处理

`vault.create` 失败（权限、同名竞争等）时用 `Notice` 提示「新建思维导图失败：<原因>」，不打开视图。

## 4. 代码落点

| 文件 | 改动 |
| --- | --- |
| `src/model/new-file.ts` | 新增。两个纯函数：`uniqueMindmapPath(folderPath, exists)` 计算不重复的文件路径；`newMindmapContent(title)` 生成初始内容。不 import `obsidian`，受 `check:purity` 覆盖。 |
| `tests/new-file.test.ts` | 新增。覆盖根目录 / 子目录路径拼接、去重编号、初始内容能被 `parse` 解析出正确根节点且 round-trip 恒等。 |
| `src/main.ts` | `file-menu` 处理器加 `TFolder` 分支，新增 `createMindmapInFolder(folder)` 私有方法串起「算路径 → `vault.create` → `setViewState`」。 |
| `README.md` / `README.zh-CN.md` | 「命令」一节补一条右键菜单说明。 |
| `docs/MANUAL-VERIFICATION.md` | 加一条人工验证项。 |

## 5. 测试

- 纯函数层单测见上表。
- 视图层按项目惯例无自动化测试；「菜单项出现、文件被创建、导图视图打开、Tab 能加子节点」需要在真实 Obsidian 里人工确认。
