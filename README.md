# Rich Mindmap

把 Markdown 的缩进列表渲染成可编辑的思维导图，支持优先级、进度、旗帜标记。
原始数据始终是普通 `.md` 文件 —— 你和 AI 读写的是同一份、结构清晰的 Markdown。

<!-- 截图放这里：一张导图视图的截图（建议同时给亮色与暗色主题各一张）。
     插件是视觉工具，README 没有截图会显著降低别人试用的意愿。 -->

## 与其他思维导图插件的区别

Obsidian 社区里的思维导图插件大致分两类：一类是基于 [markmap](https://markmap.js.org/) 的**只读预览**（把笔记渲染成导图但不能在导图上编辑），另一类建在 Obsidian Canvas 上、数据是 `.canvas` JSON。

这个插件的取向是：

- **可以直接在导图上编辑**，而数据仍然是普通 Markdown 缩进列表 —— 没有自有格式、没有坐标、没有 JSON
- **支持优先级 / 进度 / 旗帜标记**，写在节点文字里，人和 AI 都能直接读写
- **有明确的文件安全边界**：只允许五条字节级归一化（见下），由往返属性测试锁定

可编辑这一点并非独有（社区里另有几个插件也做到了）；标记系统目前是这一类插件里少见的。

## 安装

插件还没有提交到 Obsidian 社区插件市场，需要手动安装。

**方式一：从 Releases 下载**（如果已发布 release）

下载 `main.js`、`manifest.json`、`styles.css` 三个文件，放进 vault 的 `.obsidian/plugins/rich-mindmap/` 目录，然后在 设置 → 社区插件 里启用「Rich Mindmap」。

**方式二：从源码构建**

```bash
git clone https://github.com/YounianC/obsidian-rich-mindmap.git
cd obsidian-rich-mindmap
npm install
npm run build          # 生成 main.js
```

然后把 `main.js`、`manifest.json`、`styles.css` 拷贝（或软链）到 `<你的 vault>/.obsidian/plugins/rich-mindmap/`。

> `main.js` 是构建产物，不在版本库里 —— 需要自己 `npm run build` 或从 release 获取。

## 数据格式

一级标题是根节点，之后第一段连续的无序列表就是导图树：

```markdown
---
mindmap: true
---

# 工作内容

- 呼叫中心
  - (p1) 管理向
    - 任务安排
  - 业务向
    - (p3 30%) 部分开发自测
- WP
  - (flag:red) 理解业务流程
```

### 行内标记

节点文字最前面的一个括号组，当组内每个 token 都是已知标记时才生效：

| 写法 | 含义 |
|---|---|
| `p1` … `p7` | 优先级（p1 红、p2 橙、p3 黄、p4+ 灰） |
| `0%` … `100%` | 进度（映射到 7 档饼图，原值保留不被改写） |
| `flag:red` `flag:orange` `flag:yellow` `flag:green` `flag:blue` `flag:purple` `flag:gray` | 旗帜 |

组合写在一起：`- (p1 60% flag:blue) 节点文字`

括号里出现未知 token 时整组按普通文字处理，例如 `- (备注) 说明` 不会被当成标记。

### 与 AI 协同

插件不内置 AI 调用。让任意 AI 直接编辑这个 `.md` 文件即可 —— 新增节点只需写一行普通列表项，不涉及 id、坐标或 JSON。文件在磁盘上变化后画布会自动重新解析并刷新，视口与选中保持不动；如果此时画布上还有一次没来得及落盘的本地修改，会被外部内容覆盖，并弹出提示告知。

列表块之外的内容（frontmatter 其他键、前言、代码块、尾部段落）永不被插件改写。

### 写回归一化

只要用导图视图打开过一个文件，即使不做任何修改再切回源码模式，Obsidian 也可能把它重写一次。这次重写会带来以下五种、且仅有这五种字节级变化：

- 不以换行结尾的文件会被补上一个尾换行；
- 松散列表（列表项之间夹着空行）会被压缩成紧凑列表；
- `CRLF`（`\r\n`）统一转换为 `LF`（`\n`）；
- 列表缩进单位遵循文件原有的选择（2 空格、4 空格、Tab 等均原样保留）；只有当同一份文件里缩进单位混用、无法归纳出单一一致单位时，才会统一改写为每层 2 空格；
- 行内标记统一按 优先级 → 进度 → 旗帜 的顺序写出（`(flag:blue 60% p3)` → `(p3 60% flag:blue)`）。

除此之外，任意合法 Markdown 逐字节不变 —— 包括 `*` / `+` 列表标记（不会被改成 `-`）、标题行里的多余空格、frontmatter 结束围栏后的尾随空白，以及列表块之外的一切内容。

### 解析失败

如果文件内容无法被解析成思维导图（例如 frontmatter 或列表结构本身有问题），画布会显示一张错误提示卡片，并提供「切换到源码模式」按钮回到原始文本；这种情况下文件不会被插件写回或修改。

## 快捷键

| 按键 | 行为 |
|---|---|
| `Tab` | 添加子节点 |
| `Enter` | 添加兄弟节点 |
| `F2` / 双击 | 编辑文字 |
| `Delete` / `Backspace` | 删除节点及子树 |
| 方向键 | 在树中移动选中 |
| `Space` | 折叠 / 展开 |
| `Esc` | 取消编辑 / 取消选中 |
| `Cmd/Ctrl + 滚轮` | 缩放 |
| 空白处拖拽 | 平移 |

拖拽节点可改变父节点与同层顺序。

## 工具栏

选中一个节点后，画布上会出现一个贴着该节点的浮动工具栏，提供键盘之外的操作：加粗 / 斜体 / 删除线、标记面板（优先级、进度、旗帜，点选已生效项即取消）、插入 `[[链接]]`，以及添加子/兄弟节点、删除、折叠/展开的按钮版本。

## 命令

- **切换思维导图 / 源码视图**
- **标记为思维导图（写入 frontmatter）** —— 写入 `mindmap: true`，之后打开该文件自动进入导图视图（可在设置中关闭）；对没有 frontmatter 的文件执行会新建一个 frontmatter 块。执行这条命令会把整个文件的换行符统一成 `LF`（即上面「写回归一化」里的 `CRLF` 那条），正文的可见内容不受影响。

## 开发

```bash
npm install
npm run dev        # esbuild watch
npm test           # vitest
npm run typecheck
npm run check:purity
```

`src/model/`（`collapse-state.ts`、`marks.ts`、`parser.ts`、`serializer.ts`、`tree-ops.ts`、`types.ts`）与 `src/view/layout.ts`、`src/view/camera.ts` 是纯函数层，不依赖 Obsidian API 与 DOM，由 `npm run check:purity` 强制校验，全部有单元测试覆盖。

## 项目状态

版本 `0.1.0`，自用阶段。

- **界面文字目前只有中文**（命令名、按钮提示、设置项、错误提示）。尚未做 i18n。
- 纯函数层（解析、序列化、标记、折叠状态、树操作、布局、相机）有 194 个自动化测试，含 Markdown 往返属性测试。
- 视图层（渲染、缩放平移、键盘、拖拽、工具栏）按设计是**人工验证**的，清单在 [docs/MANUAL-VERIFICATION.md](docs/MANUAL-VERIFICATION.md)。该清单尚未完整走完，其附录列出了开发过程中真实出现并修复的 10 个缺陷 —— 如果你要改动相关代码，那里是回归的高发区。

因为插件会重写你的笔记文件，**首次使用建议先在一个测试 vault、或已被 git 跟踪的目录里验证写回行为**，确认无误再指向重要笔记。

## 文档

- [AGENTS.md](AGENTS.md) —— 给 AI agent 的工作说明：架构边界、十条硬约束、门禁，以及自动化测试覆盖不到的部分
- [docs/MANUAL-VERIFICATION.md](docs/MANUAL-VERIFICATION.md) —— 92 项人工验证清单
- [docs/superpowers/specs/](docs/superpowers/specs/) —— 设计与决策记录，含「已知限制」
