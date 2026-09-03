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
    continuation: fc.constant([] as string[]),
  });
}

const docArb: fc.Arbitrary<MindDoc> = fc.record({
  frontmatter: fc.constant(null),
  hasHeading: fc.constant(true),
  root: fc.record({
    id: fc.constant("n0"),
    text: safeText,
    marks: fc.constant({}),
    children: fc.array(nodeArb(3), { minLength: 1, maxLength: 4 }),
    collapsed: fc.constant(false),
    continuation: fc.constant([] as string[]),
  }),
  preamble: fc.constant(""),
  headingGap: fc.constant("\n"),
  tail: fc.constant(""),
});

describe("已知归一化", () => {
  it("松散列表（列表项之间的空行）被归一化为紧凑列表", () => {
    expect(serialize(parse("# t\n\n- a\n\n- b\n", "x.md"))).toBe(
      "# t\n\n- a\n- b\n",
    );
  });

  it("不以换行结尾的文件被补上尾换行", () => {
    expect(serialize(parse("# t\n\n- a", "x.md"))).toBe("# t\n\n- a\n");
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
