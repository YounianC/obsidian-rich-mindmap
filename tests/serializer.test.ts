import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { serialize } from "../src/model/serializer";

describe("serialize", () => {
  it("缩进统一为 2 空格", () => {
    const doc = parse("# t\n\n- a\n    - b\n        - c\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- a\n  - b\n    - c\n");
  });

  it("Tab 缩进归一化为 2 空格", () => {
    const doc = parse("# t\n\n- a\n\t- b\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- a\n  - b\n");
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
