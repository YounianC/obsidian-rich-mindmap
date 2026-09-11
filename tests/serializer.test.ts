import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { serialize } from "../src/model/serializer";
import type { MindDoc, MindNode } from "../src/model/types";

describe("serialize", () => {
  it("保留文件原有的 4 空格缩进单位", () => {
    const doc = parse("# t\n\n- a\n    - b\n        - c\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- a\n    - b\n        - c\n");
  });

  it("保留文件原有的 Tab 缩进单位", () => {
    const doc = parse("# t\n\n- a\n\t- b\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- a\n\t- b\n");
  });

  it("缩进单位混用（空格与 Tab 并存）时兜底为 2 空格", () => {
    const doc = parse("# t\n\n- a\n  - b\n\t- c\n", "x.md");
    expect(doc.indentUnit).toBe("  ");
  });

  it("* 与 + 列表标记原样保留，不归一化为 -", () => {
    const doc = parse("# t\n\n* a\n+ b\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n* a\n+ b\n");
  });

  it("标题行的空白排布原样保留", () => {
    expect(serialize(parse("#   t   \n\n- a\n", "x.md"))).toBe("#   t   \n\n- a\n");
  });

  it("frontmatter 结束围栏的尾随空白原样保留", () => {
    const md = "---\nmindmap: true\n---  \n\n# t\n\n- a\n";
    expect(serialize(parse(md, "x.md"))).toBe(md);
  });

  it("标记按固定顺序写回", () => {
    const doc = parse("# t\n\n- (flag:blue 60% p3) a\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- (p3 60% flag:blue) a\n");
  });

  it("空文本节点带标记时不产生尾随空格", () => {
    const doc = parse("# t\n\n- (p1)\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- (p1)\n");
  });

  it("无一级标题时不写标题行", () => {
    const doc = parse("- a\n", "我的导图.md");
    expect(serialize(doc)).toBe("- a\n");
  });

  it("frontmatter 未知键与顺序原样保留", () => {
    const md = "---\nzzz: 1\naaa: 2\nmindmap: true\n---\n\n# t\n\n- a\n";
    expect(serialize(parse(md, "x.md"))).toBe(md);
  });

  it("续行原样写回", () => {
    const md = "# t\n\n- a\n  续行内容\n- b\n";
    expect(serialize(parse(md, "x.md"))).toBe(md);
  });

  it("根节点的 marks 不参与序列化：H1 行没有标记语法的位置", () => {
    const doc = parse("# t\n\n- a\n", "x.md");
    // 正常路径下 parser 永远不会给 root 设置 marks；这里手工构造以锁定意图——
    // 即便未来有代码不慎往 root.marks 写入内容，H1 行也绝不能出现标记组。
    doc.root.marks = { priority: 3, progress: 50, flag: "red" };
    expect(serialize(doc)).toBe("# t\n\n- a\n");
  });
});

/** 手搭一个最小的列表项节点，绕开 parser 直接压序列化分支。 */
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
    expect(serialize(docWith([item("a", { ordered: { number: 3, delim: "." } })]))).toBe(
      "# t\n3. a\n",
    );
  });

  it("`)` 分隔符原样写出", () => {
    expect(serialize(docWith([item("a", { ordered: { number: 1, delim: ")" } })]))).toBe(
      "# t\n1) a\n",
    );
  });

  it("有序节点的 bullet 是死字段，不影响写出", () => {
    const doc = docWith([item("a", { bullet: "*", ordered: { number: 7, delim: "." } })]);
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

  it("根节点回填的 ordered 不影响它的标题行", () => {
    // parse 会把「文件里第一个列表项的形态」回填到根上，isOrdered(root) 因此为真；
    // 根走 heading.prefix 那条独立分支，绝不能写成 `1. t`。
    const doc = parse("# t\n\n1) a\n", "x.md");
    expect(doc.root.ordered).toEqual({ number: 1, delim: ")" });
    expect(serialize(doc)).toBe("# t\n\n1) a\n");
  });
});
