# 有序列表参与层级 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `1.` / `1)` 形式的有序列表项与无序列表项完全等同地产生导图节点——可编辑、可拖拽、可加兄弟/子节点、可删除、可打标记。

**Architecture:** 在 `MindNode` 上加一个可选字段 `ordered?: OrderedForm`（与既有的 `heading?: HeadingForm` 同构），存下文件里的原始序号与分隔符；`parser` 新增一条有序列表正则并把形态填进节点，`serializer` 写回时二选一地写出标记，`tree-ops` 在四个结构变更点上调用新增的纯函数 `renumber` 重排受影响的那一段序号。`src/view/**` 与 `styles.css` 一行不改。

**Tech Stack:** TypeScript（`strict: true`，不用 `any`）、Vitest、fast-check、esbuild。

设计文档：[docs/superpowers/specs/2026-09-11-ordered-list-design.md](../specs/2026-09-11-ordered-list-design.md)。任务里凡是提到「设计文档第 N 节」的，指的都是它。

## Global Constraints

- **AGENTS.md 第 2 条：只允许五条写回归一化。** 任何新的字节差异都是缺陷。本次唯一新增的触发面是设计文档第 7 节那一条（混排异宽兜底 2 空格），它落在既有的归一化第 4 条里。
- **`tests/roundtrip.test.ts` 的 `CORPUS` 只能加不能放宽。** 不要为了让测试过而删语料、改语料或收窄 fast-check 生成器。
- **`src/model/**` 不得 `import obsidian`，不得出现 `document` / `window` / `HTMLElement`。** `npm run check:purity` 强制校验。
- **TypeScript `strict: true`，不用 `any`。** 必要时 `unknown` + 类型守卫。
- **面向用户的字符串一律走 `t()`（`src/i18n.ts`）**，中英两份都要改。`npm run check:i18n` 扫到写死中文即失败。
- **`serialize` 永不从 `heading.level` 重算 `#` 的个数。** 本次不碰标题分支，但不要顺手"整理"它。
- **每个任务结束前四条门禁全绿**：`npm run typecheck`、`npm test`、`npm run build`、`npm run check:purity`、`npm run check:i18n`。
- **提交信息用中文**，结尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/model/types.ts` | 修改 | 新增 `OrderedForm` 接口与 `isOrdered` 判别函数；给 `MindNode` 加 `ordered?` 字段 |
| `src/model/serializer.ts` | 修改 | 列表项分支按形态二选一写出标记 |
| `src/model/parser.ts` | 修改 | 新增 `ORDERED_ITEM_RE` 与 `matchItem`；`ItemEntry` 带 `ordered`；松散列表压缩加同类守卫；根节点回填 `ordered` |
| `src/model/tree-ops.ts` | 修改 | 新增 `renumber` 与 `orderedRuns`；`makeNode` 改收标记形态；四个结构变更点接上 `renumber` |
| `src/i18n.ts` | 修改 | 删除提示语里去掉「有序列表」，中英两份 |
| `src/view/toolbar.ts` | 修改 | 仅注释 |
| `tests/serializer.test.ts` | 修改 | 有序标记的写出 |
| `tests/parser.test.ts` | 修改 | 有序项的识别边界 |
| `tests/tree-ops.test.ts` | 修改 | `renumber` 的六个场景与形态继承 |
| `tests/roundtrip.test.ts` | 修改 | 新增 `CORPUS` 语料、新增非恒等断言、fast-check 生成器扩展 |
| `examples/conference-talk.md` | 修改 | 那行「有序列表永不成为节点」的演示内容作废，换成真正的有序列表演示 |
| `README.md` / `README.zh-CN.md` | 修改 | 已知限制、隐形携带、层级模型、写回归一化四处 |
| `AGENTS.md` | 修改 | 一句话架构、第 2 条、第 4 条 |
| `docs/MANUAL-VERIFICATION.md` | 修改 | 去掉「有序列表」那处列举，新增两条有序列表人工验证项 |

---

### Task 1: `OrderedForm` 数据模型与序列化

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/model/serializer.ts:54`
- Test: `tests/serializer.test.ts`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces:
  - `interface OrderedForm { number: number; delim: "." | ")" }`（`src/model/types.ts` 导出）
  - `MindNode.ordered?: OrderedForm`
  - `function isOrdered(node: MindNode): node is MindNode & { ordered: OrderedForm }`（`src/model/types.ts` 导出）

这个任务只让 `serialize` **认识**有序形态。还没有任何代码会产出 `ordered` 字段，所以现有测试全部照旧通过。

- [ ] **Step 1: 写失败的测试**

在 `tests/serializer.test.ts` 末尾追加。注意 import 里要加上 `type MindNode`（文件顶部已有 `import { parse } ...` 之类，按现有风格补）：

```ts
import type { MindNode } from "../src/model/types";

/** 手搭一个最小的列表项节点，避开 parser（此刻它还不认识有序项）。 */
function item(text: string, extra: Partial<MindNode> = {}): MindNode {
  return {
    id: "n1",
    text,
    marks: {},
    children: [],
    collapsed: false,
    continuation: [],
    bullet: "-",
    ...extra,
  };
}

function docWith(children: MindNode[]): MindDoc {
  return {
    indentUnit: "  ",
    frontmatter: null,
    frontmatterFenceSuffix: "",
    hasHeading: true,
    root: {
      id: "n0",
      text: "t",
      marks: {},
      children,
      collapsed: false,
      continuation: [],
      bullet: "-",
      heading: { level: 1, prefix: "# ", suffix: "", indentUnit: null },
    },
    preamble: "",
  };
}

describe("有序列表标记的写出", () => {
  it("有序节点写出自己的号与分隔符", () => {
    const doc = docWith([item("a", { ordered: { number: 3, delim: "." } })]);
    expect(serialize(doc)).toBe("# t\n3. a\n");
  });

  it("`)` 分隔符原样写出", () => {
    const doc = docWith([item("a", { ordered: { number: 1, delim: ")" } })]);
    expect(serialize(doc)).toBe("# t\n1) a\n");
  });

  it("有序节点的 bullet 是死字段，不影响写出", () => {
    const doc = docWith([
      item("a", { bullet: "*", ordered: { number: 7, delim: "." } }),
    ]);
    expect(serialize(doc)).toBe("# t\n7. a\n");
  });

  it("无序节点不受影响", () => {
    expect(serialize(docWith([item("a", { bullet: "+" })]))).toBe("# t\n+ a\n");
  });

  it("有序父节点下的子节点按 indentUnit 缩进，与标记宽度无关", () => {
    const doc = docWith([
      item("a", {
        ordered: { number: 1, delim: "." },
        children: [item("b", { ordered: { number: 1, delim: "." } })],
      }),
    ]);
    expect(serialize(doc)).toBe("# t\n1. a\n  1. b\n");
  });
});
```

如果 `tests/serializer.test.ts` 里还没有 `MindDoc` 的 import，一并补上 `import type { MindDoc, MindNode } from "../src/model/types";`。

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run tests/serializer.test.ts
```

预期：TypeScript 报 `ordered` 不是 `MindNode` 的已知属性（`Object literal may only specify known properties`）。

- [ ] **Step 3: 加数据模型**

在 `src/model/types.ts` 里，`Bullet` 类型声明之后插入：

```ts
/**
 * 有序列表项的标记形态。存在即为有序项，不存在即为无序项。
 *
 * `serialize` 直接写出 `number` 与 `delim`，**绝不从节点在兄弟里的下标重算序号**。
 * 用户写的可能是 `1. 1. 1.`（全是 1，CommonMark 合法）、可能从 `3.` 起头、可能用
 * `)` 分隔符；重算就等于给项目加第六条写回归一化，违反 AGENTS.md 第 2 条。
 * 只有 `tree-ops` 的结构变更（增/删/移）才会经 `renumber` 改写 `number`。
 */
export interface OrderedForm {
  /** 文件里的原始序号，1–9 位数字（CommonMark 的上限） */
  number: number;
  /** CommonMark 允许的两种分隔符，原样保留 */
  delim: "." | ")";
}
```

把 `MindNode` 里 `bullet` 那段注释改成（保留原有内容，补上「仅在无序时被读取」这句），并在 `bullet` 之后加 `ordered`：

```ts
  /** 该节点在文件里用的无序列表标记字符，写回时原样重新写出，避免把 `* a` 改成 `- a`。
   *  **仅在 `ordered === undefined` 时被 `serialize` 读取**；有序节点上它是解析期
   *  填入的占位值（`-`），性质与 `HeadingForm.level`「解析期用、序列化不读」相同。
   *  根节点没有列表行，它的取值只作为「新建根的直接子节点时用哪个字符」的来源，
   *  由 parser 取自文件里第一个列表项（没有列表项时为 `-`）。 */
  bullet: Bullet;
  /** 存在即为有序列表项。标题节点不带此字段。
   *
   *  根节点是个例外，与 `bullet` 完全对称：它存的是「文件里第一个列表项的形态」，
   *  供 tree-ops 给根的新直接子节点挑一个与现有兄弟一致的标记。所以
   *  **`isOrdered(root)` 可能为真而根并不是有序列表项** —— 安全性来自 `serialize`
   *  的结构：根节点走 `doc.root.heading.prefix` 那条独立分支写出，永远不进
   *  `serializeNodes` 的标记分支。 */
  ordered?: OrderedForm;
```

在 `isHeading` 之后加判别函数：

```ts
/** 判别列表项标记形态的唯一入口。不要散落 `node.ordered !== undefined`。 */
export function isOrdered(
  node: MindNode,
): node is MindNode & { ordered: OrderedForm } {
  return node.ordered !== undefined;
}
```

- [ ] **Step 4: 改序列化**

`src/model/serializer.ts` 里，把列表项分支那一行（现在是 `out += \`${indentUnit.repeat(listDepth)}${node.bullet} ${composeLine(node)}\n\`;`）连同它上面的注释替换为：

```ts
    // 用节点自己的标记而不是固定的 `-`：`*`/`+` 同样是合法的 CommonMark 列表标记，
    // 有序项的号与分隔符同理，把它们改写掉会让一个只是被导图视图打开过的文件产生
    // 全量 diff（见 README「写回归一化」一节的承诺）。序号**不从下标重算**，重算
    // 就是第六条未获许可的归一化——它只在 tree-ops 的结构变更里经 renumber 改变。
    const marker = isOrdered(node)
      ? `${node.ordered.number}${node.ordered.delim}`
      : node.bullet;
    out += `${indentUnit.repeat(listDepth)}${marker} ${composeLine(node)}\n`;
```

`src/model/serializer.ts` 顶部的 import 改成把 `isOrdered` 也引进来：

```ts
import { isHeading, isOrdered, type MindDoc, type MindNode } from "./types";
```

缩进表达式一个字不改：仍是 `indentUnit.repeat(listDepth)`，**不按标记宽度重算**（设计文档第 2 节非目标）。

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/serializer.test.ts
```

预期：新增的 5 条全部 PASS，原有用例不变。

- [ ] **Step 6: 门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

预期：五条全绿。

- [ ] **Step 7: 提交**

```bash
git add src/model/types.ts src/model/serializer.ts tests/serializer.test.ts
git commit -m "$(cat <<'EOF'
feat: MindNode 支持有序列表形态，serialize 写出号与分隔符

序号逐节点存下原样写回，绝不从下标重算——用户可能写 1. 1. 1.、
从 3. 起头、或用 ) 分隔符，重算就是第六条未获许可的归一化。

此刻还没有代码产出 ordered 字段，parser 在下一个任务里接上。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 解析有序列表项

**Files:**
- Modify: `src/model/parser.ts:16`（正则区）、`scanDocument`、`buildTree`、`parse`
- Test: `tests/parser.test.ts:95`（替换现有用例）、`tests/roundtrip.test.ts`（`CORPUS` 与「已知归一化」）

**Interfaces:**
- Consumes: Task 1 的 `OrderedForm`、`MindNode.ordered`
- Produces: `parse()` 对有序列表行产出带 `ordered` 的节点；根节点回填 `ordered`

这个任务是整个改动的核心。**松散列表的同类守卫必须和有序识别在同一个任务里落地**：`CORPUS` 里已有的 `"# t\n\n- a\n1. 步骤\n\n- b\n"` 一旦让 parser 认出 `1. 步骤` 是列表项，没有守卫就会把那个空行压缩掉，语料立刻变红。

- [ ] **Step 1: 写失败的测试（parser 边界）**

在 `tests/parser.test.ts` 里，**删掉**现有的这个用例（它断言的正是本次要推翻的行为）：

```ts
  it("有序列表行归入上一节点的续行", () => {
    const doc = parse("# t\n\n- a\n1. 步骤\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["1. 步骤"]);
  });
```

在同一位置放进：

```ts
  it("有序列表行产生节点", () => {
    const doc = parse("# t\n\n- a\n1. 步骤\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "步骤"]);
    expect(doc.root.children[1].ordered).toEqual({ number: 1, delim: "." });
    expect(doc.root.children[0].ordered).toBeUndefined();
  });
```

再在文件末尾追加一个 describe：

```ts
describe("有序列表项的识别边界", () => {
  it("`.` 与 `)` 两种分隔符都认", () => {
    const doc = parse("# t\n\n1. a\n2) b\n", "x.md");
    expect(doc.root.children.map((c) => c.ordered)).toEqual([
      { number: 1, delim: "." },
      { number: 2, delim: ")" },
    ]);
  });

  it("非 1 起始与重复号都原样保留", () => {
    const doc = parse("# t\n\n3. a\n3. b\n", "x.md");
    expect(doc.root.children.map((c) => c.ordered?.number)).toEqual([3, 3]);
  });

  it("标记与文字之间没有空白时不是列表项", () => {
    const doc = parse("# t\n\n- a\n1.x\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["1.x"]);
  });

  it("超过 9 位数字不是列表项（CommonMark 上限）", () => {
    const doc = parse("# t\n\n- a\n1234567890. x\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["1234567890. x"]);
  });

  it("9 位数字仍是列表项", () => {
    const doc = parse("# t\n\n123456789. x\n", "x.md");
    expect(doc.root.children[0].ordered).toEqual({ number: 123456789, delim: "." });
  });

  it("围栏内的有序列表行不产生节点", () => {
    const doc = parse("# t\n\n- a\n```md\n1. 假条目\n```\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["```md", "1. 假条目", "```"]);
  });

  it("有序项按缩进构建层级，与无序项混排", () => {
    const doc = parse("# t\n\n1. a\n  - b\n2. c\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "c"]);
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("有序项能带行内标记与备注", () => {
    const doc = parse("# t\n\n1. (p1) a\n   > 备注\n", "x.md");
    const a = doc.root.children[0];
    expect(a.text).toBe("a");
    expect(a.marks).toEqual({ priority: 1 });
    expect(a.note?.text).toBe("备注");
  });

  it("根节点回填文件里第一个列表项的形态", () => {
    const doc = parse("# t\n\n1) a\n", "x.md");
    expect(doc.root.ordered).toEqual({ number: 1, delim: ")" });
  });

  it("第一个列表项是无序时根节点不带 ordered", () => {
    const doc = parse("# t\n\n- a\n1. b\n", "x.md");
    expect(doc.root.ordered).toBeUndefined();
    expect(doc.root.bullet).toBe("-");
  });
});
```

- [ ] **Step 2: 写失败的测试（往返与归一化）**

在 `tests/roundtrip.test.ts` 的 `CORPUS` 末尾（最后一条 `"# t\n\n> 根下面的引用块\n\n- a\n",` 之后）追加：

```ts
  // 有序列表参与层级。序号、分隔符、起始号、重复号都必须逐字保留——重算序号
  // 就是第六条未获许可的归一化。混排的两条缩进宽度刻意保持一致（都用 2 空格），
  // 宽度不一致的形态落在归一化第 4 条里，见下面「已知归一化」的单独断言。
  "# t\n\n1. a\n  1. b\n  2. c\n2. d\n",
  "# t\n\n1) a\n  1) b\n",
  "# t\n\n3. a\n4. b\n5. c\n",
  "# t\n\n1. a\n1. b\n1. c\n",
  "# t\n\n10. a\n11. b\n",
  "# t\n\n123456789. a\n",
  "# t\n\n1. a\n  - b\n2. c\n",
  "# t\n\n- a\n  1. b\n- c\n",
  "# t\n\n1. a\n  续行内容\n2. b\n",
  "# t\n\n1. (p3 60% flag:blue) a\n",
  "# t\n\n1. a\n  > 备注\n2. b\n",
  "# t\n\n## A\n\n1. a\n\n## B\n\n- b\n",
  // 同类守卫：跨标记类型的空行分隔的是两个不同的列表（CommonMark 语义），
  // 不是一个松散列表的两个项，压缩它就是未获许可的字节差异。
  "# t\n\n- a\n\n1. x\n",
  "# t\n\n1. a\n\n- x\n",
  "# t\n\n1. a\n\n1) x\n",
```

再在 `describe("已知归一化", ...)` 块内追加两条：

```ts
  it("有序列表的松散形态同样被压缩成紧凑列表", () => {
    // 归一化第 2 条的适用面从「无序列表」扩大到「列表」：有序项成为节点之后，
    // 两项之间的空行就没有存放的位置了。这是不可避免的，不是新增的第六条。
    expect(serialize(parse("# t\n\n1. a\n\n2. b\n", "x.md"))).toBe(
      "# t\n\n1. a\n2. b\n",
    );
  });

  it("有序与无序混排、缩进宽度不一致时兜底为 2 空格", () => {
    // `- ` 宽 2、`1. ` 宽 3，同一个块里出现两种宽度，detectIndentUnitString
    // 归纳不出单一单位，退回两空格兜底。这落在归一化第 4 条的措辞里
    // （「某个列表块内部混用、无法归纳出单一单位」），不是第六条。
    expect(serialize(parse("# t\n\n- a\n  - b\n1. c\n   1. d\n", "x.md"))).toBe(
      "# t\n\n- a\n  - b\n1. c\n  1. d\n",
    );
  });
```

- [ ] **Step 3: 跑测试确认它失败**

```bash
npx vitest run tests/parser.test.ts tests/roundtrip.test.ts
```

预期：`有序列表项的识别边界` 整个 describe 失败，新增的 `CORPUS` 语料失败，两条新的归一化断言失败。**原有的两条 `CORPUS` 语料 `"# t\n\n- a\n1. 步骤\n"` 与 `"# t\n\n- a\n1. 步骤\n\n- b\n"` 此刻仍应通过**——它们走的是老路径。

- [ ] **Step 4: 加正则与 `matchItem`**

`src/model/parser.ts` 顶部 import 加上 `OrderedForm`：

```ts
import type { Bullet, MindDoc, MindNode, OrderedForm } from "./types";
```

在 `LIST_ITEM_RE` 那一行之后插入：

```ts
/**
 * 有序列表项。第 2 组是序号（CommonMark 上限 9 位），第 3 组是分隔符。
 *
 * 与 `LIST_ITEM_RE` 一样要求标记与文字之间有空白，所以 `1.x` 不是列表项；
 * 位数上限让 `1234567890. x` 这类长数字开头的散文行不被误判（正则回溯时
 * `[.)]` 永远对不上数字，整条匹配失败）。
 */
const ORDERED_ITEM_RE = /^([ \t]*)(\d{1,9})([.)])[ \t]+(.*)$/;
```

在 `indentWidth` 之后、`interface HeadingEntry` 之前插入：

```ts
interface ItemMatch {
  indent: string;
  bullet: Bullet;
  ordered: OrderedForm | null;
  text: string;
}

/**
 * 把一行识别成列表项（无序或有序），不是列表项时返回 null。
 *
 * 两条正则的首个有效字符不可能相同（`-*+` 与数字），所以试的顺序无关紧要。
 */
function matchItem(line: string): ItemMatch | null {
  const unordered = LIST_ITEM_RE.exec(line);
  if (unordered !== null) {
    return {
      indent: unordered[1],
      // 正则第 2 组只可能匹配到 `-`/`*`/`+` 三者之一，这里的断言是把这一点从
      // 正则转达给类型系统，不是运行时判断。
      bullet: unordered[2] as Bullet,
      ordered: null,
      text: unordered[3],
    };
  }

  const ordered = ORDERED_ITEM_RE.exec(line);
  if (ordered === null) return null;
  return {
    indent: ordered[1],
    // 有序项的 bullet 是死字段（serialize 只在 ordered 缺席时读它），填入与
    // parser 各处一致的占位值。
    bullet: "-",
    ordered: {
      number: Number(ordered[2]),
      // 同上，第 3 组只可能是 `.` 或 `)`。
      delim: ordered[3] as OrderedForm["delim"],
    },
    text: ordered[4],
  };
}
```

- [ ] **Step 5: `ItemEntry` 带上形态，`scanDocument` 改用 `matchItem`**

给 `ItemEntry` 加字段（在 `bullet` 之后）：

```ts
  /** 有序项的号与分隔符；无序项为 null */
  ordered: OrderedForm | null;
```

`scanDocument` 里的列表项分支（现在是 `const item = LIST_ITEM_RE.exec(line); if (item !== null) { ... }`）整体替换为：

```ts
    const item = matchItem(line);
    if (item !== null) {
      entries.push({
        kind: "item",
        indent: item.indent,
        depthWidth: indentWidth(item.indent),
        bullet: item.bullet,
        ordered: item.ordered,
        text: item.text,
        continuation: [],
      });
      i++;
      continue;
    }
```

- [ ] **Step 6: 松散列表压缩加同类守卫**

`scanDocument` 的空行分支里，把判断条件那一段替换掉。现在是：

```ts
      const previous = entries[entries.length - 1];
      if (
        j < end &&
        LIST_ITEM_RE.test(lines[j]) &&
        previous !== undefined &&
        previous.kind === "item" &&
        previous.continuation.length === 0
      ) {
```

改成：

```ts
      const previous = entries[entries.length - 1];
      const following = j < end ? matchItem(lines[j]) : null;
      if (
        following !== null &&
        previous !== undefined &&
        previous.kind === "item" &&
        previous.continuation.length === 0 &&
        // 第四个条件（同类守卫）：空行两侧必须同为有序或同为无序。CommonMark 里
        // 跨标记类型是两个不同的列表，压缩它们之间的空行既没有必要，又会在今天
        // 逐字节保真的文件（`- a` / 空行 / `1. x`）上凭空产生差异——那是第六条
        // 未获许可的归一化。少了这一条，CORPUS 里的
        // `"# t\n\n- a\n1. 步骤\n\n- b\n"` 立刻变红。
        (previous.ordered === null) === (following.ordered === null)
      ) {
```

原有那段长注释（解释前三个条件为什么都必需）保留在上方不动，只把新条件的说明并进去。

- [ ] **Step 7: `buildTree` 把形态填进节点**

`buildTree` 里构造列表项节点那段，在 `bullet: entry.bullet,` 之后、`}` 收尾之前不动，改为在 `if (itemNote.note !== null)` 之前插入一行：

```ts
    // 只在有序时挂字段：`ordered: null` 与「不是有序项」是两种状态，让无序节点
    // 根本不出现这个键，结构比较与 JSON 快照都更干净（与 note 同一条规则）。
    if (entry.ordered !== null) node.ordered = { ...entry.ordered };
    if (itemNote.note !== null) node.note = itemNote.note;
```

- [ ] **Step 8: 根节点回填 `ordered`**

`parse` 里现在这一行：

```ts
    bullet: entries.find((e): e is ItemEntry => e.kind === "item")?.bullet ?? "-",
```

在 `const root: MindNode = {` 之前提取出第一个列表项条目：

```ts
  const firstItem = entries.find((e): e is ItemEntry => e.kind === "item");
```

把 `bullet` 那行改成 `bullet: firstItem?.bullet ?? "-",`，并在 `const root: MindNode = { ... };` 这条语句之后、`buildTree(bodyEntries, root);` 之前插入：

```ts
  // 与 bullet 完全对称：根节点没有自己的列表行，这里存的是「文件里第一个列表项
  // 的形态」，供 tree-ops 给根的新直接子节点挑一个与现有兄弟一致的标记。
  // 因此 isOrdered(root) 可能为真而根并不是有序列表项——安全性来自 serialize 的
  // 结构：根走 doc.root.heading.prefix 那条独立分支，永远不进 serializeNodes。
  if (firstItem?.ordered != null) root.ordered = { ...firstItem.ordered };
```

- [ ] **Step 9: 跑测试确认通过**

```bash
npx vitest run tests/parser.test.ts tests/roundtrip.test.ts tests/serializer.test.ts
```

预期：全部 PASS，**包括原有的两条 `1. 步骤` 语料**（它们现在走新路径，但仍逐字节还原）。

如果 `"# t\n\n- a\n1. 步骤\n\n- b\n"` 变红，说明 Step 6 的同类守卫没写对——不要去改语料，回去修守卫。

- [ ] **Step 10: 跑全量测试**

```bash
npm test
```

预期：全绿。fast-check 的属性测试此刻还没生成有序节点（Task 5 才扩），所以不受影响。

- [ ] **Step 11: 门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

- [ ] **Step 12: 提交**

```bash
git add src/model/parser.ts tests/parser.test.ts tests/roundtrip.test.ts
git commit -m "$(cat <<'EOF'
feat: 有序列表项产生节点

新增 ORDERED_ITEM_RE 与 matchItem，1. / 1) 与 - / * / + 一样产生节点，
深度仍按缩进宽度算，块划分与缩进单位推断一行未改。

松散列表压缩（归一化第 2 条）加第四个条件：空行两侧必须同为有序或
同为无序。CommonMark 里跨标记类型是两个不同的列表，压缩它们之间的
空行会在今天逐字节保真的文件上凭空产生差异——CORPUS 里已有的
"- a / 1. 步骤 / 空行 / - b" 就是这条守卫的回归语料。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `renumber` 纯函数

**Files:**
- Modify: `src/model/tree-ops.ts`
- Test: `tests/tree-ops.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `OrderedForm`、`MindNode.ordered`
- Produces:
  - `export function renumber(prev: readonly MindNode[], next: readonly MindNode[]): MindNode[]`

这个任务只写函数与它的单测，**不接调用点**（Task 4 才接）。所以现有行为一个字不变。

`renumber` 之所以导出，是因为它是一个语义不平凡的纯函数，六个分支直接测比透过四个 op 间接测清楚得多。

- [ ] **Step 1: 写失败的测试**

在 `tests/tree-ops.test.ts` 的 import 里加上 `renumber`，并在文件末尾追加：

```ts
/** 造一串列表项兄弟。`"-"` 表示无序，数字串如 `"3."` / `"5)"` 表示有序。 */
function siblings(...specs: string[]): MindNode[] {
  return specs.map((spec, index) => {
    const base: MindNode = {
      id: `s${index}`,
      text: `t${index}`,
      marks: {},
      children: [],
      collapsed: false,
      continuation: [],
      bullet: "-",
    };
    if (spec === "-") return base;
    const delim = spec.slice(-1) as "." | ")";
    return { ...base, ordered: { number: Number(spec.slice(0, -1)), delim } };
  });
}

/** 把兄弟串还原成 `siblings` 的输入形态，便于整串断言。 */
function specs(nodes: readonly MindNode[]): string[] {
  return nodes.map((n) =>
    n.ordered === undefined ? "-" : `${n.ordered.number}${n.ordered.delim}`,
  );
}

describe("renumber", () => {
  it("段内插入：起始号沿用变更前的段首号", () => {
    const prev = siblings("1.", "2.", "3.");
    const next = [prev[0], ...siblings("9."), prev[1], prev[2]];
    expect(specs(renumber(prev, next))).toEqual(["1.", "2.", "3.", "4."]);
  });

  it("删掉段首：剩下的节点各自保号，不被拉回 1", () => {
    const prev = siblings("3.", "4.", "5.");
    expect(specs(renumber(prev, [prev[1], prev[2]]))).toEqual(["3.", "4."]);
  });

  it("拖到段首：起始号仍取变更前的段首号，不被新来的节点带偏", () => {
    const prev = siblings("1.", "2.");
    const next = [...siblings("5."), prev[0], prev[1]];
    expect(specs(renumber(prev, next))).toEqual(["1.", "2.", "3."]);
  });

  it("新长出来的段从 1 起", () => {
    expect(specs(renumber([], siblings("1.")))).toEqual(["1."]);
    expect(specs(renumber([], siblings("7.")))).toEqual(["1."]);
  });

  it("无序节点把有序段一分为二，第二段从 1 起", () => {
    const prev = siblings("1.", "2.", "3.");
    const next = [prev[0], ...siblings("-"), prev[1], prev[2]];
    expect(specs(renumber(prev, next))).toEqual(["1.", "-", "1.", "2."]);
  });

  it("delim 不同就是两个段，各自独立计数", () => {
    const prev = siblings("1.", "2.", "5)", "6)");
    const next = [prev[0], ...siblings("9."), prev[1], prev[2], prev[3]];
    expect(specs(renumber(prev, next))).toEqual(["1.", "2.", "3.", "5)", "6)"]);
  });

  it("纯无序的兄弟串原样返回", () => {
    const prev = siblings("-", "-");
    const next = [prev[0], ...siblings("-"), prev[1]];
    expect(specs(renumber(prev, next))).toEqual(["-", "-", "-"]);
    expect(renumber(prev, next).every((n) => n.ordered === undefined)).toBe(true);
  });

  it("号没变的节点保持同一个对象引用", () => {
    const prev = siblings("1.", "2.");
    const next = [prev[0], prev[1]];
    const out = renumber(prev, next);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(prev[1]);
  });

  it("不改动入参数组", () => {
    const prev = siblings("1.", "2.");
    const next = [prev[0], ...siblings("9."), prev[1]];
    renumber(prev, next);
    expect(specs(prev)).toEqual(["1.", "2."]);
    expect(prev[1].ordered).toEqual({ number: 2, delim: "." });
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run tests/tree-ops.test.ts
```

预期：`renumber` 未导出，import 报错。

- [ ] **Step 3: 实现**

在 `src/model/tree-ops.ts` 的 `firstHeadingIndex` 之后插入（本步骤末尾一并给出要改的 import）：

```ts
/** 兄弟数组里的一段有序节点：左闭右开的下标区间，加上该段的分隔符。 */
interface OrderedRun {
  start: number;
  end: number;
  delim: OrderedForm["delim"];
}

/**
 * 把兄弟数组切成若干「极大的、连续的、**同 delim** 的有序节点」段。
 *
 * delim 不同在 CommonMark 里就是两个列表，跨 delim 连号是错的：`1. / 2. / 5) / 6)`
 * 是「从 1 起的一个列表」加「从 5 起的另一个列表」，不是一个 1–4 的列表。
 * 无序节点与标题节点都不带 `ordered`，因此天然会把段切断。
 */
function orderedRuns(children: readonly MindNode[]): OrderedRun[] {
  const runs: OrderedRun[] = [];
  let current: OrderedRun | null = null;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!isOrdered(node)) {
      current = null;
      continue;
    }
    if (current !== null && current.delim === node.ordered.delim) {
      current.end = i + 1;
      continue;
    }
    current = { start: i, end: i + 1, delim: node.ordered.delim };
    runs.push(current);
  }
  return runs;
}

/**
 * 结构变更后重排有序兄弟的序号。
 *
 * 每一段的起始号取 `prev` 里**同序号那一段**的段首号；`prev` 里没有对应段
 * （新长出来的段）时取 1。段内其余节点依次 +1，delim 各自保留不动。
 *
 * 「取变更前的段首号」这条规则同时照顾到三件事：保留用户从 `3.` 起头的列表；
 * 删掉段首时剩余节点各自保号（diff 最小）；把一个 `5.` 拖到 `1. / 2.` 的段首
 * 时不会把整段带成 5,6,7。
 *
 * **这个函数只被 tree-ops 的四个结构变更点调用。** 打开文件不改再切走时一个
 * tree-ops 函数都不会被调用，所以什么都不会重编号——AGENTS.md 第 2 条不受影响。
 *
 * 号没有变化的节点保持原对象引用，不做无谓的复制。
 */
export function renumber(
  prev: readonly MindNode[],
  next: readonly MindNode[],
): MindNode[] {
  const prevRuns = orderedRuns(prev);
  const nextRuns = orderedRuns(next);
  if (nextRuns.length === 0) return [...next];

  const result = [...next];
  nextRuns.forEach((run, index) => {
    const prevRun = prevRuns[index];
    const anchor = prevRun === undefined ? null : prev[prevRun.start];
    // orderedRuns 只把带 ordered 的下标收进段里，所以 anchor 必然是有序节点；
    // isOrdered 在这里是把这一点转达给类型系统，不是运行时判断。
    const start = anchor !== null && isOrdered(anchor) ? anchor.ordered.number : 1;
    for (let i = run.start; i < run.end; i++) {
      const node = result[i];
      if (!isOrdered(node)) continue;
      const number = start + (i - run.start);
      if (node.ordered.number === number) continue;
      result[i] = { ...node, ordered: { ...node.ordered, number } };
    }
  });
  return result;
}
```

`src/model/tree-ops.ts` 顶部 import 同时引进 `isOrdered` 与 `OrderedForm`：

```ts
import {
  isHeading,
  isOrdered,
  type Bullet,
  type Marks,
  type MindNode,
  type OrderedForm,
} from "./types";
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/tree-ops.test.ts
```

预期：新增的 9 条全部 PASS。

- [ ] **Step 5: 门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

- [ ] **Step 6: 提交**

```bash
git add src/model/tree-ops.ts tests/tree-ops.test.ts
git commit -m "$(cat <<'EOF'
feat: renumber——结构变更后重排有序兄弟的序号

每段起始号取变更前同序号那一段的段首号，没有对应段时取 1。
段按「连续且同 delim」划分：1. / 2. / 5) / 6) 是两个列表，跨 delim
连号是错的。

只被 tree-ops 的四个结构变更点调用（下一个任务接上），打开文件
不改再切走时一次都不会触发，归一化第 2 条不受影响。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: tree-ops 接上重编号与形态继承

**Files:**
- Modify: `src/model/tree-ops.ts`（`makeNode`、`addChild`、`addSibling`、`removeNode`、`moveNode`）
- Test: `tests/tree-ops.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `renumber`
- Produces: `addChild` / `addSibling` / `removeNode` / `moveNode` 在有序列表上产出正确的序号与标记形态。四个函数的签名与返回类型**一个字不变**。

- [ ] **Step 1: 写失败的测试**

在 `tests/tree-ops.test.ts` 末尾追加：

```ts
/** n0=根 / n1=a / n2=b / n3=c，一条从 1 起的有序列表 */
function orderedTree(): MindNode {
  return parse("# 根\n\n1. a\n2. b\n3. c\n", "x.md").root;
}

describe("有序列表上的结构编辑", () => {
  it("addSibling 插入后整段重排", () => {
    const { root } = addSibling(orderedTree(), "n1", "new");
    expect(root.children.map((c) => c.text)).toEqual(["a", "new", "b", "c"]);
    expect(root.children.map((c) => c.ordered?.number)).toEqual([1, 2, 3, 4]);
  });

  it("addSibling 继承参照兄弟的分隔符", () => {
    const root = parse("# 根\n\n1) a\n", "x.md").root;
    const next = addSibling(root, "n1", "new").root;
    expect(next.children.map((c) => c.ordered)).toEqual([
      { number: 1, delim: ")" },
      { number: 2, delim: ")" },
    ]);
  });

  it("removeNode 删掉段首后剩余节点保号", () => {
    const root = parse("# 根\n\n3. a\n4. b\n5. c\n", "x.md").root;
    const next = removeNode(root, "n1").root;
    expect(next.children.map((c) => c.ordered?.number)).toEqual([3, 4]);
  });

  it("removeNode 删掉中间节点后其后的重排", () => {
    const next = removeNode(orderedTree(), "n2").root;
    expect(next.children.map((c) => c.text)).toEqual(["a", "c"]);
    expect(next.children.map((c) => c.ordered?.number)).toEqual([1, 2]);
  });

  it("addChild 给有序父节点产出有序子节点，从 1 起", () => {
    const { root } = addChild(orderedTree(), "n1", "child");
    const a = findNode(root, "n1") as MindNode;
    expect(a.children[0].ordered).toEqual({ number: 1, delim: "." });
  });

  it("addChild 给无序父节点产出无序子节点", () => {
    const root = parse("# 根\n\n* a\n", "x.md").root;
    const a = findNode(addChild(root, "n1", "child").root, "n1") as MindNode;
    expect(a.children[0].ordered).toBeUndefined();
    expect(a.children[0].bullet).toBe("*");
  });

  it("addChild 到根：继承文件里第一个列表项的形态", () => {
    const root = parse("# 根\n\n1) a\n", "x.md").root;
    const next = addChild(root, "n0", "new").root;
    expect(next.children[1].ordered).toEqual({ number: 2, delim: ")" });
  });

  it("moveNode 跨父移动：源父与目标父各自重排", () => {
    // 按文档顺序分配 id：n1=a / n2=b / n3=b1 / n4=c
    const root = parse("# 根\n\n1. a\n2. b\n  1. b1\n3. c\n", "x.md").root;
    // b1 从 b 底下移到根的第 0 位
    const next = moveNode(root, "n3", "n0", 0);
    expect(next.children.map((c) => c.text)).toEqual(["b1", "a", "b", "c"]);
    expect(next.children.map((c) => c.ordered?.number)).toEqual([1, 2, 3, 4]);
    expect((findNode(next, "n2") as MindNode).children).toEqual([]);
  });

  it("moveNode 同父内移动：两次重排的结果正确", () => {
    // c 移到第 0 位
    const next = moveNode(orderedTree(), "n3", "n0", 0);
    expect(next.children.map((c) => c.text)).toEqual(["c", "a", "b"]);
    expect(next.children.map((c) => c.ordered?.number)).toEqual([1, 2, 3]);
  });

  it("moveNode 把无序节点拖进有序段：段一分为二，第二段从 1 起", () => {
    const root = parse("# 根\n\n1. a\n2. b\n3. c\n\n## A\n\n- u\n", "x.md").root;
    const u = root.children.find((c) => c.text === "A")?.children[0] as MindNode;
    const next = moveNode(root, u.id, "n0", 1);
    expect(next.children.slice(0, 4).map((c) => c.text)).toEqual(["a", "u", "b", "c"]);
    expect(next.children.slice(0, 4).map((c) => c.ordered?.number)).toEqual([
      1,
      undefined,
      1,
      2,
    ]);
  });

  it("纯无序的树经过四个 op 后不会凭空长出 ordered 字段", () => {
    const hasOrdered = (node: MindNode): boolean =>
      node.ordered !== undefined || node.children.some(hasOrdered);
    let root = tree();
    root = addChild(root, "n1", "x").root;
    root = addSibling(root, "n2", "y").root;
    root = moveNode(root, "n4", "n1", 0);
    root = removeNode(root, "n3").root;
    expect(hasOrdered(root)).toBe(false);
  });

  it("编辑后序列化出的序号连续", () => {
    const doc = parse("# 根\n\n1. a\n2. b\n", "x.md");
    const next = { ...doc, root: addSibling(doc.root, "n1", "new").root };
    expect(serialize(next)).toBe("# 根\n\n1. a\n2. new\n3. b\n");
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run tests/tree-ops.test.ts
```

预期：`有序列表上的结构编辑` 里除「纯无序的树……」之外全部失败——新节点没有 `ordered`，序号也没有重排。

- [ ] **Step 3: `makeNode` 改收标记形态**

把 `src/model/tree-ops.ts` 里 `makeNode` 连同它的注释替换为：

```ts
/** 新节点继承来的列表标记形态。`ordered` 缺席即为无序项。 */
interface MarkerForm {
  bullet: Bullet;
  ordered?: OrderedForm;
}

/** 读出一个节点的标记形态，供新节点继承。 */
function markerOf(node: MindNode): MarkerForm {
  return isOrdered(node)
    ? { bullet: node.bullet, ordered: { ...node.ordered } }
    : { bullet: node.bullet };
}

/** 新节点跟着「未来的兄弟们」用同一个列表标记形态，避免在一个 `*` 列表里插进
 *  一行 `- `、或在一个 `1.` 列表里插进一行 `- `。根节点的形态由 parser 取自
 *  文件里第一个列表项，没有列表项时为 `-`（见 parser.ts）。
 *
 *  有序时带过来的 `number` 只是个合法初值；真正的号由调用方随后的 `renumber`
 *  按段首重算。
 *
 *  构造出的对象不带 `heading`，因此天然是列表项形态：解析双向（标题与列表项
 *  都读成节点），写回单向（图上新建的节点永远是列表项）。 */
function makeNode(id: string, text: string, marker: MarkerForm): MindNode {
  const node: MindNode = {
    id,
    text,
    marks: {},
    children: [],
    collapsed: false,
    continuation: [],
    bullet: marker.bullet,
  };
  if (marker.ordered !== undefined) node.ordered = { ...marker.ordered };
  return node;
}
```

- [ ] **Step 4: `addChild`**

把 `addChild` 函数体里 `const child = ...` 那一行连同上面的注释替换为：

```ts
  // 父节点找不到时（调用方传了无效 id）mapTree 不会插入任何东西，形态取值
  // 无关紧要，回退到缺省的 `-`。
  const parentNode = findNode(root, parentId);
  let marker: MarkerForm = { bullet: "-" };
  if (parentNode !== null) {
    marker = isOrdered(parentNode)
      // 初始号给 1：新子节点要么独自成段（起始号本就是 1），要么接在既有段尾、
      // 号由下面的 renumber 按段首重算。
      ? { bullet: parentNode.bullet, ordered: { number: 1, delim: parentNode.ordered.delim } }
      : { bullet: parentNode.bullet };
  }
  const child = makeNode(newId, text, marker);
```

把 `return { ...node, collapsed: false, children };` 改成：

```ts
    return { ...node, collapsed: false, children: renumber(node.children, children) };
```

- [ ] **Step 5: `addSibling`**

把三元表达式的 else 分支 `: makeNode(newId, text, target.bullet);` 改成：

```ts
    // 参照兄弟是有序项时连号一起复制。插入位置恒为 index + 1，新节点永远不会
    // 成为段首，所以这个复制来的号只是个会被 renumber 立刻覆盖的合法初值。
    : makeNode(newId, text, markerOf(target));
```

把 `return { ...parent, children };` 改成：

```ts
    return { ...parent, children: renumber(parent.children, children) };
```

标题分支（`isHeading(target)` 为真那支）**不动**：标题节点不是有序列表项，不带 `ordered`。

- [ ] **Step 6: `removeNode`**

把 mapTree 那段替换为：

```ts
  const next = mapTree(root, (node) => {
    if (node.id !== parent.id) return null;
    const children = node.children.filter((c) => c.id !== id);
    return { ...node, children: renumber(node.children, children) };
  });
```

- [ ] **Step 7: `moveNode`**

detach 那段替换为：

```ts
  const detached = mapTree(root, (node) => {
    if (!node.children.some((c) => c.id === id)) return null;
    const children = node.children.filter((c) => c.id !== id);
    return { ...node, children: renumber(node.children, children) };
  });
```

insert 那段的 `return { ...node, collapsed: false, children };` 改成：

```ts
    // 源父与目标父相同时这已是第二次 renumber，prev 是 detach 之后的数组——
    // 结果仍然正确（1,2,3 里把 c 移到 0 位：detach 得 a=1,b=2，insert 得
    // c=1,a=2,b=3）。
    return { ...node, collapsed: false, children: renumber(node.children, children) };
```

- [ ] **Step 8: 跑测试确认通过**

```bash
npx vitest run tests/tree-ops.test.ts
```

预期：新增的 12 条全部 PASS，原有用例不变。

- [ ] **Step 9: 门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

- [ ] **Step 10: 提交**

```bash
git add src/model/tree-ops.ts tests/tree-ops.test.ts
git commit -m "$(cat <<'EOF'
feat: 四个结构变更点接上重编号与标记形态继承

addChild / addSibling / removeNode / moveNode 对 children 真的变了的那个
父节点调用 renumber；moveNode 对源父与目标父各调一次。四个函数的签名
一个字未变。

makeNode 改收标记形态而不是单个 bullet 字符：addChild 取父节点的形态，
addSibling 取参照兄弟的形态，被拖动的节点保留自己的形态——无序节点掉进
有序段里就把那段一分为二，不静默改写用户的标记。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: fast-check 生成器覆盖有序形态

**Files:**
- Modify: `tests/roundtrip.test.ts`（`stripIds`、`itemNodeArb`、`firstItemBullet`、`docArb`）

**Interfaces:**
- Consumes: Task 1–4 的全部
- Produces: 无生产代码改动

属性测试 `parse(serialize(doc)) === doc` 目前生成的节点全是无序的。这个任务让它也生成有序节点，**同时保持生成的 doc 仍是「规范形态」**（`parse` 真能产出的形状），否则会报假反例。

关键性质：`serialize` 写出的缩进恒为 `unit.repeat(depth)`，**与标记宽度无关**。所以生成器写出 `1. a` / `  1. b` 时 `parse` 读回来的单位就是 `"  "`，往返成立。设计文档第 7 节那个混排异宽的形态是**手写文件**才产生的，生成器天然写不出来——不需要为此收窄任何东西。

- [ ] **Step 1: 写失败的测试**

改 `tests/roundtrip.test.ts`。

`stripIds` 里，在 `bullet: node.bullet,` 之后加一行（用 `?? null` 而不是直接放 `node.ordered`，避免 `undefined` 与「键不存在」在 `toEqual` 下的歧义，与下面 `note` 那行同一条规则）：

```ts
    ordered: node.ordered ?? null,
```

在 `bulletArb` 之后加：

```ts
/**
 * 列表项的标记形态：约一半无序（三种字符），约一半有序（两种分隔符、号随机）。
 *
 * 号可以任意取值：`parse` 逐字读回来，`serialize` 逐字写出去，往返与号无关。
 * 刻意覆盖 1 之外的起始号与重复号——它们正是「序号不得从下标重算」这条约束
 * 的随机化压力来源。
 */
const markerArb = fc.oneof(
  bulletArb.map((bullet) => ({ bullet, ordered: undefined })),
  fc
    .record({
      bullet: bulletArb,
      number: fc.integer({ min: 1, max: 999999999 }),
      delim: fc.constantFrom("." as const, ")" as const),
    })
    .map(({ bullet, number, delim }) => ({ bullet, ordered: { number, delim } })),
);
```

`itemNodeArb` 的 `fc.record({...})` 替换为（把 `bullet` 换成 `markerArb` 并在 `.map` 里展开，因为 `ordered` 必须是「缺席」而不是 `undefined` 值才和 parser 的产出一致）：

```ts
  return fc
    .record({
      text: safeText,
      marks: marksArb,
      children: childrenArb,
      continuation: continuationArb,
      marker: markerArb,
      note: noteArb,
    })
    .map((raw): MindNode => {
      const node: MindNode = {
        id: "x",
        text: raw.text,
        marks: raw.marks,
        children: raw.children,
        collapsed: false,
        continuation: raw.continuation,
        bullet: raw.marker.bullet,
      };
      if (raw.marker.ordered !== undefined) node.ordered = raw.marker.ordered;
      if (raw.note !== undefined) node.note = raw.note;
      return node;
    });
```

注意：原来的 `fc.record` 把 `note: noteArb` 直接放进对象，`noteArb` 能生成 `undefined`；改成 `.map` 后要显式判断，否则 `note: undefined` 这个**存在但为 undefined 的键**会在 `stripIds` 的 `node.note?.text ?? null` 下表现一致、但在别处留隐患。上面的写法已经处理了。

把 `firstItemBullet` 连同注释替换为返回整个形态的版本：

```ts
/** 前序遍历找出第一个列表项形态节点的标记形态，对齐 parser 的回填规则。 */
function firstItemMarker(
  nodes: readonly MindNode[],
): { bullet: MindNode["bullet"]; ordered?: MindNode["ordered"] } | null {
  for (const node of nodes) {
    if (node.heading === undefined) {
      return node.ordered === undefined
        ? { bullet: node.bullet }
        : { bullet: node.bullet, ordered: node.ordered };
    }
    const nested = firstItemMarker(node.children);
    if (nested !== null) return nested;
  }
  return null;
}
```

`docArb` 的 `.map((raw): MindDoc => ({...}))` 里，把 root 的构造改成先算出形态再组装（现在是内联的 `bullet: firstItemBullet(...) ?? "-"`）：

```ts
      .map((raw): MindDoc => {
        const children = [...seed.items, ...seed.headings];
        // 根节点没有自己的列表行，parser 用文件里第一个列表项的形态回填。
        const rootMarker = firstItemMarker(children) ?? { bullet: "-" as const };
        const root: MindNode = {
          id: "n0",
          text: raw.rootText,
          marks: {},
          children,
          collapsed: false,
          continuation: raw.rootContinuation,
          bullet: rootMarker.bullet,
          heading: {
            level: 1,
            prefix: raw.rootPrefix,
            suffix: raw.rootSuffix,
            indentUnit: raw.rootIndentUnit,
          },
        };
        if (rootMarker.ordered !== undefined) root.ordered = rootMarker.ordered;
        return {
          // 兜底值，只在整条标题祖先链都没有单位时才被 serialize 用到。
          indentUnit: "  ",
          frontmatter: raw.frontmatter,
          // 无 frontmatter 时结束围栏根本不存在，其尾随空白只能是空串。
          frontmatterFenceSuffix:
            raw.frontmatter === null ? "" : raw.frontmatterFenceSuffix,
          hasHeading: seed.hasHeading,
          root,
          preamble: raw.preamble,
        };
      }),
```

`headingNodeArb` 里的 `bullet: fc.constant("-" as const),` **不动**——标题节点不带 `ordered`，`bullet` 是死字段。

- [ ] **Step 2: 跑测试**

```bash
npx vitest run tests/roundtrip.test.ts
```

预期：**全部 PASS**。Task 1–4 已经把往返做对了，这个任务是补覆盖面，不是补功能。

如果报反例，先把 fast-check 打印出来的 counterexample 拿去手工跑一遍 `serialize(parse(...))`，判断是**生成器造出了非规范形态的 doc**（生成器的问题）还是**往返真的不成立**（生产代码的问题）。前者改生成器，后者回 Task 2/3/4 修生产代码。**不要收窄 `markerArb` 来让测试变绿**——那正是 AGENTS.md 禁止的动作。

- [ ] **Step 3: 提高轮数跑一遍，确认覆盖面真的变了**

```bash
npx vitest run tests/roundtrip.test.ts -t "对随机文档成立"
```

临时把 `numRuns: 300` 改成 `numRuns: 3000` 跑一次，确认仍然全绿，然后**改回 300** 再提交。

- [ ] **Step 4: 门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

- [ ] **Step 5: 提交**

```bash
git add tests/roundtrip.test.ts
git commit -m "$(cat <<'EOF'
test: 属性测试生成器覆盖有序列表形态

markerArb 约一半无序、一半有序，号覆盖 1 之外的起始号与重复号——
它们正是「序号不得从下标重算」这条约束的随机化压力来源。
stripIds 把 ordered 纳入结构比较，firstItemBullet 扩成 firstItemMarker
以对齐 parser 对根节点的回填规则。

生成器写出的缩进恒为 unit.repeat(depth)、与标记宽度无关，所以设计文档
第 7 节那个混排异宽的形态只会由手写文件产生，不需要收窄生成器。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 文档、界面文案与示例文件

**Files:**
- Modify: `src/i18n.ts:94`（中）、`src/i18n.ts:171`（英）
- Modify: `src/view/toolbar.ts:30`（注释）
- Modify: `src/model/tree-ops.ts:61`（注释）
- Modify: `src/model/parser.ts:59` 与 `:339`（注释）
- Modify: `examples/conference-talk.md:57` 与 `## Notes` 段
- Modify: `README.md`、`README.zh-CN.md`
- Modify: `AGENTS.md`
- Modify: `docs/MANUAL-VERIFICATION.md`

**Interfaces:**
- Consumes: Task 1–5 的全部
- Produces: 无代码接口

`examples/conference-talk.md` 被 `tests/roundtrip.test.ts` 的「示例文件是规范形态」断言逐字节覆盖，所以这个任务有真实的测试把关。

- [ ] **Step 1: 改界面文案**

`src/i18n.ts` 中文表里：

```ts
  "toolbar.remove.blockedHidden":
    "该节点携带图上不可见的正文（标题下的散文、表格、代码块等），删除会连带丢掉这些内容",
```

英文表里：

```ts
    "This node carries body text that the map does not show (prose, tables and code blocks under a heading); deleting it would take that content with it",
```

- [ ] **Step 2: 改代码注释里的列举**

四处，都只是把「有序列表」从「不产生节点的东西」这个列举里去掉：

- `src/view/toolbar.ts:30` —— `该节点是否携带图上不可见的正文（标题下的散文、有序列表、代码块……）` → `（标题下的散文、表格、代码块……）`
- `src/model/tree-ops.ts:61` —— `有序列表、表格、代码块。` → `表格、代码块。`
- `src/model/parser.ts:59` —— `非节点行（散文、有序列表、表格、围栏、缩进续行）` → `非节点行（散文、表格、围栏、缩进续行）`
- `src/model/parser.ts:339` —— `节点行之外的一切内容（frontmatter、前言、散文、有序列表、围栏、续行）` → `（frontmatter、前言、散文、表格、围栏、续行）`

- [ ] **Step 3: 改示例文件**

`examples/conference-talk.md` 的 `## Follow-up` 一段，把

```markdown
1. Ordered lists are carried along verbatim but never become nodes
```

换成一个真正在演示有序列表的三行（**保留它与后面 `- (p4 0%)` 之间的那个空行** —— 同类守卫让这个空行继续保真）：

```markdown
1. Ordered lists are nodes too, numbering preserved
2. Nested ones work the same way
   1. Including their own numbering
```

同一文件的 `## Notes` 段落，把

```
node on the map. What is *not* on the map: this paragraph, the `tags` and
`speaker` keys in the frontmatter, and the ordered list under Follow-up — all
carried along invisibly. Open this file in mindmap view, switch back to source,
```

改成

```
node on the map. What is *not* on the map: this paragraph and the `tags` and
`speaker` keys in the frontmatter — both carried along invisibly. Open this
file in mindmap view, switch back to source,
```

- [ ] **Step 4: 跑示例文件的往返断言**

```bash
npx vitest run tests/roundtrip.test.ts -t "conference-talk"
```

预期：PASS。如果失败，多半是嵌套那行的缩进宽度与文件里其他块不一致——把它改成与该块一致的缩进（示例文件其余部分用 2 空格），**不要改断言**。

- [ ] **Step 5: 改 `AGENTS.md`**

三处：

1. 「一句话架构」里 `顶格标题 #–###### 与嵌套无序列表都产生节点` → `顶格标题 #–###### 与嵌套列表（无序 `-`/`*`/`+` 与有序 `1.`/`1)`）都产生节点`。
2. 第 2 条的归一化第 2 项 `松散列表（项之间夹空行）压缩成紧凑列表` 之后补一句：

   > 有序与无序各自成列，**空行两侧必须同类才压缩**：`- a` / 空行 / `1. x` 里那个空行分隔的是两个不同的列表（CommonMark 语义），压缩它是第六条未获许可的归一化。`tests/roundtrip.test.ts` 的 `CORPUS` 里有这条守卫的回归语料。

3. 第 2 条的归一化第 4 项末尾补一句：

   > `- ` 宽 2、`1. ` 宽 3，所以**有序与无序在同一个列表块里混排时更容易撞上这一条**：`- a` / `  - b` / `1. c` / `   1. d` 会被统一成每层 2 空格。这是既有规则的新触发面，不是新增的归一化。

   另外第 2 条里「`*` / `+` 列表标记要原样保留（`MindNode.bullet`）」那句后面补：「有序项的序号与分隔符同样原样保留（`MindNode.ordered`），**序号永不从节点在兄弟里的下标重算**——只有 `tree-ops` 的结构变更才经 `renumber` 改写它」。

- [ ] **Step 6: 改 `README.zh-CN.md`**

**先认清一件事**：README 的「示例」一节内嵌了 `examples/conference-talk.md` 的**全文副本**（一个大代码块，`:60`–`:100` 一带）。`:90` 那行 `1. 有序列表原样保留，但永不成为节点` 是这份副本的一部分，**不是**一个「已知限制」列表项 —— 「层级解析的已知局限」那个列表（`:209` 起）里根本没有有序列表这一条，不要去那里找。

五处：

1. `:29` 示例说明里 `以及被插件隐形携带、不显示的 frontmatter 其他键、散文段落和有序列表` → `以及被插件隐形携带、不显示的 frontmatter 其他键与散文段落`。
2. 内嵌副本与 Step 3 逐字同步：`:90` 那一行换成 Step 3 的三行；`:97`–`:99` 的 `## 备注` 段里 `以及「后续」下面那个有序列表 —— 它们都被隐形携带` → `—— 它们都被隐形携带`（保持整段的中文折行宽度与周围一致）。改完这份副本必须与 `examples/conference-talk.md` **逐字相同**。
3. `:129` `顶格的 ATX 标题（# 到 ######）与嵌套无序列表**共同**构成层级` → `与嵌套列表（无序 `-`/`*`/`+` 与有序 `1.`/`1)`）**共同**构成层级`；`:134` `标题名下的嵌套无序列表照旧` → `标题名下的嵌套列表照旧`。
4. `:141` `标题名下的散文段落、有序列表、表格、代码块、图片不在导图上显示` → 去掉「有序列表」。
5. 「写回归一化」一节（`:197` 起）：第二项末尾补「（有序与无序各自成列，空行两侧同类才压缩）」；第四项末尾补「`- ` 宽 2、`1. ` 宽 3，所以有序与无序混排时更容易撞上这一条」；最后那段「除此之外……包括 `*` / `+` 列表标记」里补上「有序项的序号与分隔符（不会被重排或拉回从 1 开始）」。

- [ ] **Step 7: 改 `README.md`**

与 Step 6 逐条对应的英文版。同样注意 `:85`–`:99` 是示例文件全文副本，**不是**一个 known-limits 列表；「Known limits of the hierarchy parsing」那一节里没有 ordered-list 条目，不要去那里删。

1. `:28` `a prose paragraph and an ordered list that the plugin carries along without showing` → `and a prose paragraph that the plugin carries along without showing`。
2. 内嵌副本与 Step 3 逐字同步：`:87` 那一行换成 Step 3 的三行；`:94`–`:96` 的 `## Notes` 段改成 Step 3 里那三行新文案。改完这份副本必须与 `examples/conference-talk.md` **逐字相同**。
3. `:128` `nested unordered lists` → `nested lists (unordered `-`/`*`/`+` and ordered `1.`/`1)`)`；`:132` `nested unordered lists work as before` → `nested lists work as before`。
4. `:140` `Prose paragraphs, ordered lists, tables, code blocks and images` → `Prose paragraphs, tables, code blocks and images`。
5. 「Write-back normalizations」一节：第 2 项末尾补 `(ordered and unordered are separate lists; a blank line is only compacted when both sides are the same kind)`；第 4 项末尾补 `` `- ` is two columns wide and `1. ` is three, so mixing ordered and unordered in one block hits this case more often``；最后那段补上 `ordered item numbers and delimiters (never renumbered or pulled back to start at 1)`。

- [ ] **Step 8: 改 `docs/MANUAL-VERIFICATION.md`**

`:326` 那条改成：

```markdown
- [x] 🔴 **打开这份文件，什么都不改，切回源码模式再 `git diff`：必须为空。** 这一条同时覆盖 frontmatter 其他键与散文段落两种「隐形携带」的内容
```

在同一节末尾新增两条：

```markdown
- [ ] 🔴 造一份纯有序列表笔记（`1. a` / `2. b` / 缩进的 `1. b1`），打开：三个节点都出现在图上，可双击编辑、可拖拽
- [ ] 🔴 在上面那份笔记的 `a` 后面按 Enter 加一个兄弟节点，切回源码模式：序号应是 `1. / 2. / 3.`（连续且沿用原起始号），且**其他列表块一个字不变**
- [ ] 🔴 造一份从 `3.` 起头的有序列表，打开再切走不做任何编辑：`git diff` 必须为空（起始号不被拉回 1）
```

- [ ] **Step 9: 门禁**

```bash
npm run typecheck && npm test && npm run build && npm run check:purity && npm run check:i18n
```

`check:i18n` 这一步是真门禁：Step 1 改的是 `src/i18n.ts` 的表本身（不受扫描约束），但如果不小心把中文写进了 `toolbar.ts` 的字面量就会红。

- [ ] **Step 10: 提交**

```bash
git add src/i18n.ts src/view/toolbar.ts src/model/tree-ops.ts src/model/parser.ts \
  examples/conference-talk.md README.md README.zh-CN.md AGENTS.md docs/MANUAL-VERIFICATION.md
git commit -m "$(cat <<'EOF'
docs: 有序列表不再是「隐形携带」的内容

界面上的删除禁用提示、四处代码注释里的列举、两份 README 的已知限制与
层级模型、AGENTS.md 的一句话架构与第 2 条、人工验证清单，全部同步。

示例文件里那行「有序列表永不成为节点」现在会变成一个节点、而它的文字
恰好在陈述被推翻的旧限制，换成真正在演示有序列表的三行。它与后面无序
项之间的空行由同类守卫保真，roundtrip 的示例文件断言覆盖这一点。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完成判据

- [ ] 设计文档第 1 节那份用户语料在导图视图里显示为 `测试标题 → 这是1 / 这是2`，`这是1` 下挂 `这是1.2` / `这是1.3`
- [ ] 五条门禁全绿
- [ ] `tests/roundtrip.test.ts` 的 `CORPUS` 只增不减，fast-check 生成器只扩不窄
- [ ] `src/view/**` 与 `styles.css` 零改动（`git diff --stat` 里不该出现它们，`toolbar.ts` 的注释除外）
- [ ] `docs/MANUAL-VERIFICATION.md` 里新增的三条由人在真实 Obsidian 里走一遍；**实现报告里不得声称视觉或交互行为正确**
