# AGENTS.md

给在这个仓库里工作的 AI agent 的说明。人类读者请看 [README.md](README.md)。

这个插件**会重写用户真实的笔记文件**。下面的约束不是风格偏好，每一条都对应过一个真实发生并被修掉的缺陷。改动前请读完。

## 一句话架构

`.md` 文件 → `parse` → `MindDoc` 树 → 编辑走 `tree-ops`（不可变）→ `serialize` → 写回文件。
`parse` 是对全文的一次线性扫描（带围栏状态机）：顶格标题 `#`–`######` 与嵌套无序列表都产生节点，共同构成层级。
渲染是：树 + 测量尺寸 → `layout` 算坐标 → `renderer` 画 SVG 连线 + 绝对定位的 DOM 节点。

## 硬约束

### 1. 纯函数层边界

`src/model/**` 加 `src/view/layout.ts`、`src/view/camera.ts` 不得 `import obsidian`，不得出现 `document` / `window` / `HTMLElement`。

`npm run check:purity` 强制校验（覆盖范围写在 `scripts/check-purity.mjs` 的 `PURE_DIRS` / `PURE_FILES`）。这条边界是整个测试策略的地基：纯函数层有 341 个单测，视图层一个自动化测试都没有。

### 2. 只允许五条写回归一化

用导图视图打开一个文件、什么都不改再切走，Obsidian 也会重写它一次（原因见下面第 5 条）。这次重写只允许产生五种字节级变化：

1. 不以换行结尾的文件补上尾换行
2. 松散列表（项之间夹空行）压缩成紧凑列表
3. `CRLF` → `LF`
4. 缩进单位按标题各自推断、各自保真。两种情形下改写为每层 2 空格：某个列表块**内部**混用、无法归纳出单一单位；或**同一个标题名下**的多个列表块彼此不一致（统一到第一个能推断出的单位）。不同标题名下用不同单位是保真的
5. 行内标记按 优先级 → 进度 → 旗帜 排序

**其余任何字节差异都是缺陷。** 具体地：`*` / `+` 列表标记要原样保留（`MindNode.bullet`），每一个标题行的 `#` 个数与前后空白要原样保留（`HeadingForm.prefix` / `suffix`），frontmatter 结束围栏的尾随空白要原样保留，一切非节点行原样保留（落在 `MindDoc.preamble` 或某个节点的 `continuation` 里）。

**标题行的 `#` 个数永不重算：`serialize` 逐字重放 `heading.prefix`。** 任何形如 `"#".repeat(level)` 的代码都是缺陷 —— 层级归属规则（哪个标题挂在谁名下）与文件字节必须保持解耦，否则调整归属规则就会改写用户的文件。

**空行归属的判据有三个条件，少一个就出缺陷。** 归一化第 2 条（松散列表压缩）只在「前一条目是列表项」**且「它还没有吸收任何 continuation」**且「空行后紧跟列表项」时生效。列表项条目会持续吸收续行，所以「上一个条目是列表项」不等于「上一行是列表项行」；少了中间那条，`- a` / 空行 / 散文 / 空行 / `- c` 里第二个空行会被当成松散列表的填充删掉，而它分隔的是段落与列表 —— 那是第六条未获许可的归一化。语料在 `tests/roundtrip.test.ts` 的「空行归属」注释下面。

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

- **`WorkspaceLeaf.setViewState` 有私有重入守卫 `working`：同一 leaf 上一次 setViewState 未结束时，新调用被静默丢弃（不抛错、promise 正常 resolve）。** 从文件浏览器点开文件时，Obsidian 自己的 `openFile` 不 await、随后同步 `setActiveLeaf` 导致 `file-open` 在目标 leaf 仍 `working` 时就触发，此时在事件里调 `setViewState` 是无效的。所以 `main.ts` 的 `flipToMindmap` 切换后必须校验 `leaf.view.getViewType()` 并重试，**不要**改回"调一次就完"。

保存只走 `getViewData` / `setViewData` 加 400ms 防抖。**视图自己的保存绝不能调 `vault.modify`。**（`main.ts` 的 `markAsMindmap` 用 `vault.process` 是另一回事，那是对一个可能没打开的文件做一次性 frontmatter 编辑，是正当用法。）

### 6. 事件传播是本项目最高频的缺陷类型

`this.root` 上挂着 `pointerdown`（平移、选中、拖拽三个）和 `keydown`（画布快捷键）。浮层还会在 `document` 上挂捕获阶段的监听器。

- **目标阶段先于冒泡阶段，且传播路径在派发时就固定了。** 就地编辑的 keydown 挂在 `.mm-text`（目标），画布的挂在 `this.root`（祖先）。即使处理器里触发了重渲染把元素摘掉，同一个事件仍会继续冒泡。曾因此每次按 Enter 提交都多插一个空节点——修法是在就地编辑的 Enter / Escape 分支里 `stopPropagation()`。
- **但 `stopPropagation()` 会对所有祖先生效，包括 Obsidian 全局热键所在的 `document`。** 所以调用它之前必须放行带修饰键的按键（`metaKey || ctrlKey || altKey`），与 root 处理器里那条守卫保持一致。
- **所有 `this.root` 的监听器注册必须放在唯一的 `if (!this.eventsAttached)` 块里。** 因为 `clear()` 会把 `layers` 置空、让 `render()` 重新进入创建分支；不加守卫就会堆叠监听器，一个滚轮档位变成 `factor^N` 倍缩放。

### 7. `mm-no-pan` 标记类约定

画布的平移守卫和选中守卫都用 `closest(".mm-no-pan")` 判断。**任何浮在画布之上的元素都必须带这个类**，否则在它上面按下拖拽会连带平移底下的画布。

已经带上的：`.mm-controls`、`.mm-toolbar`、`.mm-style-menu`、`.mm-panel`、`.mm-input-popover`、`.mm-error`、拖拽的 ghost 与落点指示器。新增浮层时加上它即可，**不要**回去改成枚举类名列表。

**做 `closest()` 之前的类型守卫必须是 `instanceof Element`，不是 `instanceof HTMLElement`。** 本项目自己画的角标（进度、旗帜、节点连线）是内联 SVG，点在图形上时 `event.target` / `elementFromPoint()` 的返回值是 `SVGElement`——它有 `closest()`，但不是 `HTMLElement`。按 `HTMLElement` 收窄会让守卫整个失效：曾因此使标记面板的进度、旗帜两行完全点不动（优先级那行的角标是 `span`，所以只有它能用）。失效路径是选中守卫放行 → `nodeIdFrom()` 同样返回 null → 被当成「点在空白画布上」而清空选中 → `syncToolbar` → `closeStaleOverlays()` 在 `pointerdown` 阶段就把面板摘掉，按钮上的 `click` 根本不会派发。工具栏的 lucide 图标同为 SVG 却没暴露这个问题，是因为 Obsidian 自带 `.svg-icon { pointer-events: none }` 让 target 回落到了 `button`——不要据此以为 SVG target 不会发生。

### 8. 根节点永不携带标记

**根节点**不能带标记：文件里没有 H1 行时（`MindDoc.hasHeading` 为假）根本没有可写的位置，`serialize` 会跳过整行，标记静默丢失。所以 `setMarks` / `toggleMark` 对根 id 是 no-op，`commitText` 对根节点跳过 `parseMarks` 直接存原文，`parse` 也不对根的 H1 调 `parseMarks`。工具栏的「标记」按钮在选中根节点时禁用（否则打开面板后点任何选项都会静默失败）。

**文件里的 H2–H6 可以带标记**，写在 `#` 之后（`serialize` 走 `composeLine`，`buildTree` 解析标题行时调 `parseMarks`）。这是一个明确权衡过的取舍：标题文字在 Obsidian 里是可寻址的，标记会漏到大纲面板、搜索结果、图谱里，而且给标题加标记会让已有的 `[[笔记#标题]]` 引用失效——列表项没有这些外溢。**这个代价已经被人类决策者知晓并接受**，不要因为「看起来有副作用」就把它改回禁用。

### 8b. 视图层不重新推导「哪些操作可用」

`tree-ops` 导出 `canRemove` / `canAddSibling` / `canMark` 三个查询函数，`view.ts` 组装成 `NodeCapabilities` 交给 `toolbar.showFor`。**不要在视图层重写这些判断**：两处规则一旦漂移就会出现「按钮亮着但点了没反应」，这正是当初给「标记」按钮加禁用要防的那种失效。

`removeNode` 的拒绝判据是 `hasHiddenContent(node)`——**continuation 里有没有非空行，而不是「是不是标题节点」**。`## A` 与它名下第一个列表项之间那个空行没有信息，为它禁掉整个标题的删除是过宽的（旗舰示例里 9 个标题有 6 个属于这种情况）。这条判据同样作用于列表项：一个吸收了有序列表/围栏作为续行的列表项也不可删。

`addSibling` 对标题节点产出**同级标题**（逐字复用 `prefix` 与 `level`，`suffix` 置空、`indentUnit` 为 null），不是列表项——列表项写在 `## A` 之后重新解析时会成为 A 的第一个子节点。插入位置要按新节点的形态分别 clamp：插列表项时 `firstHeadingIndex` 是上界，插标题时是下界。

### 8c. list-before-heading 不变量

**一个标题节点的 `children` 里，列表项形态的子节点必须全部排在标题形态的子节点之前。**

`# t` 的子节点若排成 `[- a, ## A, - new]`，序列化出来 `- new` 落在 `## A` 之后，重新解析时它就跑进 A 名下了——一次「加子节点」静默改变了树的形状。`addChild` / `addSibling` / `moveNode` 的插入位置都对 `tree-ops.firstHeadingIndex` 做 clamp，`view.ts` 的 `handleDrop` 依赖 `moveNode` 内部这层 clamp（那里有注释说明，不要以为是漏掉的）。

标题节点**不可拖拽**，理由与不可删除不同：把 `## A` 拖到 `## B` 下面，写出来是 `## B` 后跟 `## A`，重新解析时 A 会 pop 掉 B 变成它的兄弟——移动被静默撤销。格式表达不出「H2 嵌在 H2 里」，除非改写 `prefix`，而那违反第 2 条。`moveNode` 拒绝标题源是正确性兜底，`drag.ts` 用 DOM 类 `mm-heading` 让拖拽根本不启动（根节点也带这个类，一个类覆盖根与 H2–H6）。

### 9. 绝对定位元素的宽度

`.mm-node` 是 `position: absolute`，它的包含块 `.mindmap-nodes` 没有宽度声明。所以必须用 `width: max-content`——否则 shrink-to-fit 会退化成 min-content，中文就是**一个字一行竖排**。测量容器 `.mindmap-measure` 用 `visibility: hidden` 而**不是** `display: none`，后者会让 `getBoundingClientRect()` 返回全零。

新增任何宽度有意义的绝对定位元素时，确认它的包含块有真实宽度（`this.root` 即 `.mindmap-view` 是 `width: 100%`，是安全的）。

### 10. 其他

- TypeScript `strict: true`，不用 `any`（必要时 `unknown` + 类型守卫）。
- **面向用户的字符串一律走 `t()`（`src/i18n.ts`），不写死任何语言。** 中文表是 key 的唯一来源，英文表声明为 `Record<MessageKey, string>`，漏译是编译错误。`npm run check:i18n` 扫 `src/main.ts` / `src/settings.ts` / `src/view.ts` / `src/view/**` 的字符串字面量，发现中文即失败——**注释不受约束，只有字面量受约束**。报出残留时去补 `t()`，**不要放宽扫描范围或加豁免名单**，那等于把这道门禁废掉。
- `src/i18n.ts` 既不 `import obsidian`（`getLanguage()` 只在 `main.ts` 一处调用，结果作为参数传进 `resolveLocale`），也不放进 `src/model/`（`t()` 有模块级可变状态、不是纯函数，塞进纯函数层是在骗人）。
- **`t()` 自己不通知任何人。** 语言变更后必须由 `main.ts` 的 `applyLanguage()` 重注册命令并让各导图视图 `refreshLocale()`。已渲染的 DOM 不会自己更新——`toolbar.ts` 的 `specs` 就是在 `createToolbar()` 函数体内求值的，不重建图层文案不会变。
- **`setLocale()` 必须紧跟 `loadSettings()`，排在 `addSettingTab()` 与 `registerCommands()` 之前。** `SettingTab.update()` 的文档写明：它「Stores the result of `getSettingDefinitions()` for rendering and search indexing」，**并且由 `addSettingTab()` 调用**。所以注册设置页那一刻的语言就被存进渲染与搜索索引了。曾因为 `setLocale` 排在 `addSettingTab` 之后，Obsidian 界面为英文时设置页出现「语言那一行中文、其余行英文」的混排（已复现并修复确认）。命令名同理，是 `addCommand` 时求值的。
- **命令重注册的 id 必须与 `addCommand` 逐字一致**（`MindmapPlugin.COMMAND_IDS`）。写错会表现为命令重复出现或直接消失，五条门禁都看不到，只能人工验。
- TS 里不写颜色字面量；CSS 颜色取自 Obsidian 变量或本插件的 `--mm-*` 调色板（只有调色板的**定义**可以是字面量）。阴影用 `var(--shadow-s)`。
- 进度值原样保留，永不改写成档位代表值。面板的高亮判断按 `progressStage()` 比档位，点击已生效项时传节点的**精确当前值**让 `toggleMark` 的相等判断命中从而清除。

### 11. 节点文字的行内 Markdown 渲染

节点文字不是纯文本插进 DOM 的：`src/model/inline.ts` 是一个纯函数 tokenizer（`parseInline`），把文字解析成 `strong`/`em`/`del`/`code`/`wikilink`/`link`/`text` 组成的 token 树；`src/view/node-el.ts` 把 token 树 programmatic 地转成 DOM（`createElement` + `textContent`，逐节点拼），**永远不用 `innerHTML`**——节点文字来自用户的笔记文件，这样注入在结构上不可能发生，不依赖任何转义逻辑。有意不用 `MarkdownRenderer.render()`：那是异步 API，会打乱这个插件同步的测量 → 布局 → 定位管线（见 `src/view/renderer.ts`），也会扰动 `eventsAttached`/`needsFit`/`ResizeObserver` 这套生命周期。

支持的子集：`**bold**`、`*italic*`（只认 `*`，不认 `_`——避免 `font_size`、`my_var` 这类词内下划线被误判成斜体）、`~~strike~~`、`` `code` ``（叶子节点，内部不再递归解析）、`[[page]]` / `[[page|alias]]`、`[text](url)`，以及 `\* \_ \~ \` \[ \\` 六个反斜杠转义。未闭合/畸形的标记一律回退成字面文本，不抛异常、不丢字符。故意不支持：`#tag` 渲染（文字仍然原样保留，只是不在导图上变成链接）、图片（`![alt](url)` 不认识 `!`，退化成字面 `!` 加一个普通 `link`）、HTML、任何块级语法。

`parseSpan`（`parseInline` 内部的递归下降核心）按 `(start, closer)` 做了记忆化，`closer` 只有四种取值，key 空间 O(4n)——不加这个的话，`"**a*b~~c".repeat(n)` 这种标记混杂、大量不闭合的输入会让同一个子问题在不同递归上下文里被指数级重复求解（64 字符约 3.3k 次调用，200+ 字符直接把主线程锁死数秒到数十秒）。**记忆化只解决重复计算（时间），不解决递归链条本身的深度（空间）**：未闭合标记会让调用栈随字符数线性变深（约 0.375 × 字符数），8000 字符左右就足以让 Node 20 抛 `Maximum call stack size exceeded`——这条边界本身贴着 V8 的栈预算走，随 JIT 预热状态漂移、不可靠，Electron 渲染进程大概率更容易触发而不是更难。所以额外加了 `MAX_DEPTH`（100）硬上限：递归深度到顶就不再尝试为该位置打开新标记、直接当字面文本处理，不递归、不抛异常、不丢字符。这两条（记忆化 + 深度上限）都只是给现有的递归下降扫描加的提前退出条件，**不是**把算法换成 delimiter-stack scanner——改 `parseSpan` 时两者都要保留，性能回归测试在 `tests/inline.test.ts` 的「性能回归」describe 块里，覆盖到 16000 字符量级。

**编辑路径必须切回原文，绝不能从渲染出的 DOM 读回文字**：一旦 `.mm-text` 里塞进了 `<strong>`/`<a>` 这些子元素，`textContent` 读回来的是去掉了 markup 的纯文字——如果编辑态直接复用这份 DOM，每次编辑都会把用户的 `**`/`*`/`~~`/`[[]]` 静默吃掉。`interaction.ts` 的 `startInlineEdit(nodeEl, initial, ...)` 在设置 `contentEditable = "true"`、聚焦、设置选区**之前**，先用 `initial`（调用方 `view.ts` 的 `beginEdit()` 传入的 `node.text`，即模型里的原始 Markdown 源文本，不是从 DOM 读的）整体覆盖 `.mm-text` 的内容——这一步保证了用户开始编辑时看到的、以及提交时读回的，始终是同一份原文。改这段代码时，`initial`/`node.text` 必须继续来自 `this.doc`，不能改成从 DOM 读。提交或取消编辑后 `render()` 会用新文字重新走一遍 `parseInline`，把 token 渲染回 DOM。

链接元素会 `stopPropagation()` 挡掉 `this.root` 上的平移/选中/拖拽三个 `pointerdown` 监听（否则点链接会先触发一次节点拖拽/选中）；wikilink 的跳转动作由 `view.ts` 通过可选回调 `onOpenLink` 注入（`this.app.workspace.openLinkText(...)`），`node-el.ts` 本身不 import `"obsidian"`、不碰 `app`。wikilink 元素带 `class="internal-link"` `data-href`，这是 Obsidian 渲染 wikilink 的约定属性，但 Obsidian 自己的全局点击处理只在它自己调用过 `registerDomEvents()` 的 `markdown-preview-view`/编辑器/嵌入容器内生效（反编译 `obsidian.asar` 确认过），`.mm-node` 不在那些容器下，不会被接管，因此不存在"点一次链接打开两次笔记"的问题。

### 12. 节点下划线是 SVG 边的一部分，不是 CSS border

非根节点底部那条随分支变色的线，画在 `src/view/layout.ts` 的 `bezier()` 里：连接父子节点的贝塞尔曲线到达子节点左下角后，再追加一段 `H` 水平线段画到子节点右下角，充当子节点的下划线。父节点自己的下划线由*它自己*的入边画出，终点正是这条曲线的起点（父节点右下角），两段路径在同一个几何点上重合，渲染出来是一笔连续的描边。

`styles.css` 里**不再有** `.mm-node:not(.mm-root) { border-bottom: ... }` 这条规则，`--mm-line` 自定义属性还在（折叠角标背景用）。这是刻意的：CSS border 的粗细固定不随深度变化，而 SVG 描边的 `stroke-width` 随深度变细（`strokeWidth(depth)`），两套独立几何体的中心线对不齐，在深层节点上会出现肉眼可见的台阶——这正是本条约束要防的真实缺陷（复核截图里能看到）。**如果要重新加回 CSS 下划线，会原样复现这个缺陷**；改下划线粗细/颜色应该去改 `bezier()` 产出的路径和调用方设置的 `stroke-width`/`stroke` 属性，不要加 border。

**根节点的出边起点是例外：走右边中点，不是右下角。** 非根节点的出边必须从右下角出发才能与那条下划线严丝合缝；根节点没有入边、因此没有下划线可对接，而它是一个带背景和边框的实心圆角方框，线从右下角拐出来会看着像从盒子的角上漏出。`bezier(from, to, fromRoot)` 的第三个参数就是这件事，调用方按 `depth === 0` 传入。回归测试在 `tests/layout.test.ts` 的「根节点出边的起点」describe 块里，其中一条专门断言**非根节点的起点仍等于它入边 H 段的终点**——那是防止有人图省事把中点规则推广到所有节点、把台阶缺陷带回来。

**这条约束不只针对 `border-bottom`，任何方向的 border 都算。** 标题节点刚落地时曾用 `border-left: 2px` + `padding-left: 8px` 做视觉区分，效果是错的：`.mm-node` 有 `border-radius: 4px`，边框跟着圆角走、上下两端鼓出来，渲染成一个圆头竖条，用户看到的是「一块不该出现的阴影」。节点的几何交给 SVG 边，CSS 只管排版——要做视觉区分就改字重、字号、颜色这类不产生几何体的属性（`.mm-heading` 现在只有 `font-weight: 700`，且必须是 700 而非 600，因为 `.mm-depth-1` 本身已经是 600）。

## 门禁

改完必须四条全绿：

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run build         # 生成 main.js
npm run check:purity  # 纯函数层边界
npm run check:i18n    # 界面文字未写死中文
```

**任何手写的、带回溯/递归下降的 parser，只交正确性测试不够，必须同时带对抗性长输入测试**：既要有时间上限断言（防止病态输入卡死主线程——`parseSpan` 的记忆化就是补这个洞的），也要有结构化输出断言（防止退化成"整段都当字面文本"却因为 round-trip 恒等而蒙混过关）。这不是假设性的顾虑：`src/model/inline.ts` 在拿到 38 个全绿的正确性测试之后，仍然让一个真实用户输入（几千字符、夹杂大量星号波浪线）把 Obsidian 主线程冻结了 15 秒以上，直到专门补了病态输入的性能回归测试才被发现。

`npm run check:i18n` 只能保证「没有写死的中文」，**保证不了英文译文是对的**——译文质量只能人工看，机器无从判断。同理 `npm run check:purity` **看不到**性能/结构化输出这类问题，它只校验目录边界（有没有 `import "obsidian"`、有没有碰 DOM），跟一个纯函数在某些输入下会不会变慢或退化没有关系——这条门禁能保证的只是"这段代码可以被单测覆盖"，不保证"它真的被覆盖到了对的场景"。

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
