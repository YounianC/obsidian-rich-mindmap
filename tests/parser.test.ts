import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { serialize } from "../src/model/serializer";
import { isHeading } from "../src/model/types";

const SAMPLE = `---
title: 我的笔记
mindmap: true
---

# 工作内容

- 呼叫中心
  - (p1) 管理向
    - 任务安排
  - 业务向
- WP
`;

describe("parse", () => {
  it("提取 frontmatter 原始文本", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.frontmatter).toBe("title: 我的笔记\nmindmap: true");
  });

  it("一级标题作为根节点", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.hasHeading).toBe(true);
    expect(doc.root.text).toBe("工作内容");
    expect(doc.root.id).toBe("n0");
  });

  it("按缩进构建层级", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["呼叫中心", "WP"]);
    const callCenter = doc.root.children[0];
    expect(callCenter.children.map((c) => c.text)).toEqual(["管理向", "业务向"]);
    expect(callCenter.children[0].marks).toEqual({ priority: 1 });
    expect(callCenter.children[0].children.map((c) => c.text)).toEqual([
      "任务安排",
    ]);
  });

  it("id 按前序遍历递增", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.root.children[0].id).toBe("n1");
    expect(doc.root.children[0].children[0].id).toBe("n2");
    expect(doc.root.children[0].children[0].children[0].id).toBe("n3");
  });

  it("解析出的节点 collapsed 均为 false", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.root.children[0].collapsed).toBe(false);
  });

  it("无 frontmatter 时为 null", () => {
    const doc = parse("# 标题\n\n- a\n", "x.md");
    expect(doc.frontmatter).toBeNull();
  });

  it("无一级标题时用文件名作根节点", () => {
    const doc = parse("- a\n- b\n", "我的导图.md");
    expect(doc.hasHeading).toBe(false);
    expect(doc.root.text).toBe("我的导图");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("无列表块时只有根节点，散文进根的 continuation", () => {
    const doc = parse("# 标题\n\n一段普通文字\n", "x.md");
    expect(doc.root.children).toEqual([]);
    expect(doc.root.continuation).toEqual(["", "一段普通文字"]);
  });

  it("兼容 4 空格缩进", () => {
    const doc = parse("# t\n\n- a\n    - b\n", "x.md");
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("兼容 Tab 缩进", () => {
    const doc = parse("# t\n\n- a\n\t- b\n", "x.md");
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("缩进跳跃时挂到最近合法父节点", () => {
    const doc = parse("# t\n\n- a\n      - b\n", "x.md");
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("标题行不再终止列表块，成为新的父节点", () => {
    const doc = parse("# t\n\n- a\n## 附录\n- b\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "附录"]);
    expect(doc.root.children[1].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("有序列表行归入上一节点的续行", () => {
    const doc = parse("# t\n\n- a\n1. 步骤\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["1. 步骤"]);
  });

  it("代码块围栏归入上一节点的续行", () => {
    const doc = parse("# t\n\n- a\n```js\nx\n```\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["```js", "x", "```"]);
  });

  it("空行后接非列表行归入上一节点的续行", () => {
    const doc = parse("# t\n\n- a\n\n结尾说明\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["", "结尾说明"]);
  });

  it("空行后接列表行不终止列表块", () => {
    const doc = parse("# t\n\n- a\n\n- b\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("非列表缩进行作为上一节点的续行", () => {
    const doc = parse("# t\n\n- a\n  续行内容\n- b\n", "x.md");
    expect(doc.root.children[0].continuation).toEqual(["  续行内容"]);
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("保留标题之前的前言", () => {
    const doc = parse("说明文字\n\n# t\n\n- a\n", "x.md");
    expect(doc.preamble).toBe("说明文字\n\n");
    expect(doc.root.text).toBe("t");
  });

  it("保留标题与列表块之间的空行（进根节点的 continuation）", () => {
    const doc = parse("# t\n\n- a\n", "x.md");
    expect(doc.root.continuation).toEqual([""]);
  });

  it("节点文本保留 Markdown 行内语法", () => {
    const doc = parse("# t\n\n- (p2) 回答问题 [[业务手册]] **重要**\n", "x.md");
    expect(doc.root.children[0].text).toBe("回答问题 [[业务手册]] **重要**");
  });

  it("支持 * 与 + 作为列表标记", () => {
    const doc = parse("# t\n\n* a\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
  });

  it("CRLF 文档解析结果与 LF 等价", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    const doc = parse(crlf, "工作内容.md");
    expect(doc.hasHeading).toBe(true);
    expect(doc.root.text).toBe("工作内容");
    expect(doc.root.children.map((c) => c.text)).toEqual(["呼叫中心", "WP"]);
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual([
      "管理向",
      "业务向",
    ]);
    expect(
      doc.root.children[0].children[0].children.map((c) => c.text),
    ).toEqual(["任务安排"]);
  });

  it("CRLF 文档的 preamble 与各节点续行都不含 \\r", () => {
    const crlf = "说明文字\r\n\r\n# t\r\n\r\n- a\r\n\r\n结尾说明\r\n";
    const doc = parse(crlf, "x.md");
    expect(doc.preamble).toBe("说明文字\n\n");
    expect(doc.root.continuation).toEqual([""]);
    // 深相等而不是 not.toContain("\r")：原来那句对这个输入不可能失败，因为
    // `结尾说明` 那段已经不在 root.continuation 里，而是在列表项 a 的续行里。
    expect(doc.root.children[0].continuation).toEqual(["", "结尾说明"]);
  });

  it("孤立的 \\r（非 \\r\\n）不被归一化，原样保留", () => {
    const doc = parse("# t\n\n- a\n  续\r行\n- b\n", "x.md");
    expect(doc.root.children[0].continuation).toEqual(["  续\r行"]);
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "b"]);
  });
});

describe("标题参与层级", () => {
  it("有 H1 时根节点带 heading，prefix/suffix 逐字保留", () => {
    const doc = parse("#   t   \n\n- a\n", "我的导图.md");
    expect(isHeading(doc.root)).toBe(true);
    expect(doc.root.heading?.level).toBe(1);
    expect(doc.root.heading?.prefix).toBe("#   ");
    expect(doc.root.heading?.suffix).toBe("   ");
  });

  it("无 H1 时根节点仍是标题形态，hasHeading 为 false", () => {
    const doc = parse("- a\n", "我的导图.md");
    expect(isHeading(doc.root)).toBe(true);
    expect(doc.hasHeading).toBe(false);
    expect(doc.root.heading?.prefix).toBe("# ");
  });

  it("列表项不是标题形态", () => {
    const doc = parse("# t\n\n- a\n", "我的导图.md");
    expect(isHeading(doc.root.children[0])).toBe(false);
    expect(doc.root.children[0].heading).toBeUndefined();
  });

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

  it("标题文字同样解析行内标记", () => {
    const doc = parse("# t\n\n## (p1 50% flag:red) A\n", "我的导图.md");
    expect(doc.root.children[0].text).toBe("A");
    expect(doc.root.children[0].marks).toEqual({
      priority: 1,
      progress: 50,
      flag: "red",
    });
  });

  it("标题里未知 token 的括号组仍按普通文字处理", () => {
    const doc = parse("# t\n\n## (备注) A\n", "我的导图.md");
    expect(doc.root.children[0].text).toBe("(备注) A");
    expect(doc.root.children[0].marks).toEqual({});
  });

  it("根节点的 H1 不解析标记（没有可靠的写回位置）", () => {
    const doc = parse("# (p1) t\n\n- a\n", "我的导图.md");
    expect(doc.root.text).toBe("(p1) t");
    expect(doc.root.marks).toEqual({});
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

  it("未闭合围栏延续到文件末尾，不产生节点", () => {
    const doc = parse("# t\n\n- a\n```md\n## 假标题\n- 假条目\n", "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toHaveLength(3);
  });

  it("带前导空格的标题不认，进 continuation", () => {
    const doc = parse("# t\n\n- a\n  ## 不是标题\n", "我的导图.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toEqual(["  ## 不是标题"]);
  });

  it("id 按文档顺序分配，根为 n0", () => {
    const doc = parse("# t\n\n- a\n## A\n\n- b\n", "我的导图.md");
    expect(doc.root.id).toBe("n0");
    expect(doc.root.children.map((c) => c.id)).toEqual(["n1", "n2"]);
    expect(doc.root.children[1].children.map((c) => c.id)).toEqual(["n3"]);
  });

  it("非根标题下的嵌套列表：深度从最近标题祖先算起", () => {
    const doc = parse("# t\n\n### C\n\n- a\n  - b\n", "我的导图.md");
    const c = doc.root.children[0];
    expect(c.children.map((n) => n.text)).toEqual(["a"]);
    expect(c.children[0].children.map((n) => n.text)).toEqual(["b"]);
  });
});

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

describe("对抗性输入", () => {
  /** 断言解析耗时上限，同时返回 doc 供结构化断言——只测时间会漏掉
   *  「整篇退化成 continuation 却因 round-trip 恒等而蒙混过关」。 */
  const parseWithin = (md: string, ms: number): ReturnType<typeof parse> => {
    const started = Date.now();
    const doc = parse(md, "我的导图.md");
    expect(Date.now() - started).toBeLessThan(ms);
    return doc;
  };

  it("每行都是标题的长文件：线性时间，层级正确", () => {
    const md = "# t\n" + Array.from({ length: 4000 }, (_, i) => `## A${i}\n`).join("");
    const doc = parseWithin(md, 1000);
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

  it("大量围栏行：不产生节点，不卡死", () => {
    const md = "# t\n\n- a\n" + "```\n".repeat(8000);
    const doc = parseWithin(md, 1000);
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.root.children[0].continuation).toHaveLength(8000);
  });

  it("深层嵌套列表：确实建出对应深度，不是拍平到根下", () => {
    const md =
      "# t\n\n" +
      Array.from({ length: 2000 }, (_, i) => `${"  ".repeat(i)}- a${i}\n`).join("");
    const doc = parseWithin(md, 2000);
    let node = doc.root;
    let depth = 0;
    while (node.children.length > 0) {
      node = node.children[0];
      depth++;
    }
    expect(depth).toBe(2000);
  });

  it("上述四种形态在较小规模下全部 round-trip", () => {
    const inputs = [
      "# t\n" + Array.from({ length: 500 }, (_, i) => `## A${i}\n`).join(""),
      "# t\n" +
        Array.from({ length: 500 }, (_, i) => `## A${i}\n- a${i}\n  - b${i}\n`).join(""),
      "# t\n\n- a\n" + "```\n".repeat(500),
      "# t\n\n" +
        Array.from({ length: 500 }, (_, i) => `${"  ".repeat(i)}- a${i}\n`).join(""),
    ];
    for (const md of inputs) {
      expect(serialize(parse(md, "我的导图.md"))).toBe(md);
    }
  });
});
