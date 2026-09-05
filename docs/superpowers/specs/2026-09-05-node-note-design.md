# 节点备注（引用块存储，悬浮展示）— 设计文档

日期：2026-09-05

## 1. 目标

给思维导图节点添加多行备注：在导图上以角标提示存在，鼠标悬浮角标弹出气泡展示内容，选中节点后可从工具栏打开多行输入框编辑。备注存进 `.md` 文件本身，用普通 Markdown 编辑器打开也是可读可改的正常内容。

## 2. 非目标

- 不支持块级 Markdown（列表、代码块、表格）。备注是多行段落 + 行内格式，气泡里按行内语法渲染，与节点文字同一套 tokenizer。
- 不支持根节点备注（见 5.4）。
- 不给备注做全文搜索、筛选、批量视图。
- 不做备注的折叠、固定（pin）、常驻显示。悬浮即出，移开即收。
- 备注不参与布局测量，不影响节点尺寸与连线几何。

## 3. 存储形态：节点行下方的引用块

```markdown
- 三季度目标
  > 等 A 确认口径。
  > 参考上季度的留存拆分。
  - 拉新
```

备注是**紧跟节点行的、连续的引用行**，写在该节点的续行位置（解析时从 `continuation` 里摘出来，见 5.2）。

选它而不选 frontmatter 映射表或 HTML 注释，理由按重要性排：

1. **`>` 前缀天然是逃逸字符。** 备注正文里出现 `- x`、`# x`、` ``` ` 时会被写成 `> - x`、`> # x`、`> ``` `。顶格标题正则要求 `^#`，列表项正则要求 `^[ \t]*[-*+][ \t]+`，围栏正则要求 `^[ \t]*` 后紧跟三个以上反引号或波浪线——三条全都不匹配。**用户在备注里写任何东西都不可能长出一个假节点，也不可能打开一个假围栏。** 换任何别的容器都要自己发明一套转义。
2. **现有管线零改动即字节保真。** parser 已经逐字捕获续行、serializer 已经逐字重放；续行既不打断 `itemBlocks` 的连续性，也不参与 `detectIndentUnitString` 的推断。不编辑备注时，那几行原样待在文件里。
3. 阅读视图里渲染成引用块，能被 Obsidian 搜索到、能进反链。

代价：大纲之外多了可见文字。与「H2–H6 可以带标记」那条已被接受的取舍同源——文字外溢到搜索和阅读视图，换来内容留在用户自己的文件里、不依赖插件才能读。

被否决的两个方案：

- **frontmatter 映射表**（`mindmap-notes: {路径: 文本}`）：节点 id 跨解析不稳定（AGENTS.md 第 4 条），只能用路径当键，改一次标题全部失联；且 frontmatter 只拥有两个键是明文约束，加第三个要动 `collapse-state.ts` 那段手写解析——本项目唯一一个测试全绿却在删用户数据的缺陷就出在那里。
- **行内 HTML 注释**：多行段落要自己处理换行与 `-->` 转义，搜索与反链拿不到，源码视图里照样占行。把引用块的好处丢光，只换来阅读视图干净。

## 4. 数据模型

`src/model/types.ts` 新增：

```ts
export interface Note {
  /** 去掉缩进与 `>` 前缀后的备注正文，行间以 \n 连接 */
  text: string;
  /** 来自文件的原始行（含缩进与前缀），逐字重放以保证往返字节相等。
   *  用户编辑后置 null，由 serialize 按节点当前缩进重新生成。 */
  raw: string[] | null;
}
```

`MindNode` 新增可选字段 `note?: Note`。

**`raw` 是这个设计的承重墙。** 用户写的可能是 `>备注`（无空格）、`>  备注`（两个空格）、tab 缩进、或 `>` 后带尾随空格。只存解码后的 `text`、写回时统一渲染成 `> `，就等于给项目加了第六条写回归一化——违反 AGENTS.md 第 2 条。所以解析期把原始行整条留住，**只有用户真正改了备注才置 `raw = null`**，那时才按当前缩进重新生成。

## 5. 纯函数层

### 5.1 新模块 `src/model/note.ts`

```ts
/** 引用行：可有缩进，`>` 之后可有一个空格。 */
const QUOTE_RE = /^[ \t]*>[ \t]?(.*)$/;

/** 从续行开头切出备注。不是开头的引用块不收。 */
export function splitNote(continuation: readonly string[]): {
  note: Note | null;
  rest: string[];
};

/** 备注正文 → 待写出的行。空行写成 `indent + ">"`。 */
export function renderNote(text: string, indent: string): string[];
```

`splitNote` 只认**开头**的连续引用行：备注在语义上必须紧贴节点行，中间隔了散文之后的引用块是普通正文，收编它会让「哪块是备注」变得不可预测。

`renderNote` 把正文里的空行写成 `indent + ">"` 而不是真空行：真空行会把一个引用块劈成两个，重新解析时 `splitNote` 只会收到前半段，后半段掉进 `continuation` 变成不可见正文——一次编辑静默吃掉半条备注。

**callout（`> [!note] …`）一律按引用行收编**，不做特判。规则是「只认 `>` 前缀，不看内容」；代价是 callout 的 `[!note]` 标记会当普通文字显示在气泡里。这是明确权衡后的选择：特判 callout 要多一条规则、多一个正则、多一组测试，而收益只是气泡里少显示一行标记文字。

### 5.2 parser

`buildTree` 构造节点时把 `entry.continuation` 过一遍 `splitNote`：`note` 进 `node.note`，`rest` 进 `node.continuation`。

**根节点不做 `splitNote`。** 与第 8 条「`parse` 不对根的 H1 调 `parseMarks`」逐字对称：根不支持备注（见 5.4），若解析期仍把根下面的引用块收成备注，导图上会出现一个点不动的角标。

### 5.3 serializer

节点行之后、`continuation` 之前写出备注：

```
node.note.raw ?? renderNote(node.note.text, indent)
```

`indent` 对列表项取 `indentUnit.repeat(listDepth + 1)`——比节点自己深一层，才落在列表项内部；对标题节点取 `""`。

### 5.4 tree-ops

- **`setNote(root, id, text)`**：走现有的不可变复制路径。`text` 去空白后为空即删除 `note` 字段；否则写入 `{ text, raw: null }`。对根 id 是 no-op。
- **`canNote(root, id)`**：`id !== root.id`。根节点一律不带备注，与 `canMark` 的规则和签名保持一致——不引入 `doc.hasHeading` 依赖。
- **`hasHiddenContent` 不改。** 备注在解析期就从 `continuation` 里摘走了，所以它自动看不见备注——**加备注不会让节点变得不可删、不可拖**。这是这个方案最容易踩的坑（备注若留在 `continuation` 里，加一条备注就会静默禁用删除和拖拽两个按钮），摘走续行就自然消解了。
- **`moveNode` 必须把移动子树内所有节点的 `note.raw` 置 null。** 节点深度变了，旧缩进不再对；不置的话备注行会留在原来的缩进列上——仍然解析回同一个节点（续行 sink 收一切非节点行），但在 Obsidian 自己的阅读视图里会掉出列表外。这是显式编辑触发的字节变化，不受第 2 条约束（那五条约束的是「打开再切走」的空操作）。

## 6. 视图层

### 6.1 角标

`node-el.ts` 新增 `buildNoteBadge(parent)`：内联 SVG，挂进现有的 `.mm-marks` 容器，排在优先级 / 进度 / 旗帜之后，类名 `mm-mark mm-note-badge`。

**它是 SVG，不是 `HTMLElement`。** 任何做 `closest()` 之前的类型守卫必须是 `instanceof Element`（AGENTS.md 第 7 条）。按 `HTMLElement` 收窄会让守卫整个失效，重演标记面板两行点不动的那个缺陷。

### 6.2 悬浮气泡 `src/view/note-tip.ts`

- `pointerenter` 角标后延迟约 200ms 弹出，`pointerleave` 角标或气泡后延迟约 120ms 关闭——留出让鼠标移进气泡里选文字的时间。
- 容器 `.mm-note-tip.mm-no-pan`（第 7 条：浮在画布之上的元素都要带这个类），定位复用 `popover.ts` 的 `placeNear`。
- 内容逐行走 `parseInline`，复用 node-el 的 token → DOM 渲染，**不用 `innerHTML`**（第 11 条）。
- **必须接进 `view.ts` 的 `closeStaleOverlays()`**：重渲染会摘掉节点 DOM，不关气泡就会留一个孤儿浮层挂在画布上。

### 6.3 编辑浮层 `src/view/note-popover.ts`

`<textarea>`：Enter 换行，Cmd/Ctrl+Enter 提交，Esc 取消，点击外部提交。

不复用 `input-popover.ts`：那是单行 `<input>` 且 Enter 即提交，键盘语义与多行输入正相反，合并会让两边都变糊。

键盘守卫沿用第 6 条：带修饰键的按键先放行（`metaKey || ctrlKey || altKey`）再考虑 `stopPropagation()`，否则会挡掉 Obsidian 全局热键。Esc 只关浮层，不能冒泡到画布把选中也清掉。

### 6.4 工具栏

`NodeCapabilities` 新增 `canNote`，`ToolbarHandlers` 新增 `onNote(anchor: DOMRect)`。按钮在根节点上禁用，`disabledLabel` 说明原因（根节点不支持备注）。

按第 8b 条，判断只从 `tree-ops.canNote` 来，视图层不重新推导。

## 7. i18n

新增 key（`src/i18n.ts` 中英各一份）：`toolbar.note`、`toolbar.note.disabled.root`、`note.placeholder`、`note.hint`、`badge.note`。

## 8. 测试

纯函数层：

- **`tests/note.test.ts`**：`splitNote` / `renderNote` 的往返；`>` 无空格、`>` 后多空格、`>` 单独成行（空行）、tab 缩进、非引用行处截断、开头不是引用行时不收编、callout 被收编。
- **对抗性断言（必须有）**：任意备注正文经 `renderNote` 再 `parse`，产出的节点数与不带备注时相同。这是「`>` 前缀即转义」这个论证的可执行版本，用 fast-check 生成含 `- `、`# `、` ``` `、`>`、`#{1,6} ` 的字符串来打它。只有正确性用例不够——门禁看不见「某个输入让备注长出一个假节点」这类问题。
- **`tests/roundtrip.test.ts`**：`CORPUS` 增补带引用块的语料（列表项下的、标题下的、`>` 无空格的、tab 缩进的、根 H1 下的），逐字节相等。
- **`tests/tree-ops.test.ts`**：`setNote` 新增 / 修改 / 清空 / 对根 no-op；`canNote`；`moveNode` 之后子树内 `note.raw` 全为 null；带备注的节点 `hasHiddenContent` 仍为 false（即仍可删可拖）。

视图层按设计没有自动化测试。门禁（`typecheck` / `test` / `build` / `check:purity` / `check:i18n`）看不见角标、气泡、悬浮延迟、浮层定位、键盘行为中的任何一个。`docs/MANUAL-VERIFICATION.md` 补人工清单：角标出现与消失、悬浮延迟与移进气泡不消失、编辑浮层的四种关闭路径、根节点按钮禁用态与提示、拖拽带备注的节点之后源文件缩进正确、备注里写 `- x` / `# x` / 代码围栏之后导图节点数不变。

## 9. 已知限制

- 用户此前手写的、紧跟节点行的引用块会被收编成备注：导图上多一个角标，内容与字节都不变，但从此可以被备注浮层改写。
- callout 收编后，`[!note]` 这类标记在气泡里按普通文字显示。
- 备注文字会出现在 Obsidian 的搜索结果与阅读视图里。这是选择引用块存储的直接后果，也是它相对 HTML 注释的主要优势。
- 备注不参与布局测量：极长的备注不会撑开节点，但气泡可能占据较大画布面积。
