import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";

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

  it("无列表块时只有根节点", () => {
    const doc = parse("# 标题\n\n一段普通文字\n", "x.md");
    expect(doc.root.children).toEqual([]);
    expect(doc.tail).toBe("\n一段普通文字\n");
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

  it("标题行终止列表块", () => {
    const doc = parse("# t\n\n- a\n## 附录\n- b\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.tail).toBe("## 附录\n- b\n");
  });

  it("有序列表项终止列表块", () => {
    const doc = parse("# t\n\n- a\n1. 步骤\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.tail).toBe("1. 步骤\n");
  });

  it("代码块围栏终止列表块", () => {
    const doc = parse("# t\n\n- a\n```js\nx\n```\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.tail).toBe("```js\nx\n```\n");
  });

  it("空行后接非列表行终止列表块", () => {
    const doc = parse("# t\n\n- a\n\n结尾说明\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.tail).toBe("\n结尾说明\n");
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

  it("保留标题与列表块之间的空行", () => {
    const doc = parse("# t\n\n- a\n", "x.md");
    expect(doc.headingGap).toBe("\n");
  });

  it("节点文本保留 Markdown 行内语法", () => {
    const doc = parse("# t\n\n- (p2) 回答问题 [[业务手册]] **重要**\n", "x.md");
    expect(doc.root.children[0].text).toBe("回答问题 [[业务手册]] **重要**");
  });

  it("支持 * 与 + 作为列表标记", () => {
    const doc = parse("# t\n\n* a\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
  });
});
