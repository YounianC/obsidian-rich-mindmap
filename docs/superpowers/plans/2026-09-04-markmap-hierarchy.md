# 采纳 markmap 层级语义（标题参与层级）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `.md` 文件里顶格的标题 `#`–`######` 与嵌套无序列表共同构成导图层级，修掉「文件里出现 `## 章节` 就导致空根节点」这个痛点。

**Architecture:** 节点形态下沉为 `MindNode` 上的一个可选字段 `heading?: HeadingForm`，有它就是标题节点，没有就是列表项。`parse` 从「定位单个列表块」改成对全文一次线性扫描（带围栏状态），用标题栈决定层级归属。`serialize` 一次前序遍历，标题节点重放原始 `prefix`/`suffix`，列表项按「从最近标题祖先算起的深度」×「该标题记住的缩进单位」缩进。`MindDoc` 的 `headingPrefix`/`headingSuffix`/`headingGap` 三个字段被吸收进树。

**Tech Stack:** TypeScript strict、Vitest、fast-check、esbuild。无新依赖。

设计文档：[docs/superpowers/specs/2026-09-04-markmap-hierarchy-design.md](../specs/2026-09-04-markmap-hierarchy-design.md)。本计划的任何取舍以该文档为准；两者冲突时先改文档再改计划。

## Global Constraints

以下每一条来自 `AGENTS.md`，适用于**每一个** task，不再逐 task 重复：

- **纯函数层边界**：`src/model/**` 与 `src/view/layout.ts`、`src/view/camera.ts` 不得 `import obsidian`，不得出现 `document` / `window` / `HTMLElement`。`npm run check:purity` 强制校验。
- **写回归一化只允许五条**（第 4 条的措辞在 Task 4 更新）：补尾换行；松散列表压缩；`CRLF`→`LF`；缩进单位无法归纳为单一单位时改写为 2 空格；行内标记按 优先级→进度→旗帜 排序。**其余任何字节差异都是缺陷。**
- **`tests/roundtrip.test.ts` 的 `CORPUS` 只能加不能放宽。** 不要为了让测试通过而删语料、改语料或放宽 fast-check 生成器。
- **frontmatter 只拥有 `mindmap` 和 `mindmap-collapsed` 两个键**，其余键与键的顺序原样保留。本计划不碰 `collapse-state.ts`。
- **节点 id**：`parse` 每次把根设为 `n0`、其余按文档顺序（等于前序）`n1, n2, …`。`freshId` 无状态，必须把上一次返回的 root 接住再传给下一次调用。
- TypeScript `strict: true`，不用 `any`（必要时 `unknown` + 类型守卫）。面向用户的字符串一律中文。TS 里不写颜色字面量。
- **每个 task 结束前四条门禁全绿**：`npm run typecheck`、`npm test`、`npm run build`、`npm run check:purity`。
- 涉及 `src/view/` 或 `styles.css` 的改动，报告里必须区分「机械验证过的」与「需要人在真实 Obsidian 里确认的」，**不得声称视觉或交互行为正确**。

## File Structure

| 文件 | 职责 | 本计划的动作 |
|---|---|---|
| `src/model/types.ts` | 纯数据形状 | 加 `HeadingForm`、`MindNode.heading`、`isHeading`；`MindDoc` 删三个字段 |
| `src/model/parser.ts` | Markdown → `MindDoc` | 核心重写：线性扫描 + 围栏状态 + 标题栈 |
| `src/model/serializer.ts` | `MindDoc` → Markdown | 前序遍历重放两种形态 |
| `src/model/tree-ops.ts` | 不可变树编辑 | 标题节点的拒绝路径 + list-before-heading 不变量 |
| `src/view/toolbar.ts` | 浮动工具栏 | `isRoot` 谓词换成 `isHeading`，新增两个按钮的禁用 |
| `src/view/node-el.ts` | 节点 DOM | 加 `.mm-heading` 类 |
| `src/view/drag.ts` | 拖拽 | 拒绝标题节点作为拖拽源 |
| `src/view.ts` | 视图编排 | 落点索引 clamp、commitText 分支、toolbar 参数 |
| `styles.css` | 样式 | `.mm-heading` |

不改：`collapse-state.ts`、`marks.ts`、`inline.ts`、`new-file.ts`、`layout.ts`、`camera.ts`、`renderer.ts`、`interaction.ts`、`measure.ts`、`popover.ts`、`marks-panel.ts`、`input-popover.ts`、`controls.ts`、`dom.ts`。

## Task 顺序与中间状态

Task 3 落地后到 Task 4 完成前，存在一个**已知的、故意的中间状态**：多个列表块共用一个全局 `indentUnit`，因此一份「`## A` 下用 2 空格、`## B` 下用 4 空格」的文件会被全文改写成 2 空格。这是设计文档 5.3 明确要消掉的倒退，由 Task 4 修复。Task 3 的验收不包含这条，**不要**在 Task 3 里加对应的 `CORPUS` 语料（那条语料在 Task 4 加）。

---

### Task 1: `HeadingForm` 类型与 `isHeading` 谓词

纯增量，不删任何字段，不改任何字节行为。目的是让后续 task 有一个稳定的判别入口。

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/model/parser.ts:163-265`（`parse` 里构造 `root` 的那段）
- Test: `tests/parser.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface HeadingForm { level: number; prefix: string; suffix: string; indentUnit: string | null }`
  - `MindNode.heading?: HeadingForm`
  - `isHeading(node: MindNode): node is MindNode & { heading: HeadingForm }`

- [ ] **Step 1: 写失败测试**

在 `tests/parser.test.ts` 末尾追加：

```ts
import { isHeading } from "../src/model/types";

describe("标题形态", () => {
  it("有 H1 时根节点带 heading，prefix/suffix 逐字保留", () => {
    const doc = parse("#   t   \n\n- a\n", "我的导图.md");
    expect(isHeading(doc.root)).toBe(true);
    expect(doc.root.heading).toEqual({
      level: 1,
      prefix: "#   ",
      suffix: "   ",
      indentUnit: "  ",
    });
  });

  it("无 H1 时根节点仍是标题形态，hasHeading 为 false", () => {
    const doc = parse("- a\n", "我的导图.md");
    expect(isHeading(doc.root)).toBe(true);
    expect(doc.hasHeading).toBe(false);
    expect(doc.root.heading?.prefix).toBe("# ");
    expect(doc.root.heading?.suffix).toBe("");
  });

  it("列表项不是标题形态", () => {
    const doc = parse("# t\n\n- a\n", "我的导图.md");
    expect(isHeading(doc.root.children[0])).toBe(false);
    expect(doc.root.children[0].heading).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/parser.test.ts -t "标题形态"`
Expected: FAIL —— `isHeading` 未从 `types` 导出（TS 编译错误）。

- [ ] **Step 3: 加类型与谓词**

在 `src/model/types.ts` 里，`Bullet` 之后插入：

```ts
/** 标题节点的来源形态。序列化只读 prefix/suffix，绝不从 level 重算 `#`。 */
export interface HeadingForm {
  /** 1–6。仅解析期用于层级归属计算 */
  level: number;
  /** `#` 到文字之间的原始前缀，如 `"## "`、`"###   "` */
  prefix: string;
  /** 文字之后的原始尾随空白 */
  suffix: string;
  /** 该标题名下直接列表块的缩进单位；无可推断时为 null */
  indentUnit: string | null;
}
```

在 `MindNode` 里，`bullet` 之后插入：

```ts
  /** 存在即为标题节点，不存在即为列表项。
   *  根节点恒有此字段（包括文件没有 H1、根文字取自文件名的情形），
   *  由 MindDoc.hasHeading 决定序列化是否真的写出标题行。
   *  若虚拟根不带 heading，isHeading(root) 就是 false，根既不是标题也不是
   *  列表项，标题节点的各条约束（不可删、不可拖、不带标记）会从根身上漏掉。 */
  heading?: HeadingForm;
```

在 `FLAG_COLORS` 之前追加谓词：

```ts
/** 判别节点形态的唯一入口。不要散落 `node.heading !== undefined`。 */
export function isHeading(
  node: MindNode,
): node is MindNode & { heading: HeadingForm } {
  return node.heading !== undefined;
}
```

- [ ] **Step 4: parser 给根节点填 heading**

`src/model/parser.ts` 里 `parse` 构造 `root` 的字面量（现在以 `id: "n0"` 开头那处），加一个 `heading` 字段。它与现存的 `doc.headingPrefix` / `doc.headingSuffix` 暂时重复，Task 2 删掉旧的那两个。

`indentUnit` 在这一步先填 `null`，两处 `return` 的 `indentUnit` 计算之后再回填——最省事的写法是在两个 `return` 之前各写一行：

```ts
  // Task 1：根节点恒为标题形态。indentUnit 在此回填，Task 4 起改为按标题存。
  root.heading = { level: 1, prefix: headingPrefix, suffix: headingSuffix, indentUnit: "  " };
```

（`blockStart < 0` 的早退分支用 `"  "`；有列表块的分支用刚算出的 `indentUnit` 变量。）

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/parser.test.ts -t "标题形态"`
Expected: PASS（3 个）

- [ ] **Step 6: 四条门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity
```

Expected: 全绿。`npm test` 的用例数比改动前多 3 个，**没有任何原有用例变红**——这一步是纯增量，`CORPUS` 逐字节断言必须原封不动地继续通过。

- [ ] **Step 7: 提交**

```bash
git add src/model/types.ts src/model/parser.ts tests/parser.test.ts
git commit -m "feat: 加 HeadingForm 与 isHeading 谓词，根节点恒为标题形态"
```

---

### Task 2: serializer 改读 `root.heading`，删除 `MindDoc` 的两个字段

**Files:**
- Modify: `src/model/types.ts`（删 `headingPrefix`、`headingSuffix`）
- Modify: `src/model/serializer.ts:31-52`
- Modify: `src/model/parser.ts`（两处 `return` 去掉这两个字段）
- Modify: `tests/roundtrip.test.ts:123-210`（生成器与断言）
- Modify: `tests/parser.test.ts`（引用了 `headingPrefix`/`headingSuffix` 的断言改成读 `root.heading`）

**Interfaces:**
- Consumes: Task 1 的 `HeadingForm`、`isHeading`
- Produces: `MindDoc` 不再有 `headingPrefix` / `headingSuffix`；`serialize` 从 `doc.root.heading` 取标题行的空白排布

- [ ] **Step 1: 写失败测试**

在 `tests/serializer.test.ts` 末尾追加：

```ts
import { isHeading } from "../src/model/types";

describe("标题行的空白排布来自 root.heading", () => {
  it("改 root.heading.prefix 就改变写出的标题行", () => {
    const doc = parse("# t\n\n- a\n", "我的导图.md");
    if (!isHeading(doc.root)) throw new Error("根节点必须是标题形态");
    const next = {
      ...doc,
      root: { ...doc.root, heading: { ...doc.root.heading, prefix: "#   " } },
    };
    expect(serialize(next)).toBe("#   t\n\n- a\n");
  });

  it("hasHeading 为 false 时不写标题行", () => {
    const doc = parse("- a\n", "我的导图.md");
    expect(serialize(doc)).toBe("- a\n");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/serializer.test.ts -t "标题行的空白排布"`
Expected: FAIL —— 第一个用例写出的仍是 `"# t\n\n- a\n"`，因为 `serialize` 读的还是 `doc.headingPrefix`。

- [ ] **Step 3: serializer 改读 root.heading**

`src/model/serializer.ts` 里 `if (doc.hasHeading)` 那段替换为：

```ts
  // 标题行的空白排布来自 root.heading，逐字重放：`#   T`、`# T   ` 都是合法写法，
  // 抹掉它们属于未获许可的写回归一化。
  // 永不从 heading.level 重算 `#` 的个数——层级归属规则怎么调都不改写字节，
  // 这是「显示层级」与「文件字节」解耦的落点（见设计文档 5.1）。
  if (doc.hasHeading && isHeading(doc.root)) {
    out += `${doc.root.heading.prefix}${doc.root.text}${doc.root.heading.suffix}\n`;
  }
```

顶部 import 改为 `import { isHeading, type MindDoc, type MindNode } from "./types";`。

- [ ] **Step 4: 删掉 MindDoc 的两个字段**

`src/model/types.ts` 的 `MindDoc` 删除 `headingPrefix` 与 `headingSuffix` 两个字段及其注释。`src/model/parser.ts` 的两处 `return` 对象里删掉这两个键（局部变量 `headingPrefix` / `headingSuffix` 仍需保留，Step 4 的 `root.heading` 要用）。

- [ ] **Step 5: 更新 roundtrip 生成器**

`tests/roundtrip.test.ts` 的 `docArb`：删掉 `headingPrefix` / `headingSuffix` 两个 `fc.record` 键，把它们移进 `root` 的生成器里。`root` 的 `fc.record` 增加：

```ts
      heading: fc.record({
        level: fc.constant(1),
        prefix: hasHeading ? fc.constantFrom("# ", "#   ", "#\t") : fc.constant("# "),
        suffix: hasHeading ? fc.constantFrom("", "   ") : fc.constant(""),
        indentUnit: fc.constant("  "),
      }),
```

断言段（`expect(back.headingPrefix)` / `expect(back.headingSuffix)` 两行）改为：

```ts
        expect(back.root.heading?.prefix).toBe(doc.root.heading?.prefix);
        expect(back.root.heading?.suffix).toBe(doc.root.heading?.suffix);
```

`stripIds` 不用改：`heading` 不参与结构比较，因为它不影响树形状。

- [ ] **Step 6: 更新 parser 测试里的引用**

`tests/parser.test.ts` 里所有 `doc.headingPrefix` / `doc.headingSuffix` 改成 `doc.root.heading?.prefix` / `doc.root.heading?.suffix`。用 `grep -n "headingPrefix\|headingSuffix" tests/` 找齐。

- [ ] **Step 7: 四条门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity
```

Expected: 全绿。`CORPUS` 的逐字节断言必须继续通过——这一步只搬字段位置，不改任何字节行为。

- [ ] **Step 8: 提交**

```bash
git add src/model/types.ts src/model/serializer.ts src/model/parser.ts tests/
git commit -m "refactor: 标题行的空白排布搬进 root.heading，MindDoc 删两个字段"
```

---

### Task 3: parser 线性扫描 —— 标题产生节点

本计划的核心。改完之后 `# t / ## A / - a` 才会在导图上出现三个节点。

**Files:**
- Modify: `src/model/parser.ts`（`scanListBlock` / `buildTree` / `parse` 全部重写）
- Modify: `src/model/types.ts`（`MindDoc` 删 `headingGap`）
- Modify: `src/model/serializer.ts`（前序遍历两种形态；`headingGap` 改读 `root.continuation`）
- Modify: `tests/roundtrip.test.ts`（新增 `CORPUS` 语料；生成器删 `headingGap`）
- Modify: `tests/parser.test.ts`（`headingGap` 断言改成 `root.continuation`）

**Interfaces:**
- Consumes: Task 1 的 `HeadingForm` / `isHeading`；Task 2 之后的 `MindDoc`
- Produces:
  - `MindDoc` 不再有 `headingGap`
  - `parse` 产出的树里，标题节点与列表项节点混合，id 按文档顺序 `n0, n1, n2, …`
  - `serialize` 的列表缩进深度改为「从最近标题祖先算起」

- [ ] **Step 1: 写失败测试（层级归属）**

在 `tests/parser.test.ts` 末尾追加：

```ts
describe("标题参与层级", () => {
  it("H2 成为根的子节点，其后的列表挂在 H2 下", () => {
    const doc = parse("# t\n\n## A\n\n- a\n", "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["A"]);
    const a = doc.root.children[0];
    expect(isHeading(a)).toBe(true);
    expect(a.heading?.level).toBe(2);
    expect(a.children.map((c) => c.text)).toEqual(["a"]);
    expect(isHeading(a.children[0])).toBe(false);
  });

  it("跳级：H1 之后直接 H3，H3 挂在根下", () => {
    const doc = parse("# t\n\n### C\n", "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["C"]);
    expect(doc.root.children[0].heading?.level).toBe(3);
  });

  it("跳级后回到 H2：H3 与 H2 是兄弟，同挂根下", () => {
    const doc = parse("# t\n\n### C\n\n## D\n", "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["C", "D"]);
  });

  it("第二个 H1 挂在根下", () => {
    const doc = parse("# t\n\n# X\n\n## Y\n", "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["X"]);
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["Y"]);
  });

  it("无 H1、以 H2 开头：根是文件名，H2 是它的子节点", () => {
    const doc = parse("## A\n\n- a\n", "我的导图.md");
    expect(doc.hasHeading).toBe(false);
    expect(doc.root.text).toBe("我的导图");
    expect(doc.root.children.map((c) => c.text)).toEqual(["A"]);
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["a"]);
  });

  it("标题文字不解析行内标记", () => {
    const doc = parse("# t\n\n## (p1) A\n", "我的导图.md");
    expect(doc.root.children[0].text).toBe("(p1) A");
    expect(doc.root.children[0].marks).toEqual({});
  });

  it("列表项在标题之前时，两者按文档顺序同为根的子节点", () => {
    const doc = parse("# t\n\n- a\n## A\n", "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "A"]);
  });

  it("围栏内的假标题与假列表项不产生节点", () => {
    const md = "# t\n\n- a\n```md\n## 假标题\n- 假条目\n```\n";
    const doc = parse(md, "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual([
      "```md",
      "## 假标题",
      "- 假条目",
      "```",
    ]);
  });

  it("带前导空格的标题不认，进 continuation", () => {
    const doc = parse("# t\n\n- a\n  ## 不是标题\n", "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["  ## 不是标题"]);
  });

  it("标题与列表之间的空行进标题节点的 continuation", () => {
    const doc = parse("# t\n\n- a\n", "我的导图.md");
    expect(doc.root.continuation).toEqual([""]);
  });

  it("id 按文档顺序分配，根为 n0", () => {
    const doc = parse("# t\n\n- a\n## A\n\n- b\n", "我的导图.md");
    expect(doc.root.id).toBe("n0");
    expect(doc.root.children.map((c) => c.id)).toEqual(["n1", "n2"]);
    expect(doc.root.children[1].children.map((c) => c.id)).toEqual(["n3"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/parser.test.ts -t "标题参与层级"`
Expected: FAIL —— 大部分用例拿到的 `doc.root.children` 是空数组或只有 `["a"]`，因为 `## A` 仍然终止扫描。

- [ ] **Step 3: 新增 CORPUS 语料**

在 `tests/roundtrip.test.ts` 的 `CORPUS` 末尾追加（`// 标题参与层级` 注释一行说明）：

```ts
  // 标题参与层级后新增的字节级回归。前四条覆盖层级归属，后四条覆盖
  // 「非节点行原样重放」——它们在改造前走的是 tail 分支，改造后走 continuation，
  // 两条路径都必须逐字节还原。
  "# t\n\n## A\n\n- a\n",
  "# t\n\n### C\n\n## D\n\n- d\n",
  "# t\n\n# X\n\n## Y\n\n- y\n",
  "## A\n\n- a\n",
  "# t\n\n- a\n## A\n\n- b\n",
  "# t\n\n## A\n\n说明段落\n\n- a\n",
  "# t\n\n- a\n```md\n## 假标题\n- 假条目\n```\n",
  "# t\n\n- a\n  ## 不是标题\n- b\n",
  "# t\n\n## A\n### B\n#### C\n\n- c\n",
  "# t\n\n## (p1) A\n\n- a\n",
  "# t\n\n## A ##\n\n- a\n",
  "# t\n\n- a\n\n## A\n\n- b\n",
```

`CORPUS` 里已有的 `"# t\n\n- a\n## 附录\n\n正文\n"` 一条**不要动**：它改造前走 tail、改造后 `## 附录` 成为节点且 `正文` 进它的 continuation，两种情形下都必须逐字节还原。这条是本 task 最有价值的回归断言。

- [ ] **Step 4: 跑 roundtrip 确认失败**

Run: `npx vitest run tests/roundtrip.test.ts`
Expected: FAIL —— 新增语料里含标题的那几条写回后丢字节（标题行不写、或列表缩进错）。

- [ ] **Step 5: 重写 parser 的扫描层**

`src/model/parser.ts` 顶部的正则改为：

```ts
/** 顶格的 ATX 标题，`#` 与文字之间必须有空白。
 *  要求空白是 `#tag` 不被误判成标题的原因；要求顶格是列表续行里的
 *  `  ## x` 不被误判成标题的原因。两者都是刻意的（见设计文档 8）。 */
const HEADING_RE = /^(#{1,6}[ \t]+)(.*)$/;
const LIST_ITEM_RE = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
```

删除 `ANY_HEADING_RE`、`ORDERED_ITEM_RE`、`FENCE_RE`、`TRAILING_BLANK_RE` 之外不再使用的项（`TRAILING_BLANK_RE` 仍要用于切标题的尾随空白）。有序列表不再需要专门的正则——它落进「非节点行」这一类。

把 `ListItemLine` 与 `scanListBlock` 整体替换为：

```ts
interface HeadingEntry {
  kind: "heading";
  level: number;
  prefix: string;
  text: string;
  suffix: string;
  continuation: string[];
}

interface ItemEntry {
  kind: "item";
  /** 原始缩进字符串，逐字保留（tab 与空格不折算） */
  indent: string;
  depthWidth: number;
  bullet: Bullet;
  text: string;
  continuation: string[];
}

type ScanEntry = HeadingEntry | ItemEntry;

/** 判断一行是否闭合当前围栏：同字符、长度不小于开围栏、且行内无其他内容。 */
function closesFence(line: string, marker: string): boolean {
  const match = FENCE_CLOSE_RE.exec(line);
  if (match === null) return false;
  return match[1][0] === marker[0] && match[1].length >= marker.length;
}

/**
 * 对正文（已剥掉 frontmatter）做一次线性扫描，切成标题条目与列表项条目。
 *
 * 非节点行（散文、有序列表、表格、围栏、缩进续行）一律落进「当前条目」的
 * continuation；还没有任何条目时落进 preamble。围栏内的行绝不产生节点——
 * 改造前 FENCE_RE 一命中就终止扫描，所以代码块里的 `## 假标题` 从来不构成
 * 威胁；现在扫描不再终止，这个状态机是必需的。
 */
function scanDocument(lines: string[]): { entries: ScanEntry[]; preamble: string[] } {
  const entries: ScanEntry[] = [];
  const preamble: string[] = [];
  let fenceMarker: string | null = null;

  // 文件以换行结尾时 split 产生的末尾空串不是真实空行，不参与扫描。
  // 不以换行结尾的文件因此会在写回时补上尾换行——这是归一化第 1 条。
  const end =
    lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

  const sink = (line: string): void => {
    if (entries.length === 0) preamble.push(line);
    else entries[entries.length - 1].continuation.push(line);
  };

  let i = 0;
  while (i < end) {
    const line = lines[i];

    if (fenceMarker !== null) {
      sink(line);
      if (closesFence(line, fenceMarker)) fenceMarker = null;
      i++;
      continue;
    }

    const fence = FENCE_OPEN_RE.exec(line);
    if (fence !== null) {
      sink(line);
      fenceMarker = fence[1];
      i++;
      continue;
    }

    if (line.trim() === "") {
      let j = i + 1;
      while (j < end && lines[j].trim() === "") j++;
      // 归一化第 2 条：两个列表项之间的空行被丢弃（松散列表压缩成紧凑列表）。
      // 只在前一个条目也是列表项时才丢——`# t` 与 `- a` 之间那个空行是
      // 标题节点的 continuation，丢了就产生未获许可的字节差异。
      const previous = entries[entries.length - 1];
      if (
        j < end &&
        LIST_ITEM_RE.test(lines[j]) &&
        previous !== undefined &&
        previous.kind === "item"
      ) {
        i = j;
        continue;
      }
      for (let k = i; k < j; k++) sink(lines[k]);
      i = j;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const body = heading[2];
      const suffix = (TRAILING_BLANK_RE.exec(body) as RegExpExecArray)[0];
      entries.push({
        kind: "heading",
        level: heading[1].replace(/[ \t]+$/, "").length,
        prefix: heading[1],
        text: body.slice(0, body.length - suffix.length),
        suffix,
        continuation: [],
      });
      i++;
      continue;
    }

    const item = LIST_ITEM_RE.exec(line);
    if (item !== null) {
      entries.push({
        kind: "item",
        indent: item[1],
        depthWidth: indentWidth(item[1]),
        // 正则第 2 组只可能匹配到 `-`/`*`/`+` 三者之一，这里的断言是把这一点
        // 从正则转达给类型系统，不是运行时判断。
        bullet: item[2] as Bullet,
        text: item[3],
        continuation: [],
      });
      i++;
      continue;
    }

    sink(line);
    i++;
  }

  return { entries, preamble };
}
```

- [ ] **Step 6: 重写 buildTree（标题栈 + 列表栈）**

`detectIndentUnit` / `detectIndentUnitString` 的函数体不动，只把参数类型从 `ListItemLine[]` 改成 `ItemEntry[]`。

`buildTree` 整体替换为：

```ts
/** entries 里连续的列表项条目构成一个块。块内缩进基准取块首项。 */
function itemBlocks(entries: readonly ScanEntry[]): ItemEntry[][] {
  const blocks: ItemEntry[][] = [];
  let current: ItemEntry[] | null = null;
  for (const entry of entries) {
    if (entry.kind === "item") {
      if (current === null) {
        current = [];
        blocks.push(current);
      }
      current.push(entry);
    } else {
      current = null;
    }
  }
  return blocks;
}

/**
 * 按文档顺序把扁平条目组装成树。
 *
 * 标题栈决定标题的归属：level 为 L 的标题挂到栈里最近的 level < L 的标题下，
 * 找不到就挂到根下。因此跳级（H1→H3）、第二个 H1、无 H1 以 H2 开头三种情形
 * 都有确定行为，且树深度与标题 level 不再严格对应——这不构成问题，序列化
 * 重放 prefix，不从 level 重算 `#`（见设计文档 5.1）。
 *
 * 列表项挂到最近的标题节点下，块内相对深度按该块首项的缩进为基准逐块计算。
 * id 按文档顺序分配，等于前序，与 AGENTS.md 第 4 条一致。
 */
function buildTree(entries: readonly ScanEntry[], root: MindNode): void {
  const blockOf = new Map<ItemEntry, ItemEntry[]>();
  for (const block of itemBlocks(entries)) {
    for (const item of block) blockOf.set(item, block);
  }

  let nextId = 1;
  /** headingStack[0] 恒为根节点。根的 level 视为 1。 */
  const headingStack: { node: MindNode; level: number }[] = [{ node: root, level: 1 }];
  /** 当前列表块的栈，listStack[d] 是块内深度 d 的最近节点；遇到标题即清空。 */
  let listStack: MindNode[] = [];
  let base = 0;
  let unit = 2;

  for (const entry of entries) {
    if (entry.kind === "heading") {
      while (
        headingStack.length > 1 &&
        headingStack[headingStack.length - 1].level >= entry.level
      ) {
        headingStack.pop();
      }
      const parent = headingStack[headingStack.length - 1].node;
      const node: MindNode = {
        id: `n${nextId++}`,
        // 标题行没有承载行内标记的位置，刻意不调 parseMarks：`## (p1) A` 里的
        // `(p1)` 就是标题文字的一部分（见 AGENTS.md 第 8 条）。
        text: entry.text,
        marks: {},
        children: [],
        collapsed: false,
        continuation: entry.continuation,
        bullet: "-",
        heading: {
          level: entry.level,
          prefix: entry.prefix,
          suffix: entry.suffix,
          indentUnit: null,
        },
      };
      parent.children.push(node);
      headingStack.push({ node, level: entry.level });
      listStack = [];
      continue;
    }

    const block = blockOf.get(entry);
    if (listStack.length === 0) {
      listStack = [headingStack[headingStack.length - 1].node];
      base = block === undefined ? entry.depthWidth : block[0].depthWidth;
      unit = block === undefined ? 2 : detectIndentUnit(block);
    }

    const raw = Math.round((entry.depthWidth - base) / unit) + 1;
    const depth = Math.max(1, Math.min(raw, listStack.length));
    const { marks, rest } = parseMarks(entry.text);

    const node: MindNode = {
      id: `n${nextId++}`,
      text: rest,
      marks,
      children: [],
      collapsed: false,
      continuation: entry.continuation,
      bullet: entry.bullet,
    };

    listStack[depth - 1].children.push(node);
    listStack.length = depth;
    listStack.push(node);
  }
}
```

- [ ] **Step 7: 重写 parse**

`parse` 的主体替换为（frontmatter 剥离段不变）：

```ts
  const lines = rest.split("\n");
  const { entries, preamble } = scanDocument(lines);

  // 只有当文件的第一个节点行就是一个 H1 时，它才充当根节点。第一个节点行是
  // 列表项、或是 H2+ 时，根节点是文件名的虚拟节点（hasHeading = false），
  // 那个 H2 成为它的子节点——这正是「文件里出现 ## 就只剩空根」的修复路径。
  // 先取出局部 const 再判别：TS 不会从 `entries[0]?.kind === "heading"` 这种
  // 元素访问上收窄 `entries[0]` 的类型，直接写三元会拿不到 HeadingEntry。
  const first = entries[0];
  const rootEntry =
    first !== undefined && first.kind === "heading" && first.level === 1 ? first : null;
  const hasHeading = rootEntry !== null;
  const bodyEntries = hasHeading ? entries.slice(1) : entries;

  // indentUnit 只依赖条目，不依赖树，所以在构造 root 之前先算出来，
  // 这样能直接写进 root.heading 的字面量里，不需要事后回填加类型断言。
  const firstBlock = itemBlocks(bodyEntries)[0];
  const indentUnit = firstBlock === undefined ? "  " : detectIndentUnitString(firstBlock);

  const root: MindNode = {
    id: "n0",
    text: hasHeading ? rootEntry.text : fileName.replace(/\.md$/, ""),
    marks: {},
    children: [],
    collapsed: false,
    continuation: hasHeading ? rootEntry.continuation : [],
    // 根节点自身没有列表行；这里存的是「文件里第一个列表项用的标记字符」，
    // 供 tree-ops 给根的新直接子节点挑一个和现有兄弟一致的标记（见 makeNode）。
    bullet: entries.find((e): e is ItemEntry => e.kind === "item")?.bullet ?? "-",
    heading: {
      level: 1,
      prefix: hasHeading ? rootEntry.prefix : "# ",
      suffix: hasHeading ? rootEntry.suffix : "",
      // Task 4 起改为按标题各自推断。这一步先沿用「整份文档一个单位」的旧语义。
      indentUnit,
    },
  };

  buildTree(bodyEntries, root);

  return {
    indentUnit,
    frontmatter,
    frontmatterFenceSuffix,
    hasHeading,
    root,
    preamble: preamble.map((line) => line + "\n").join(""),
    // 零个节点行时，正文全在 preamble 里；tail 只在这种情形下有内容。
    tail: entries.length === 0 ? "" : "",
  };
```

`tail` 这一行看着荒谬是因为它确实恒为空串——零个节点行时正文已经全进 `preamble`。**Step 8 会把 `tail` 从 `MindDoc` 里删掉**，这里先留一个恒空值让类型对齐、分两步走，是为了让 Step 7 的 diff 只包含扫描与建树的变化。

删掉 `sliceText` 函数（不再有人调用）。

- [ ] **Step 8: 删掉 `headingGap` 与 `tail`**

`src/model/types.ts` 的 `MindDoc` 删掉 `headingGap` 与 `tail`。`src/model/parser.ts` 的 `return` 去掉这两个键。`src/model/serializer.ts` 的 `out += doc.headingGap;` 与 `out += doc.tail;` 两行删掉。

`tests/roundtrip.test.ts` 的 `docArb` 删掉 `headingGap` 与 `tail` 两个键，断言段删掉对应两行；`preamble` 的生成器改为 `fc.constantFrom("", "说明文字\n\n")`，**并且在 `hasHeading` 为 false 时也允许非空**——改造后无标题文件的前导空行进 `preamble`，不再折进 `headingGap`。同时更新该处那段解释 `hasHeading` 分支的注释，它现在描述的是已经不存在的行为。

`tests/parser.test.ts` 里 `doc.headingGap` 的两处断言改成 `doc.root.continuation`；`preamble/headingGap/tail 不含 \r` 那个用例改成检查 `doc.preamble` 与 `doc.root.continuation.join("")`。

- [ ] **Step 9: serializer 前序遍历两种形态**

`serializeNodes` 替换为：

```ts
/**
 * 前序遍历写出子树。
 *
 * listDepth 是「从最近的标题祖先算起」的深度，不是树深度：一个 H3 下的一级
 * 列表项树深度是 3，而文件里的缩进是 0。标题节点把 listDepth 归零。
 */
function serializeNodes(
  nodes: readonly MindNode[],
  listDepth: number,
  indentUnit: string,
): string {
  let out = "";
  for (const node of nodes) {
    if (isHeading(node)) {
      // 永不从 level 重算 `#`，逐字重放 prefix（见设计文档 5.1）。
      out += `${node.heading.prefix}${node.text}${node.heading.suffix}\n`;
      for (const line of node.continuation) out += `${line}\n`;
      out += serializeNodes(node.children, 0, node.heading.indentUnit ?? indentUnit);
      continue;
    }
    // 用节点自己的 bullet 而不是固定的 `-`：`*`/`+` 同样是合法的 CommonMark
    // 列表标记，把它们改写成 `-` 会让一个只是被导图视图打开过的文件产生
    // 全量 diff（见 README「写回归一化」一节的承诺）。
    out += `${indentUnit.repeat(listDepth)}${node.bullet} ${composeLine(node)}\n`;
    for (const line of node.continuation) out += `${line}\n`;
    out += serializeNodes(node.children, listDepth + 1, indentUnit);
  }
  return out;
}
```

`serialize` 里根节点的子节点改为从 `listDepth` 0 起：

```ts
  out += serializeNodes(doc.root.children, 0, doc.root.heading?.indentUnit ?? doc.indentUnit);
```

- [ ] **Step 10: 跑测试确认通过**

Run: `npx vitest run tests/parser.test.ts tests/serializer.test.ts tests/roundtrip.test.ts`
Expected: PASS。若 `CORPUS` 里某条挂了，**先判断是实现错还是语料确实不该逐字节相等**——除了「同一标题下混用缩进」（Task 4 的语料，此刻不该存在）之外，所有语料都必须逐字节相等。不要放宽语料。

- [ ] **Step 11: 四条门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity
```

Expected: 全绿。

- [ ] **Step 12: 提交**

```bash
git add src/model/ tests/
git commit -m "feat: parser 改为全文线性扫描，标题参与层级"
```

---

### Task 4: 缩进单位按标题存储

消掉 Task 3 引入的保真度倒退：多个列表块共用一个全局 `indentUnit`，会把「`## A` 下 2 空格、`## B` 下 4 空格」的文件全文改写成 2 空格。

**Files:**
- Modify: `src/model/parser.ts`（每个块的单位写进它所属标题）
- Modify: `tests/roundtrip.test.ts`（新增语料）
- Test: `tests/parser.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `itemBlocks`、`buildTree`、`HeadingForm.indentUnit`
- Produces: `heading.indentUnit` 对每个标题各自有值；`serialize` 的继承链已在 Task 3 Step 9 就位，本 task 不改 serializer

- [ ] **Step 1: 写失败测试**

`tests/roundtrip.test.ts` 的 `CORPUS` 追加：

```ts
  // 不同标题名下用不同缩进单位是保真的，不触发归一化第 4 条。
  "# t\n\n## A\n\n- a\n  - b\n\n## B\n\n- c\n    - d\n",
  "# t\n\n## A\n\n- a\n\t- b\n\n## B\n\n- c\n  - d\n",
```

`tests/parser.test.ts` 追加（**这条不进 CORPUS**，因为它不是 round-trip 恒等的）：

```ts
describe("缩进单位按标题存储", () => {
  it("不同标题各自记住自己的缩进单位", () => {
    const md = "# t\n\n## A\n\n- a\n  - b\n\n## B\n\n- c\n    - d\n";
    const doc = parse(md, "我的导图.md");
    const [a, b] = doc.root.children;
    expect(a.heading?.indentUnit).toBe("  ");
    expect(b.heading?.indentUnit).toBe("    ");
  });

  it("同一标题下多个块单位不一致时，取第一个能推断出的", () => {
    const md = "# t\n\n## A\n\n- a\n  - b\n\n散文\n\n- c\n    - d\n";
    const doc = parse(md, "我的导图.md");
    expect(doc.root.children[0].heading?.indentUnit).toBe("  ");
    // 归一化第 4 条：第二个块被统一到第一个块的单位，不是逐字节相等
    expect(serialize(doc)).toBe("# t\n\n## A\n\n- a\n  - b\n\n散文\n\n- c\n  - d\n");
  });

  it("标题下没有列表块时 indentUnit 为 null，序列化向上继承", () => {
    const doc = parse("# t\n\n- a\n\t- b\n\n## A\n", "我的导图.md");
    const heading = doc.root.children.find((c) => c.text === "A");
    expect(heading?.heading?.indentUnit).toBeNull();
    expect(doc.root.heading?.indentUnit).toBe("\t");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/parser.test.ts -t "缩进单位按标题存储" && npx vitest run tests/roundtrip.test.ts`
Expected: FAIL —— `b.heading?.indentUnit` 是 `null`（Task 3 只给根填了值），新增的两条 `CORPUS` 语料第二个块的缩进被改写。

- [ ] **Step 3: 块的单位写进所属标题**

`buildTree` 里，`listStack.length === 0` 那个分支在算 `base` / `unit` 之后追加一句：把块的字面单位写进当前标题（仅当该标题还没有单位时，实现「取第一个能推断出的块」）：

```ts
    if (listStack.length === 0) {
      const owner = headingStack[headingStack.length - 1].node;
      listStack = [owner];
      base = block === undefined ? entry.depthWidth : block[0].depthWidth;
      unit = block === undefined ? 2 : detectIndentUnit(block);
      // 一个标题下可能有多个被散文隔开的列表块，而 heading.indentUnit 只有一个
      // 槽位：取第一个能推断出单位的块。后续块按这个单位重新缩进，落在归一化
      // 第 4 条的「无法归纳出单一单位」情形里（见设计文档 4.3）。
      if (owner.heading !== undefined && owner.heading.indentUnit === null && block !== undefined) {
        owner.heading.indentUnit = detectIndentUnitString(block);
      }
    }
```

注意 `buildTree` 在这里就地改了 `owner.heading.indentUnit`。`parse` 是在建树时构造节点的，此刻还没有任何外部持有者，就地写入不违反不可变约定——`tree-ops` 的不可变要求约束的是**编辑操作**，不是解析期的构造。在 `buildTree` 的 doc 注释里写明这一点。

- [ ] **Step 4: root.heading.indentUnit 交给 buildTree**

根就是 `headingStack[0]`，所以 Step 3 那段逻辑已经会填它。把 `parse` 里 root 字面量的 `indentUnit` 从 Task 3 的 `indentUnit` 改成 `null`，让 `buildTree` 统一负责——否则根会被 Task 3 那个「文档第一个块」的值抢先占住槽位，与「取本标题名下第一个块」的规则不一致（根名下可能根本没有列表块）。

`parse` 里那两行 `firstBlock` / `indentUnit` 保留不动：`MindDoc.indentUnit` 降级为兜底值，只在整条标题祖先链都没有单位时被 `serialize` 用到。

同时更新 `src/model/types.ts` 里 `MindDoc.indentUnit` 的注释，说明它已降级为兜底值，真正生效的是 `HeadingForm.indentUnit`。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/parser.test.ts tests/roundtrip.test.ts tests/serializer.test.ts`
Expected: PASS

- [ ] **Step 6: 四条门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity
```

Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/model/ tests/
git commit -m "fix: 缩进单位按标题存储，不同标题名下的列表块各自保真"
```

---

### Task 5: 对抗性输入测试

`parser.ts` 现在是一个带状态机的手写扫描器。按 AGENTS.md 门禁一节，只交正确性测试不够，必须同时有时间上限断言和结构化输出断言。

**Files:**
- Modify: `tests/parser.test.ts`

**Interfaces:**
- Consumes: Task 4 之后的 `parse`
- Produces: 无新接口

- [ ] **Step 1: 写测试**

在 `tests/parser.test.ts` 末尾追加。参照 `tests/inline.test.ts` 的「性能回归」describe 块的写法：

```ts
describe("对抗性输入", () => {
  /** 断言解析耗时上限，同时断言输出没有退化成「整篇都是 continuation」。 */
  const parseWithin = (md: string, ms: number): ReturnType<typeof parse> => {
    const started = Date.now();
    const doc = parse(md, "我的导图.md");
    expect(Date.now() - started).toBeLessThan(ms);
    return doc;
  };

  it("每行都是标题的长文件：线性时间，层级正确", () => {
    const md = "# t\n" + Array.from({ length: 4000 }, (_, i) => `## A${i}\n`).join("");
    const doc = parseWithin(md, 1000);
    // 结构化断言：4000 个 H2 全部成为根的子节点，不是被吞成 continuation
    expect(doc.root.children).toHaveLength(4000);
    expect(doc.root.children[3999].text).toBe("A3999");
    expect(doc.root.continuation).toEqual([]);
  });

  it("标题与列表交替的长文件：块边界正确", () => {
    const md =
      "# t\n" +
      Array.from({ length: 2000 }, (_, i) => `## A${i}\n- a${i}\n  - b${i}\n`).join("");
    const doc = parseWithin(md, 1000);
    expect(doc.root.children).toHaveLength(2000);
    const last = doc.root.children[1999];
    expect(last.children.map((c) => c.text)).toEqual(["a1999"]);
    expect(last.children[0].children.map((c) => c.text)).toEqual(["b1999"]);
  });

  it("大量未闭合围栏：不产生节点，不卡死", () => {
    const md = "# t\n\n- a\n" + "```\n".repeat(8000);
    const doc = parseWithin(md, 1000);
    // 第一个 ``` 开围栏，之后每一行都在围栏内（``` 会闭合再开，交替）——
    // 无论如何都不该产生任何新节点
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toHaveLength(8000);
  });

  it("深层嵌套列表：深度被 listStack 长度夹住，不抛异常", () => {
    const md =
      "# t\n\n" +
      Array.from({ length: 3000 }, (_, i) => `${"  ".repeat(i)}- a${i}\n`).join("");
    const doc = parseWithin(md, 2000);
    // 结构化断言：确实建出了 3000 层，不是全部拍平到根下
    let node = doc.root;
    let depth = 0;
    while (node.children.length > 0) {
      node = node.children[0];
      depth++;
    }
    expect(depth).toBe(3000);
  });

  it("上述四条输入全部 round-trip", () => {
    const inputs = [
      "# t\n" + Array.from({ length: 500 }, (_, i) => `## A${i}\n`).join(""),
      "# t\n" + Array.from({ length: 500 }, (_, i) => `## A${i}\n- a${i}\n  - b${i}\n`).join(""),
      "# t\n\n- a\n" + "```\n".repeat(500),
      "# t\n\n" + Array.from({ length: 500 }, (_, i) => `${"  ".repeat(i)}- a${i}\n`).join(""),
    ];
    for (const md of inputs) {
      expect(serialize(parse(md, "我的导图.md"))).toBe(md);
    }
  });
});
```

`tests/parser.test.ts` 需要 `import { serialize } from "../src/model/serializer";`（最后一个用例要用）。

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/parser.test.ts -t "对抗性输入"`
Expected: PASS。

若「深层嵌套列表」抛 `Maximum call stack size exceeded`，那是 `serializeNodes` 的递归深度问题（3000 层），**不要靠调小语料规模来绕过**——记录实际能承受的深度，把它作为一条已知局限写进 Task 8 的 README 局限清单，并把语料调到该深度的 80% 作为回归基线。`parse` 侧的 `buildTree` 是迭代的，不受此限。

- [ ] **Step 3: 四条门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity
```

- [ ] **Step 4: 提交**

```bash
git add tests/parser.test.ts
git commit -m "test: parser 加对抗性长输入测试（时间上限 + 结构化断言）"
```

---

### Task 6: tree-ops 的标题约束与 list-before-heading 不变量

**Files:**
- Modify: `src/model/tree-ops.ts`
- Test: `tests/tree-ops.test.ts`

**Interfaces:**
- Consumes: `isHeading`（Task 1）
- Produces:
  - `firstHeadingIndex(children: readonly MindNode[]): number` —— 不导出，模块内部辅助
  - `addChild` 对标题父节点把新节点插在第一个标题子节点之前
  - `addSibling` 对标题节点是 no-op
  - `removeNode` 对标题节点是 no-op（返回原 root，`nextSelectionId` 为传入 id）
  - `moveNode` 拒绝标题节点作为源；落点索引对 `firstHeadingIndex` clamp
  - `setMarks` / `toggleMark` 的拒绝条件从「id 等于根 id」改为「目标是标题节点」

- [ ] **Step 1: 写失败测试**

`tests/tree-ops.test.ts` 末尾追加：

```ts
import { isHeading } from "../src/model/types";

/** 造一棵 `# t` / `- a` / `## H` / `- b` 的树。 */
function headingTree(): MindNode {
  return parse("# t\n\n- a\n## H\n\n- b\n", "我的导图.md").root;
}

describe("标题节点的编辑约束", () => {
  it("addChild 到标题父节点：新节点插在第一个标题子节点之前", () => {
    const root = headingTree();
    const { root: next, newId } = addChild(root, root.id, "新");
    expect(next.children.map((c) => c.text)).toEqual(["a", "新", "H"]);
    expect(isHeading(next.children[1])).toBe(false);
    expect(next.children[1].id).toBe(newId);
  });

  it("addChild 到标题节点自己没有列表子节点时插在最前", () => {
    const root = parse("# t\n\n## H\n", "我的导图.md").root;
    const { root: next } = addChild(root, root.id, "新");
    expect(next.children.map((c) => c.text)).toEqual(["新", "H"]);
  });

  it("addChild 到列表项父节点：追加到末尾，行为不变", () => {
    const root = headingTree();
    const a = root.children[0];
    const { root: next } = addChild(root, a.id, "新");
    expect(next.children[0].children.map((c) => c.text)).toEqual(["新"]);
  });

  it("addSibling 对标题节点是 no-op", () => {
    const root = headingTree();
    const h = root.children[1];
    const { root: next, newId } = addSibling(root, h.id, "新");
    expect(next).toBe(root);
    expect(newId).toBe(h.id);
  });

  it("removeNode 对标题节点是 no-op", () => {
    const root = headingTree();
    const h = root.children[1];
    const { root: next, nextSelectionId } = removeNode(root, h.id);
    expect(next).toBe(root);
    expect(nextSelectionId).toBe(h.id);
  });

  it("moveNode 拒绝标题节点作为源", () => {
    const root = headingTree();
    const h = root.children[1];
    expect(moveNode(root, h.id, root.id, 0)).toBe(root);
  });

  it("moveNode 落点索引不得越过第一个标题子节点", () => {
    const root = headingTree();
    const b = root.children[1].children[0];
    // 要求插到根的 index 2（即 H 之后），必须被夹到 1
    const next = moveNode(root, b.id, root.id, 2);
    expect(next.children.map((c) => c.text)).toEqual(["a", "b", "H"]);
  });

  it("setMarks / toggleMark 对标题节点是 no-op", () => {
    const root = headingTree();
    const h = root.children[1];
    expect(setMarks(root, h.id, { priority: 1 })).toBe(root);
    expect(toggleMark(root, h.id, { priority: 1 })).toBe(root);
  });

  it("setMarks 对列表项照常生效", () => {
    const root = headingTree();
    const a = root.children[0];
    expect(setMarks(root, a.id, { priority: 1 }).children[0].marks).toEqual({ priority: 1 });
  });

  it("toggleCollapse 对标题节点照常生效", () => {
    const root = headingTree();
    const h = root.children[1];
    expect(toggleCollapse(root, h.id).children[1].collapsed).toBe(true);
  });
});
```

`tests/tree-ops.test.ts` 需要 `import { parse } from "../src/model/parser";`（若尚未 import）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/tree-ops.test.ts -t "标题节点的编辑约束"`
Expected: FAIL —— `addChild` 把新节点追加到了 `["a", "H", "新"]`；`addSibling` / `removeNode` / `moveNode` 照常执行；`setMarks` 对非根的标题节点生效。

- [ ] **Step 3: 加辅助函数与 makeNode 的形态保证**

`src/model/tree-ops.ts` 顶部 import 改为 `import { isHeading, type Bullet, type Marks, type MindNode } from "./types";`。

在 `makeNode` 之后插入：

```ts
/** 标题子节点的起始下标；没有标题子节点时等于 children.length。
 *
 *  list-before-heading 不变量：一个标题节点的 children 里，列表项形态的子节点
 *  必须全部排在标题形态的子节点之前。`# t` 的子节点若排成
 *  `[- a, ## A, - new]`，序列化出来 `- new` 落在 `## A` 之后，重新解析时它就
 *  跑进 A 名下了——一次「加子节点」静默改变了树的形状。所有插入位置都要对
 *  这个下标 clamp。 */
function firstHeadingIndex(children: readonly MindNode[]): number {
  const index = children.findIndex(isHeading);
  return index < 0 ? children.length : index;
}
```

`makeNode` 不需要改：它构造的对象不带 `heading`，天然是列表项形态。在它的注释里补一句「新节点永远是列表项形态：解析双向，写回单向（见设计文档决策 2）」。

- [ ] **Step 4: 改四个编辑函数**

`addChild` 的 `mapTree` 回调改为：

```ts
  const next = mapTree(root, (node) => {
    if (node.id !== parentId) return null;
    // 插在第一个标题子节点之前，维护 list-before-heading 不变量。
    // 父节点没有标题子节点时，这个下标就是末尾，行为与改造前一致。
    const children = [...node.children];
    children.splice(firstHeadingIndex(children), 0, child);
    return { ...node, collapsed: false, children };
  });
```

`addSibling` 在开头（`if (siblingId === root.id)` 之后）插入：

```ts
  // 列表项不能作标题的兄弟：`## A` 之后紧跟一个 `- x`，重新解析时 x 是 A 的
  // 第一个子节点而不是兄弟。与其静默改变语义，不如空操作（见设计文档 6.2）。
  const sibling = findNode(root, siblingId);
  if (sibling !== null && isHeading(sibling)) return { root, newId: siblingId };
```

（原来那行 `const sibling = makeNode(...)` 改名为 `const node = makeNode(...)` 以免重名，`children.splice` 里跟着改。）

`removeNode` 在 `if (id === root.id)` 之后插入：

```ts
  // 标题节点会连带删掉图上不可见的 continuation（标题下的散文、代码块、
  // 表格都挂在它的 continuation 里），删了用户看不见的内容（见设计文档 6.2）。
  const target = findNode(root, id);
  if (target !== null && isHeading(target)) return { root, nextSelectionId: id };
```

`moveNode` 在 `const moving = findNode(root, id);` 之后插入：

```ts
  // 同 removeNode：标题节点携带不可见内容，且换父之后 heading.prefix 与新位置
  // 的层级不再对应。
  if (moving === null || isHeading(moving)) return root;
```

（原有的 `if (moving === null) return root;` 被这一行取代。）

`moveNode` 末尾的 `splice` 改为对 `firstHeadingIndex` 一起 clamp：

```ts
    const children = [...node.children];
    const limit = firstHeadingIndex(children);
    children.splice(Math.max(0, Math.min(index, limit)), 0, moving);
    return { ...node, collapsed: false, children };
```

`setMarks` / `toggleMark` 的拒绝条件改为按形态判断：

```ts
  // 标题行没有承载行内标记的位置，serializer 不会写出 heading 节点的 marks，
  // 写回时会静默丢失。所以在变更源头直接拒绝，保持空操作。
  // 判据是「是不是标题节点」而不是「是不是根」：根恒为标题形态，这条覆盖它，
  // 同时也覆盖文件里的 H2–H6（见 AGENTS.md 第 8 条）。
  const target = findNode(root, id);
  if (target === null || isHeading(target)) return root;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/tree-ops.test.ts`
Expected: PASS。原有用例里若有「对根节点 setMarks 是 no-op」之类的断言，它们继续通过（根恒为标题形态）。

- [ ] **Step 6: 四条门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity
```

- [ ] **Step 7: 提交**

```bash
git add src/model/tree-ops.ts tests/tree-ops.test.ts
git commit -m "feat: tree-ops 加标题节点约束与 list-before-heading 不变量"
```

---

### Task 7: 视图层的 `isHeading` 化

**这个 task 的验收包含人工验证。** 四条门禁看不到布局、渲染、指针与键盘行为（AGENTS.md「自动化测不到什么」）。实现报告必须区分机械验证与待人工确认，不得声称交互行为正确。

**Files:**
- Modify: `src/view/toolbar.ts`（`isRoot` → `isHeading`，两个按钮新增禁用）
- Modify: `src/view/node-el.ts:190-199`（`.mm-heading` 类）
- Modify: `src/view/drag.ts`（拒绝标题节点作为拖拽源）
- Modify: `src/view.ts:567,605-627,676-690`
- Modify: `styles.css`
- Modify: `docs/MANUAL-VERIFICATION.md`

**Interfaces:**
- Consumes: `isHeading`（Task 1）；`moveNode` 的新拒绝语义（Task 6）
- Produces: `toolbar.showFor(nodeEl, canCollapse, isHeadingNode)`；`buildNodeEl(node, depth, branch, isRoot, isHeadingNode, onOpenLink?, onToggleCollapse?)`

- [ ] **Step 1: toolbar 的谓词换名**

现有的三处 `disabled: (_canCollapse, isRoot) => isRoot` 正好挂在「添加兄弟节点」「删除节点」「标记」这三个按钮上——与设计文档 6.2 要禁用的三个完全一致。「文字样式」「插入链接」没有 `disabled`，也与 6.2 一致（标题行可以含行内 Markdown）。**所以这一步不需要新增任何禁用，只是把判据从「是根」放宽成「是标题」。**

`src/view/toolbar.ts`：`disabled?: (canCollapse: boolean, isRoot: boolean) => boolean` 的第二个参数改名为 `isHeadingNode`，`showFor` 的签名同步改名，三处 `(_canCollapse, isRoot) => isRoot` 改为 `(_canCollapse, isHeadingNode) => isHeadingNode`。「标记」按钮上那段注释里的「根节点是 H1 标题行」改为「标题节点（任意级别）」。

- [ ] **Step 2: node-el 加 `.mm-heading`**

`buildNodeEl` 的参数表在 `isRoot: boolean` 之后插入 `isHeadingNode: boolean`，`classes` 的构造改为：

```ts
  const classes = ["mm-node", depthClass(depth), branchClass(branch)];
  if (isRoot) classes.push("mm-root");
  // 标题节点不可删、不可拖、不能带标记，必须有视觉区分，否则用户不理解
  // 为什么按 Delete 没反应（见设计文档 7）。
  // 根节点也带这个类：drag.ts 用它做「不可拖」的判据，一个类覆盖根与
  // H2–H6，取代原来单独判 mm-root 的写法。视觉差异靠 CSS 的
  // `:not(.mm-root)` 排除根节点，根有自己的样式。
  if (isHeadingNode) classes.push("mm-heading");
  if (node.collapsed) classes.push("mm-collapsed");
```

- [ ] **Step 3: 调用方接上**

`grep -rn "buildNodeEl" src/` 找到调用点（在 `src/view/renderer.ts` 或 `src/view.ts`），传入 `isHeading(node)`。`src/view.ts:567` 的 `this.toolbar.showFor(element, node.children.length > 0, node.id === this.doc.root.id)` 第三个实参改为 `isHeading(node)`。

`src/view.ts` 顶部 import 加 `isHeading`。

- [ ] **Step 4: view.ts 的 commitText 分支改判据**

`src/view.ts:677` 的 `if (intent.id === doc.root.id)` 改为按形态判断：

```ts
        const target = findNode(doc.root, intent.id);
        if (target !== null && isHeading(target)) {
```

并更新那段注释：判据从「根节点（H1 标题行）」改为「标题节点（任意级别的标题行）」，理由不变。

- [ ] **Step 5: handleDrop 的落点索引 clamp**

`src/view.ts` 的 `handleDrop`：`zone === "child"` 分支里 `node.children.length` 作为落点索引会越过标题子节点，改为交给 `moveNode` 自己 clamp（Task 6 已实现），此处直接传 `node.children.length` 即可——`moveNode` 内部的 `Math.min(index, limit)` 会夹住。**在这里加一行注释说明依赖关系**，否则后来人会以为这是漏掉的 clamp：

```ts
      // 落点索引交给 moveNode clamp：它会把下标夹到第一个标题子节点之前，
      // 维护 list-before-heading 不变量（见 tree-ops.firstHeadingIndex）。
```

`before`/`after` 分支同理，不需要额外处理。

- [ ] **Step 6: drag.ts 拒绝标题节点作为源**

`drag.ts` 现在已经用 DOM 类做这件事，不需要新增 host 回调。`pointerdown` 里那行

```ts
    // 根节点不可拖动。
    if (nodeEl === null || id === undefined || nodeEl.hasClass("mm-root")) return;
```

改为

```ts
    // 标题节点不可拖动（根节点也带 mm-heading，见 node-el.ts）：它携带图上
    // 不可见的 continuation，换父之后 heading.prefix 与新位置的层级也不再对应。
    // tree-ops.moveNode 同样会拒绝标题源——那是正确性兜底，这里是让拖拽根本
    // 不启动，而不是拖到一半松手后毫无反应。
    if (nodeEl === null || id === undefined || nodeEl.hasClass("mm-heading")) return;
```

`mm-root` 的判断被 `mm-heading` 完全覆盖（Step 2 让根节点也带这个类），不要两个类都判。

- [ ] **Step 7: styles.css 加 `.mm-heading`**

```css
/* 标题节点：不可删、不可拖、不带标记，用比列表项更重的字重做区分。
   `:not(.mm-root)` 排除根节点——根也带 mm-heading（drag.ts 拿它当不可拖的
   判据），但根有自己的 .mm-root 样式，不该被这条覆盖。
   颜色取自 Obsidian 变量，不写颜色字面量（AGENTS.md 第 10 条）。 */
.mm-node.mm-heading:not(.mm-root) .mm-text {
  font-weight: var(--font-semibold);
  color: var(--text-normal);
}
```

- [ ] **Step 8: 机械验证**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity
```

Expected: 全绿。

- [ ] **Step 9: 人工验证清单加项**

`docs/MANUAL-VERIFICATION.md` 新增一节「标题节点」，逐条可勾选：

- 打开一份含 `## 章节` 的笔记，导图上出现标题节点，且与列表项在视觉上可区分
- 选中标题节点，工具栏的「标记」「删除」「加兄弟」三个按钮置灰
- 在标题节点上按 Tab，新节点出现在该标题**已有列表子节点之后、子标题之前**
- 在标题节点上按 Enter / Delete，什么都不发生（不报错、不闪烁）
- 尝试拖拽标题节点，拖拽不启动（不出现 ghost 与落点指示器）
- 把一个列表项拖到标题节点上（child 落点），它落在该标题的列表子节点末尾、子标题之前
- 双击标题节点改文字并回车，`.md` 文件里对应的 `## ` 行文字改变、`#` 个数与前后空白不变
- 在标题节点上折叠/展开，`mindmap-collapsed` frontmatter 随之更新
- 打开一份 `## A` 下用 2 空格、`## B` 下用 4 空格的笔记，什么都不改再切走，`git diff` 为空

- [ ] **Step 10: 提交**

```bash
git add src/view/ src/view.ts styles.css docs/MANUAL-VERIFICATION.md
git commit -m "feat: 视图层区分标题节点，标记/删除/加兄弟/拖拽按形态禁用"
```

---

### Task 8: 文档与示例文件

**Files:**
- Modify: `README.md`、`README.zh-CN.md`（数据格式、归一化第 4 条、已知局限、「与其他导图插件的区别」一节）
- Modify: `AGENTS.md`（第 2 条、第 8 条）
- Create: `examples/markmap-style.md`
- Modify: `tests/roundtrip.test.ts`（把示例文件纳入语料）

**Interfaces:**
- Consumes: 前七个 task 的全部行为
- Produces: 无代码接口

- [ ] **Step 1: 新建示例文件**

`examples/markmap-style.md`，覆盖标题层级的每一种情形，且**必须是规范形态**（`serialize(parse(md)) === md`）：

```markdown
---
mindmap: true
---

# 产品季度规划

导图之外的说明段落，插件原样保留、不显示。

## 需求梳理

- (p1 67%) 用户访谈
  - (p2) 招募 12 位重度用户
  - (p2 50%) 访谈提纲评审
- (p3) 竞品功能矩阵

## 技术方案

### 数据层

- (p1) 索引重建策略
  - (flag:red) 迁移期间的双写窗口

### 接口层

- (p2 33%) 分页协议对齐
- (p4 0%) 错误码梳理

## 排期

1. 这是有序列表，不产生节点，原样保留

- (p1 83%) 里程碑一
- (p5) 里程碑二
```

- [ ] **Step 2: 把示例纳入 round-trip 语料**

`tests/roundtrip.test.ts` 顶部加 `import { readFileSync } from "node:fs";`，在 `CORPUS` 的 `describe` 之后追加：

```ts
describe("示例文件是规范形态", () => {
  for (const name of ["conference-talk.md", "markmap-style.md"]) {
    it(name, () => {
      const md = readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
      expect(serialize(parse(md, name))).toBe(md);
    });
  }
});
```

Run: `npx vitest run tests/roundtrip.test.ts -t "示例文件是规范形态"`
Expected: PASS。若 `markmap-style.md` 挂了，改示例文件让它成为规范形态，**不要**改 `parse`/`serialize` 去迁就示例。

- [ ] **Step 3: 改 README 的「数据格式」一节**

把「第一个级别 1 标题是根节点，其后第一段连续无序列表是树」改写为标题参与层级的规则，覆盖：

- 顶格的 `#`–`######` 与嵌套无序列表共同构成层级
- 文件第一个节点行是 H1 时它是根节点；否则根节点取文件名，第一个标题成为它的子节点
- 标题层级归属：level L 的标题挂到最近的 level < L 的标题下，找不到就挂到根下（跳级、第二个 H1 各举一例）
- 标题节点不可删、不可拖、不能带标记、按 Enter 无动作；新建节点永远是列表项
- 标题下的散文、有序列表、表格、代码块、图片不显示，原样保留

- [ ] **Step 4: 改 README 的「写回归一化」第 4 条**

改为：

> 4. 缩进单位按标题各自推断、各自保真。两种情形下会被改写为每层 2 空格：某个列表块**内部**混用、无法归纳出单一单位；或**同一个标题名下**的多个列表块彼此单位不一致（统一到第一个能推断出的单位）。不同标题名下使用不同单位是保真的。

- [ ] **Step 5: 改 README 的已知局限**

新增一节，逐条列出设计文档第 8 节的六条：不带空格的 `##`、Setext 标题、ATX 闭合序列 `## A ##`、带前导空格的标题、有序列表/表格/代码块/图片不产生节点、列表块边界与 CommonMark 的分歧（含 4 空格缩进那条）。若 Task 5 Step 2 发现了序列化的递归深度上限，把它作为第七条加在这里。

- [ ] **Step 6: 改 README 的「与其他导图插件的区别」**

现在这一节说 markmap 系插件是只读预览。这句仍然成立，但要补一句本插件现在与它们的层级语义对齐，从那些插件迁移过来的笔记可以直接编辑；同时说明不支持 markmap 的私有方言（`markmap:` frontmatter 选项、`<!-- markmap: fold -->` 魔法注释），并给出理由（折叠状态若有两个来源，写回时必须裁决谁赢，与五条归一化的承诺冲突）。

`README.zh-CN.md` 同步全部改动。

- [ ] **Step 7: 改 AGENTS.md 第 2 条**

第 4 小条改为与 README 一致的新措辞。并在这一条末尾追加一句：

> 标题行的 `#` 个数永不重算：`serialize` 逐字重放 `heading.prefix`。任何形如 `"#".repeat(level)` 的代码都是缺陷——层级归属规则与文件字节必须保持解耦（见 `docs/superpowers/specs/2026-09-04-markmap-hierarchy-design.md` 5.1）。

- [ ] **Step 8: 改 AGENTS.md 第 8 条**

标题从「根节点永不携带标记」改为「标题节点永不携带标记」。正文里「H1 行」改为「标题行（任意级别）」，「对根 id 是 no-op」改为「对标题节点是 no-op」，并说明判据是 `isHeading` 而不是「id 等于根 id」，理由是根恒为标题形态、这条谓词同时覆盖根与文件里的 H2–H6。追加一句：`list-before-heading` 不变量的存在理由（一次「加子节点」会静默改变树形状），指向 `tree-ops.firstHeadingIndex`。

- [ ] **Step 9: 改 AGENTS.md 的「一句话架构」**

`.md` → `parse` 那一行补一句：`parse` 是带围栏状态机的全文线性扫描，标题与列表项都产生节点。

- [ ] **Step 10: 四条门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity
```

- [ ] **Step 11: 提交**

```bash
git add README.md README.zh-CN.md AGENTS.md examples/markmap-style.md tests/roundtrip.test.ts
git commit -m "docs: 标题参与层级的格式说明、局限清单与 markmap 风格示例"
```

---

## 收尾

八个 task 全部完成后：

1. 跑一遍完整门禁，记录 `npm test` 的用例数。
2. 在真实 Obsidian（或 `test-vault`）里走完 `docs/MANUAL-VERIFICATION.md` 新增的「标题节点」一节。**这一节没走完之前，不要声称这个特性可用。**
3. 用一份真实的、git 跟踪的 markmap 风格笔记做写回验证：用导图视图打开、什么都不改、切走，`git diff` 必须为空。
4. 版本号与发布不在本计划范围内（`manifest.json` / `versions.json` / tag 三处同步是单独一次动作）。
