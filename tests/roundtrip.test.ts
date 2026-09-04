import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { serialize } from "../src/model/serializer";
import type { MindDoc, MindNode } from "../src/model/types";
import { FLAG_COLORS } from "../src/model/types";

/** 规范化 Markdown 语料：这些文本应满足 serialize(parse(md)) === md。 */
const CORPUS: string[] = [
  "# t\n\n- a\n",
  "# t\n\n- a\n  - b\n    - c\n- d\n",
  "---\nmindmap: true\n---\n\n# 工作内容\n\n- 呼叫中心\n  - (p1) 管理向\n",
  "---\ntitle: x\nzzz: 1\n---\n\n# t\n\n- (p3 60% flag:blue) a\n",
  "说明文字\n\n# t\n\n- a\n",
  "- a\n- b\n",
  "# t\n\n- a\n## 附录\n\n正文\n",
  "# t\n\n- a\n1. 步骤\n",
  "# t\n\n- a\n```js\nconst x = 1;\n```\n",
  "# t\n\n- a\n\n结尾说明\n",
  "# t\n\n- a\n  续行内容\n- b\n",
  "# t\n\n- (备注) 这是什么\n",
  "# t\n\n- (p1) (备注) 任务\n",
  "# t\n\n- 回答问题 [[业务手册]] **重要**\n",
  "# t\n\n- (p1)\n  - child\n",
  "# t\n\n- (p1) a\n  续行内容\n- b\n",
  "---\nmindmap: true\n---\n\n- a\n",
  "# t\n\n- a\n\n\n\n结尾说明\n",
  "# t\n\n- - 这个节点文字以短横线开头\n",
  "# t\n\n- # 这个节点文字以井号开头\n",
  // 以下六条是「写回不得做未获许可的归一化」的字节级回归：`*`/`+` 列表标记、
  // 标题行的空白排布、frontmatter 结束围栏的尾随空白，历史上都曾被静默改写。
  // 它们属于精选语料，不能靠 fuzz 生成器覆盖——safeText 刻意不含这些字符。
  "# t\n\n* a\n  * b\n",
  "# t\n\n+ a\n  + b\n",
  "# t\n\n* a\n  - b\n  + c\n",
  "#   t\n\n- a\n",
  "# t   \n\n- a\n",
  "---\nmindmap: true\n---  \n\n# t\n\n- a\n",
  // 缩进单位保留：文件用什么缩进单位，写回就用什么，不再统一改写成 2 空格
  // （见 MindDoc.indentUnit）。下面四条分别覆盖 Tab、4 空格、3 空格，以及
  // 三层以上的深层嵌套 Tab 缩进。
  "# t\n\n- a\n\t- b\n",
  "# t\n\n- a\n    - b\n",
  "# t\n\n- a\n   - b\n",
  "# t\n\n- a\n\t- b\n\t\t- c\n\t\t\t- d\n",
  // 缩进单位推断不依赖一级标题：无标题的任务列表/片段笔记同样常见，同样不该
  // 因为用导图视图打开过一次就被整篇改写缩进。
  "- a\n\t- b\n",
  "- a\n    - b\n",
  // 标题参与层级。前四条覆盖层级归属，后面几条覆盖「非节点行原样重放」——
  // 它们在改造前走的是文件末尾整段保留的路径，改造后走 continuation，
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
  // 标题也能带标记，写在 `#` 之后。第二条是未知 token 的括号组，按普通文字处理。
  // 第三条是根节点的 H1：它刻意不解析标记（hasHeading 为假时无处写回），
  // 所以 `(p1)` 是纯文字，两种解释下都必须逐字节还原。
  "# t\n\n## (p1) A\n\n- a\n",
  "# t\n\n## (p1 50% flag:red) A\n\n- a\n",
  "# t\n\n## (备注) A\n\n- a\n",
  "# (p1) t\n\n- a\n",
  "# t\n\n## A ##\n\n- a\n",
  "# t\n\n- a\n\n## A\n\n- b\n",
  "# t\n\n- a\n```md\n## 未闭合围栏跑到文件末尾\n",
  // 空行归属：散文 / 有序列表 / 围栏之后紧跟列表时，中间那个空行分隔的是块与
  // 列表，不是一个松散列表的两个项，必须保留。少了「前一条目未吸收续行」这个
  // 判据就会被当成松散列表的填充丢掉，那是第六条未获许可的归一化。
  "# t\n\n- a\n\n正文\n\n- c\n",
  "# t\n\n- a\n1. 步骤\n\n- b\n",
  "# t\n\n- a\n```js\nx\n```\n\n- b\n",
  "# t\n\n- a\n  续行\n\n- b\n",
  // 缩进单位按标题各自推断：不同标题名下用不同单位是保真的，不触发归一化第 4 条。
  "# t\n\n## A\n\n- a\n  - b\n\n## B\n\n- c\n    - d\n",
  "# t\n\n## A\n\n- a\n\t- b\n\n## B\n\n- c\n  - d\n",
  // 首块是平列表（推断不出单位）时，不应把兜底值当成全局单位去改写后面的块。
  "# t\n\n- a\n## B\n\n- b\n\t- c\n",
];

describe("serialize(parse(md)) === md", () => {
  for (const md of CORPUS) {
    it(`语料: ${JSON.stringify(md).slice(0, 50)}`, () => {
      expect(serialize(parse(md, "我的导图.md"))).toBe(md);
    });
  }
});

/** 仓库里的示例文件必须是规范形态：用户拷进 vault、用导图视图打开再切走，
 *  不该产生任何 diff。示例挂了就改示例，不要为迁就示例去改 parse/serialize。 */
describe("示例文件是规范形态", () => {
  for (const name of ["conference-talk.md"]) {
    it(name, () => {
      const md = readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
      expect(serialize(parse(md, name))).toBe(md);
    });
  }
});

/** 去掉 id，便于结构比较（id 不写入文件，往返后由 parser 重新分配）。
 *  `heading` 参与比较：节点形态和标题记住的缩进单位都必须往返保真，
 *  不比它就等于放过了「标题被写成列表项」这类结构性错误。 */
function stripIds(node: MindNode): unknown {
  return {
    text: node.text,
    marks: node.marks,
    collapsed: node.collapsed,
    continuation: node.continuation,
    bullet: node.bullet,
    heading: node.heading,
    children: node.children.map(stripIds),
  };
}

/** 生成对解析安全的节点文本：不含换行、括号、行首井号、首尾空白。 */
const safeText = fc
  .array(
    fc.constantFrom(..."abcxyz任务安排管理向数据0123".split("")),
    { minLength: 1, maxLength: 12 },
  )
  .map((chars) => chars.join(""));

const marksArb = fc.record(
  {
    priority: fc.option(fc.integer({ min: 1, max: 7 }), { nil: undefined }),
    progress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    flag: fc.option(fc.constantFrom(...FLAG_COLORS), { nil: undefined }),
  },
  { requiredKeys: [] },
);

/** 续行：留空，或恰好一行 2 空格缩进的续行文本（与写回缩进单位一致）。 */
const continuationArb = fc.constantFrom([] as string[], ["  续行内容"]);

/** 三种合法的无序列表标记，逐节点独立取值——同一文件里混用是合法 Markdown。 */
const bulletArb = fc.constantFrom(...(["-", "*", "+"] as const));

/** 列表项形态的节点（不带 heading）。 */
function itemNodeArb(depth: number): fc.Arbitrary<MindNode> {
  // depth 递减到 0 即停，因此可以直接递归构造，无需 fc.letrec。
  const childrenArb: fc.Arbitrary<MindNode[]> =
    depth <= 0 ? fc.constant([]) : fc.array(itemNodeArb(depth - 1), { maxLength: 3 });

  return fc.record({
    id: fc.constant("x"),
    text: safeText,
    marks: marksArb,
    children: childrenArb,
    collapsed: fc.constant(false),
    continuation: continuationArb,
    bullet: bulletArb,
  });
}

/** 标题名下的列表块里是否存在「列表项的列表项」——即文件里真会写出缩进的嵌套。 */
function hasNestedItem(items: readonly MindNode[]): boolean {
  return items.some((item) => item.children.length > 0);
}

const HEADING_UNITS = ["  ", "    ", "\t"] as const;

/**
 * 由一批列表项子节点推出该标题的 `indentUnit` 生成器。
 *
 * 取值必须等于「该标题名下真正会写进文本的那个单位」，否则生成的 doc 不是
 * 规范形态（`parse` 产不出来），属性测试就会报假反例：
 * - 没有列表项子节点 → `null`，`buildTree` 不会碰这个槽位
 * - 有，但块内无嵌套 → `"  "`，文本里没有缩进可推断，`detectIndentUnitString` 兜底
 * - 有，且块内有真实嵌套 → 任意单位，序列化写出它、`parse` 原样推回来
 *
 * 第三档是「不同标题各自记住不同缩进单位」这条新能力的随机化覆盖。把它简化成
 * 恒为 `"  "` 能让测试变绿，但属性测试就再也检验不到这件事了。
 */
function indentUnitArbFor(items: readonly MindNode[]): fc.Arbitrary<string | null> {
  if (items.length === 0) return fc.constant(null);
  if (!hasNestedItem(items)) return fc.constant("  ");
  return fc.constantFrom(...HEADING_UNITS);
}

/** 标题节点后面紧跟的内容：留空、一个空行、或一行缩进续行。 */
const headingContinuationArb = fc.constantFrom(
  [] as string[],
  [""],
  ["  续行内容"],
);

/**
 * 标题形态的节点。**所有生成的兄弟标题同为 level 2**：`## A` 后跟 `### B` 时
 * `buildTree` 的 pop 条件 `top.level >= entry.level` 是 `2 >= 3` 为假、不 pop，
 * B 必然成为 A 的子节点——「H2 与 H3 作为兄弟」在 Markdown 里不可表达，
 * 生成它只会产出规范形态之外的 doc。同级则 `2 >= 2` 为真、正常 pop 成兄弟。
 *
 * 标题节点只带列表项子节点，不带子标题：子标题的层级语义已由手写语料覆盖，
 * 这里要压的是每个标题各自的缩进单位。
 */
const headingNodeArb: fc.Arbitrary<MindNode> = fc
  .array(itemNodeArb(2), { maxLength: 2 })
  .chain((items) =>
    fc.record({
      id: fc.constant("x"),
      text: safeText,
      // 非根标题节点可以带标记，写在 `#` 之后（见 serializer 的 composeLine）。
      marks: marksArb,
      children: fc.constant(items),
      collapsed: fc.constant(false),
      continuation: headingContinuationArb,
      bullet: fc.constant("-" as const),
      heading: fc.record({
        level: fc.constant(2),
        prefix: fc.constantFrom("## ", "##   "),
        suffix: fc.constantFrom("", "   "),
        indentUnit: indentUnitArbFor(items),
      }),
    }),
  );

/**
 * frontmatter/preamble/continuation 是"原样写回"字段，其正确性才是这个插件的
 * 文件安全承诺所在，因此改用精选的真实取值组合做穷举式覆盖，而不是自由
 * 字符串——自由文本很容易被 parser 合法地重新解释（例如以列表项开头的续行
 * 会被吸收成列表项），产生假反例。
 *
 * 根节点的子节点按 list-before-heading 不变量排列：列表项在前、标题在后。
 * 顺序反了序列化出来的列表项会落在标题行之后，重新解析时就跑进那个标题名下，
 * 是 doc 不可表达而非缺陷。
 *
 * hasHeading 为 false 时有两个真实的 parser 行为要照顾：root.text 无处写回
 * （没有 H1 行可写），reparse 后只能等于 parse 对文件名的兜底取值；root 的
 * continuation 同样没有承载位置，parse 恒给 `[]`。因此按 hasHeading 分支构造，
 * 而不是让各字段互相独立自由组合。
 */
const docArb: fc.Arbitrary<MindDoc> = fc
  .record({
    hasHeading: fc.boolean(),
    items: fc.array(itemNodeArb(3), { maxLength: 3 }),
    headings: fc.array(headingNodeArb, { maxLength: 2 }),
  })
  .filter((seed) => seed.items.length + seed.headings.length > 0)
  .chain((seed) =>
    fc
      .record({
        frontmatter: fc.constantFrom(
          null,
          "mindmap: true",
          "title: x\nzzz: 1\nmindmap: true",
        ),
        frontmatterFenceSuffix: fc.constantFrom("", "  ", "\t"),
        // 无标题时 root.text 不会被写回文件，reparse 后落回 parse 对文件名的
        // 兜底取值（属性测试统一用 "我的导图.md" 调用 parse）。
        rootText: seed.hasHeading ? safeText : fc.constant("我的导图"),
        rootPrefix: seed.hasHeading
          ? fc.constantFrom("# ", "#   ", "#\t")
          : fc.constant("# "),
        rootSuffix: seed.hasHeading ? fc.constantFrom("", "   ") : fc.constant(""),
        // 无标题时没有 H1 行，根的续行没有承载位置，parse 恒给 []。
        rootContinuation: seed.hasHeading
          ? fc.constantFrom([] as string[], [""], ["", ""], ["", "结尾说明"])
          : fc.constant([] as string[]),
        // 根名下那个列表块的单位，规则同 indentUnitArbFor。
        rootIndentUnit: indentUnitArbFor(seed.items),
        preamble: fc.constantFrom("", "说明文字\n\n"),
      })
      .map((raw): MindDoc => ({
        // 兜底值，只在整条标题祖先链都没有单位时才被 serialize 用到。
        indentUnit: "  ",
        frontmatter: raw.frontmatter,
        // 无 frontmatter 时结束围栏根本不存在，其尾随空白只能是空串。
        frontmatterFenceSuffix:
          raw.frontmatter === null ? "" : raw.frontmatterFenceSuffix,
        hasHeading: seed.hasHeading,
        root: {
          id: "n0",
          text: raw.rootText,
          marks: {},
          children: [...seed.items, ...seed.headings],
          collapsed: false,
          continuation: raw.rootContinuation,
          // 根节点没有自己的列表行，parser 用文件里第一个列表项的标记字符回填。
          bullet: firstItemBullet([...seed.items, ...seed.headings]) ?? "-",
          heading: {
            level: 1,
            prefix: raw.rootPrefix,
            suffix: raw.rootSuffix,
            indentUnit: raw.rootIndentUnit,
          },
        },
        preamble: raw.preamble,
      })),
  );

/** 前序遍历找出第一个列表项形态节点的 bullet，对齐 parser 的回填规则。 */
function firstItemBullet(nodes: readonly MindNode[]): MindNode["bullet"] | null {
  for (const node of nodes) {
    if (node.heading === undefined) return node.bullet;
    const nested = firstItemBullet(node.children);
    if (nested !== null) return nested;
  }
  return null;
}

describe("已知归一化", () => {
  it("松散列表（列表项之间的空行）被归一化为紧凑列表", () => {
    expect(serialize(parse("# t\n\n- a\n\n- b\n", "x.md"))).toBe(
      "# t\n\n- a\n- b\n",
    );
  });

  it("不以换行结尾的文件被补上尾换行", () => {
    expect(serialize(parse("# t\n\n- a", "x.md"))).toBe("# t\n\n- a\n");
  });

  it("列表项之间有两个空行时同样被归一化为紧凑列表", () => {
    expect(serialize(parse("# t\n\n- a\n\n\n- b\n", "x.md"))).toBe(
      "# t\n\n- a\n- b\n",
    );
  });

  it("缩进单位混用（空格与 Tab 并存）时无法归纳出单一单位，兜底为 2 空格", () => {
    // b 用 2 空格缩进、c 用 1 个 Tab 缩进：两者长度不同又不互为整数倍，
    // detectIndentUnitString 判定文件没有单一一致的缩进单位。
    expect(serialize(parse("# t\n\n- a\n  - b\n\t- c\n", "x.md"))).toBe(
      "# t\n\n- a\n  - b\n    - c\n",
    );
  });
});

describe("parse(serialize(doc)) 结构等于 doc", () => {
  it("对随机文档成立", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const back = parse(serialize(doc), "我的导图.md");
        expect(stripIds(back.root)).toEqual(stripIds(doc.root));
        expect(back.frontmatter).toBe(doc.frontmatter);
        expect(back.frontmatterFenceSuffix).toBe(doc.frontmatterFenceSuffix);
        expect(back.hasHeading).toBe(doc.hasHeading);
        expect(back.preamble).toBe(doc.preamble);
      }),
      { numRuns: 300 },
    );
  });
});
