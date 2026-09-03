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
];

describe("serialize(parse(md)) === md", () => {
  for (const md of CORPUS) {
    it(`语料: ${JSON.stringify(md).slice(0, 50)}`, () => {
      expect(serialize(parse(md, "我的导图.md"))).toBe(md);
    });
  }
});

/** 去掉 id，便于结构比较（id 不写入文件，往返后由 parser 重新分配）。 */
function stripIds(node: MindNode): unknown {
  return {
    text: node.text,
    marks: node.marks,
    collapsed: node.collapsed,
    continuation: node.continuation,
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

function nodeArb(depth: number): fc.Arbitrary<MindNode> {
  // depth 递减到 0 即停，因此可以直接递归构造，无需 fc.letrec。
  const childrenArb: fc.Arbitrary<MindNode[]> =
    depth <= 0 ? fc.constant([]) : fc.array(nodeArb(depth - 1), { maxLength: 3 });

  return fc.record({
    id: fc.constant("x"),
    text: safeText,
    marks: marksArb,
    children: childrenArb,
    collapsed: fc.constant(false),
    continuation: continuationArb,
  });
}

/**
 * frontmatter/preamble/headingGap/tail/continuation 是"原样写回"字段，其正确性
 * 才是本任务的文件安全承诺所在，因此改用精选的真实取值组合做穷举式覆盖，而不是
 * 自由字符串——自由文本很容易被 parser 合法地重新解释（例如以列表项开头的 tail
 * 会被吸收进列表块），产生假反例。
 *
 * hasHeading 为 false 时有一个真实的 parser 行为需要照顾：H1 缺失时
 * preamble 恒为 ""，标题前的一切内容都被折进 headingGap（见 parser.ts 中
 * hasHeading 分支）；同时 root.text 无处写回（没有 H1 行可写），reparse 后
 * 只能等于 parse 对文件名的兜底取值。因此按 hasHeading 分支构造，而不是让
 * 各字段互相独立自由组合。
 */
const docArb: fc.Arbitrary<MindDoc> = fc.boolean().chain((hasHeading) =>
  fc.record({
    frontmatter: fc.constantFrom(
      null,
      "mindmap: true",
      "title: x\nzzz: 1\nmindmap: true",
    ),
    hasHeading: fc.constant(hasHeading),
    root: fc.record({
      id: fc.constant("n0"),
      // 无标题时 root.text 不会被写回文件，reparse 后落回 parse 对文件名的
      // 兜底取值（属性测试统一用 "我的导图.md" 调用 parse）。
      text: hasHeading ? safeText : fc.constant("我的导图"),
      marks: fc.constant({}),
      children: fc.array(nodeArb(3), { minLength: 1, maxLength: 4 }),
      collapsed: fc.constant(false),
      continuation: fc.constant([] as string[]),
    }),
    preamble: hasHeading ? fc.constantFrom("", "说明文字\n\n") : fc.constant(""),
    headingGap: fc.constantFrom("\n", "\n\n"),
    tail: fc.constantFrom(
      "",
      "\n结尾说明\n",
      "\n\n\n多个空行之后\n",
      "## 附录\n- b\n",
      "1. 步骤\n",
    ),
  }),
);

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
});

describe("parse(serialize(doc)) 结构等于 doc", () => {
  it("对随机文档成立", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const back = parse(serialize(doc), "我的导图.md");
        expect(stripIds(back.root)).toEqual(stripIds(doc.root));
        expect(back.frontmatter).toBe(doc.frontmatter);
        expect(back.hasHeading).toBe(doc.hasHeading);
        expect(back.preamble).toBe(doc.preamble);
        expect(back.headingGap).toBe(doc.headingGap);
        expect(back.tail).toBe(doc.tail);
      }),
      { numRuns: 300 },
    );
  });
});
