# AGENTS.md

给在这个仓库里工作的 AI agent 的说明。人类读者请看 [README.md](README.md)。

这个插件**会重写用户真实的笔记文件**。下面的约束不是风格偏好，每一条都对应过一个真实发生并被修掉的缺陷。改动前请读完。

## 一句话架构

`.md` 文件 → `parse` → `MindDoc` 树 → 编辑走 `tree-ops`（不可变）→ `serialize` → 写回文件。
渲染是：树 + 测量尺寸 → `layout` 算坐标 → `renderer` 画 SVG 连线 + 绝对定位的 DOM 节点。

## 硬约束

### 1. 纯函数层边界

`src/model/**` 加 `src/view/layout.ts`、`src/view/camera.ts` 不得 `import obsidian`，不得出现 `document` / `window` / `HTMLElement`。

`npm run check:purity` 强制校验（覆盖范围写在 `scripts/check-purity.mjs` 的 `PURE_DIRS` / `PURE_FILES`）。这条边界是整个测试策略的地基：纯函数层有 194 个单测，视图层一个自动化测试都没有。

### 2. 只允许五条写回归一化

用导图视图打开一个文件、什么都不改再切走，Obsidian 也会重写它一次（原因见下面第 5 条）。这次重写只允许产生五种字节级变化：

1. 不以换行结尾的文件补上尾换行
2. 松散列表（项之间夹空行）压缩成紧凑列表
3. `CRLF` → `LF`
4. 缩进单位混用、无法归纳出单一一致单位时，统一改写为每层 2 空格
5. 行内标记按 优先级 → 进度 → 旗帜 排序

**其余任何字节差异都是缺陷。** 具体地：`*` / `+` 列表标记要原样保留（`MindNode.bullet`），标题行的多余空格要原样保留（`MindDoc.headingPrefix` / `headingSuffix`），frontmatter 结束围栏的尾随空白要原样保留，列表块之外的一切内容原样保留。

改到 `parser.ts` / `serializer.ts` 时，`tests/roundtrip.test.ts` 是判据：`CORPUS` 里的每条都断言逐字节相等，另有 fast-check 属性测试。**不要为了让测试过而放宽生成器或语料。**

### 3. frontmatter 只拥有两个键

`mindmap` 和 `mindmap-collapsed`。其余键与**键的顺序**必须原样保留。

`collapse-state.ts` 用手写字符串操作而非 YAML 库。判断一个键的块在哪里结束**看缩进**，不要改回"扫到下一个像键的行"——那个写法会把中文键（`名字:`）、带点的键（`my.key:`）、空行、列首注释全部吞掉并静默删除。这是本项目唯一一个测试全绿却在删用户数据的缺陷。

### 4. 节点 id 跨解析复用

`parser.ts` 每次解析都把根设为 `n0`、其余按前序 `n1, n2, …`。所以**同一个 id 字符串在重新解析后可能指向不同节点**。

任何跨越"可能重新解析"的边界持有 id 的代码都必须在文档替换时清掉。已经这么做的：`editingId`、`pendingEditId`、`freshNodeId`、`overlayOwnerId`、拖拽状态（`dragControl.cancel()`）。`selectedId` 是故意保留的（刷新后选中会落到同位置的节点，可接受的降级）。

`freshId()` 是无状态的——它从树里现有的 id 推算下一个。**必须把上一次返回的 root 接住再传给下一次调用**；拿旧 root 连调两次 `addChild` 会产出重复 id（用户连按两次 Tab 就是这个路径）。

### 5. `TextFileView` 的真实行为和文档不一样

`obsidian` npm 包只有类型声明没有实现。以下是从 `obsidian.asar` 反编译核实的，两个 Critical 缺陷源于对它的误解：

- **`clear()` 只能从 `save(true)` 到达，且仅当 `lastSavedData !== getViewData()`**。文件已是规范形态、或插件刚 flush 过时，`save()` 会早退，`clear()` 不执行。所以**每个文件的状态重置不能只放在 `clear()` 里**——现在的做法是 `resetPerFileState()`，同时由 `clear()` 和 `setViewData(data, clear)` 在 `clear === true` 时调用。`setViewData` 的这个布尔参数就是"换了另一个文件"的信号。
- **基类自己注册了 `vault.on("modify")`**（`onModify` → `loadFileInternal(f, false)` → `setViewData(content, false)`）。插件**不要**再注册一个，否则两个处理器竞争、基类那个先赢，所有清理逻辑都被跳过。外部文件变化的全部处理都放在 `setViewData` 里。
- 回显抑制由基类三重保障：`onModify` 的 `saving` 标志、`loadFileInternal` 的 `i === n` 早退、`setData` 的 `this.data !== e`。不要再自己实现一套字节比对。
- 插件**刻意不调用 `requestSave()`**，因此基类的 `dirty` 标志恒为 false、它的逐行三方合并路径是死代码。这是有意的——把序列化后的导图 Markdown 做文本合并比"磁盘内容优先"更糟。不要"修复"它。

保存只走 `getViewData` / `setViewData` 加 400ms 防抖。**视图自己的保存绝不能调 `vault.modify`。**（`main.ts` 的 `markAsMindmap` 用 `vault.process` 是另一回事，那是对一个可能没打开的文件做一次性 frontmatter 编辑，是正当用法。）

### 6. 事件传播是本项目最高频的缺陷类型

`this.root` 上挂着 `pointerdown`（平移、选中、拖拽三个）和 `keydown`（画布快捷键）。浮层还会在 `document` 上挂捕获阶段的监听器。

- **目标阶段先于冒泡阶段，且传播路径在派发时就固定了。** 就地编辑的 keydown 挂在 `.mm-text`（目标），画布的挂在 `this.root`（祖先）。即使处理器里触发了重渲染把元素摘掉，同一个事件仍会继续冒泡。曾因此每次按 Enter 提交都多插一个空节点——修法是在就地编辑的 Enter / Escape 分支里 `stopPropagation()`。
- **但 `stopPropagation()` 会对所有祖先生效，包括 Obsidian 全局热键所在的 `document`。** 所以调用它之前必须放行带修饰键的按键（`metaKey || ctrlKey || altKey`），与 root 处理器里那条守卫保持一致。
- **所有 `this.root` 的监听器注册必须放在唯一的 `if (!this.eventsAttached)` 块里。** 因为 `clear()` 会把 `layers` 置空、让 `render()` 重新进入创建分支；不加守卫就会堆叠监听器，一个滚轮档位变成 `factor^N` 倍缩放。

### 7. `mm-no-pan` 标记类约定

画布的平移守卫和选中守卫都用 `closest(".mm-no-pan")` 判断。**任何浮在画布之上的元素都必须带这个类**，否则在它上面按下拖拽会连带平移底下的画布。

已经带上的：`.mm-controls`、`.mm-toolbar`、`.mm-style-menu`、`.mm-panel`、`.mm-input-popover`、`.mm-error`、拖拽的 ghost 与落点指示器。新增浮层时加上它即可，**不要**回去改成枚举类名列表。

### 8. 根节点永不携带标记

H1 行没有行内标记语法，`serialize` 刻意不写 `root.marks`。所以 `setMarks` / `toggleMark` 对根 id 是 no-op，`commitText` 对根节点跳过 `parseMarks` 直接存原文。如果在别处给根节点设了标记，数据会静默丢失。工具栏的「标记」按钮在选中根节点时是禁用的。

### 9. 绝对定位元素的宽度

`.mm-node` 是 `position: absolute`，它的包含块 `.mindmap-nodes` 没有宽度声明。所以必须用 `width: max-content`——否则 shrink-to-fit 会退化成 min-content，中文就是**一个字一行竖排**。测量容器 `.mindmap-measure` 用 `visibility: hidden` 而**不是** `display: none`，后者会让 `getBoundingClientRect()` 返回全零。

新增任何宽度有意义的绝对定位元素时，确认它的包含块有真实宽度（`this.root` 即 `.mindmap-view` 是 `width: 100%`，是安全的）。

### 10. 其他

- TypeScript `strict: true`，不用 `any`（必要时 `unknown` + 类型守卫）。
- 面向用户的字符串一律中文。
- TS 里不写颜色字面量；CSS 颜色取自 Obsidian 变量或本插件的 `--mm-*` 调色板（只有调色板的**定义**可以是字面量）。阴影用 `var(--shadow-s)`。
- 进度值原样保留，永不改写成档位代表值。面板的高亮判断按 `progressStage()` 比档位，点击已生效项时传节点的**精确当前值**让 `toggleMark` 的相等判断命中从而清除。

## 门禁

改完必须四条全绿：

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest run（194 个）
npm run build         # 生成 main.js
npm run check:purity  # 纯函数层边界
```

## 发布

推一个版本号 tag 就会触发 `.github/workflows/release.yml`：跑一遍四条门禁，然后创建 release 并附上 `main.js` / `manifest.json` / `styles.css` 三个**独立文件**（不要打包成 zip，Obsidian 按文件名逐个下载）。

**tag 名必须与 `manifest.json` 的 `version` 完全一致，且不带 `v` 前缀。** Obsidian 会去 `releases/download/<version>/manifest.json` 取文件，带前缀会 404。workflow 里有一步专门校验这个，同时校验 `versions.json` 有对应项、且其值与 `minAppVersion` 一致——不一致是社区市场提交被退回的常见原因。

发新版时要同步改三处：`manifest.json` 的 `version`、`versions.json` 加一项、然后打 tag。

## 自动化测不到什么

设计上视图层没有自动化测试（纯函数层测试 + 人工验证的分工）。四条门禁**看不到**任何关于布局、渲染、指针与键盘行为的东西——文字竖排那个缺陷就是全部门禁通过的情况下漏出去的。

涉及 `src/view/` 或 `styles.css` 的改动，请在报告里明确区分"机械验证过的"和"需要人在真实 Obsidian 里确认的"，**不要声称视觉或交互行为正确**。人工清单在 [docs/MANUAL-VERIFICATION.md](docs/MANUAL-VERIFICATION.md)，其附录列了 10 个真实出现过的缺陷，是回归的高发区。

## 设计文档

- 设计与决策记录：[docs/superpowers/specs/2026-09-03-obsidian-mindmap-design.md](docs/superpowers/specs/2026-09-03-obsidian-mindmap-design.md)，含「已知限制」一节
- 实施计划（历史记录，写于插件定名之前，其中的插件 id 已过时）：`docs/superpowers/plans/`
