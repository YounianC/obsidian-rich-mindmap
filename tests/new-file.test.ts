import { describe, expect, it } from "vitest";
import { newMindmapContent, uniqueMindmapPath } from "../src/model/new-file";
import { parse } from "../src/model/parser";
import { serialize } from "../src/model/serializer";

describe("uniqueMindmapPath", () => {
  it("库根目录下不带前缀", () => {
    expect(uniqueMindmapPath("/", () => false)).toBe("未命名思维导图.md");
  });

  it("子目录下用 / 拼接", () => {
    expect(uniqueMindmapPath("笔记/项目", () => false)).toBe(
      "笔记/项目/未命名思维导图.md",
    );
  });

  it("已存在时从 1 开始编号，跳过所有已占用的名字", () => {
    const taken = new Set([
      "未命名思维导图.md",
      "未命名思维导图 1.md",
      "未命名思维导图 2.md",
    ]);
    expect(uniqueMindmapPath("/", (p) => taken.has(p))).toBe("未命名思维导图 3.md");
  });

  it("存在性判断收到的是完整路径", () => {
    const seen: string[] = [];
    uniqueMindmapPath("a/b", (p) => {
      seen.push(p);
      return seen.length < 2;
    });
    expect(seen).toEqual(["a/b/未命名思维导图.md", "a/b/未命名思维导图 1.md"]);
  });
});

describe("newMindmapContent", () => {
  it("生成带 mindmap: true 与一级标题的内容，末尾有换行", () => {
    expect(newMindmapContent("未命名思维导图 1")).toBe(
      "---\nmindmap: true\n---\n\n# 未命名思维导图 1\n",
    );
  });

  it("能被 parse 解析出正确的根节点，且 round-trip 恒等", () => {
    const content = newMindmapContent("未命名思维导图");
    const doc = parse(content, "未命名思维导图.md");
    expect(doc.root.text).toBe("未命名思维导图");
    expect(doc.root.children).toEqual([]);
    expect(doc.hasHeading).toBe(true);
    expect(doc.frontmatter).toBe("mindmap: true");
    expect(serialize(doc)).toBe(content);
  });
});
