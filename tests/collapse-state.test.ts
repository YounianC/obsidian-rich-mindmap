import { describe, expect, it } from "vitest";
import {
  applyCollapsedPaths,
  collectCollapsedPaths,
  encodeSegment,
  nodePaths,
  readCollapsed,
  setMindmapFlag,
  writeCollapsed,
} from "../src/model/collapse-state";
import { parse } from "../src/model/parser";
import type { MindNode } from "../src/model/types";

function tree(): MindNode {
  return parse("# 工作内容\n\n- 呼叫中心\n  - 业务向\n    - 自测\n- WP\n", "x.md")
    .root;
}

describe("encodeSegment", () => {
  it("转义反斜杠与斜杠", () => {
    expect(encodeSegment("a/b")).toBe("a\\/b");
    expect(encodeSegment("a\\b")).toBe("a\\\\b");
    expect(encodeSegment("a\\/b")).toBe("a\\\\\\/b");
  });
});

describe("nodePaths", () => {
  it("路径不含根节点文本", () => {
    const paths = nodePaths(tree());
    expect([...paths.values()]).toEqual([
      "呼叫中心",
      "呼叫中心/业务向",
      "呼叫中心/业务向/自测",
      "WP",
    ]);
  });

  it("根节点自身不产生路径", () => {
    const root = tree();
    expect(nodePaths(root).has(root.id)).toBe(false);
  });
});

describe("applyCollapsedPaths / collectCollapsedPaths", () => {
  it("按路径设置折叠标记", () => {
    const next = applyCollapsedPaths(tree(), ["呼叫中心/业务向"]);
    expect(next.children[0].collapsed).toBe(false);
    expect(next.children[0].children[0].collapsed).toBe(true);
  });

  it("不修改原树", () => {
    const root = tree();
    applyCollapsedPaths(root, ["呼叫中心"]);
    expect(root.children[0].collapsed).toBe(false);
  });

  it("路径匹配失败时静默忽略", () => {
    const next = applyCollapsedPaths(tree(), ["不存在/的路径"]);
    expect(collectCollapsedPaths(next)).toEqual([]);
  });

  it("与 collectCollapsedPaths 往返一致", () => {
    const paths = ["呼叫中心/业务向", "WP"];
    const next = applyCollapsedPaths(tree(), paths);
    expect(collectCollapsedPaths(next).sort()).toEqual([...paths].sort());
  });
});

describe("readCollapsed", () => {
  it("读取双引号块序列", () => {
    const fm = 'title: x\nmindmap-collapsed:\n  - "呼叫中心/业务向"\n  - "WP"';
    expect(readCollapsed(fm)).toEqual(["呼叫中心/业务向", "WP"]);
  });

  it("兼容裸标量", () => {
    const fm = "mindmap-collapsed:\n  - WP";
    expect(readCollapsed(fm)).toEqual(["WP"]);
  });

  it("兼容空的流式写法", () => {
    expect(readCollapsed("mindmap-collapsed: []")).toEqual([]);
  });

  it("无该键或无 frontmatter 时返回空数组", () => {
    expect(readCollapsed("title: x")).toEqual([]);
    expect(readCollapsed(null)).toEqual([]);
  });

  it("不越界读到下一个键", () => {
    const fm = "mindmap-collapsed:\n  - WP\nmindmap: true";
    expect(readCollapsed(fm)).toEqual(["WP"]);
  });
});

describe("writeCollapsed", () => {
  it("在保留其他键与顺序的前提下新增该键", () => {
    expect(writeCollapsed("zzz: 1\naaa: 2", ["WP"])).toBe(
      'zzz: 1\naaa: 2\nmindmap-collapsed:\n  - "WP"',
    );
  });

  it("替换已有该键且不动其他键", () => {
    const fm = 'zzz: 1\nmindmap-collapsed:\n  - "旧"\nmindmap: true';
    expect(writeCollapsed(fm, ["新"])).toBe(
      'zzz: 1\nmindmap-collapsed:\n  - "新"\nmindmap: true',
    );
  });

  it("空数组时删除该键", () => {
    const fm = 'zzz: 1\nmindmap-collapsed:\n  - "旧"\nmindmap: true';
    expect(writeCollapsed(fm, [])).toBe("zzz: 1\nmindmap: true");
  });

  it("删到 frontmatter 为空时返回 null", () => {
    expect(writeCollapsed('mindmap-collapsed:\n  - "旧"', [])).toBeNull();
  });

  it("无 frontmatter 时新建", () => {
    expect(writeCollapsed(null, ["WP"])).toBe(
      'mindmap-collapsed:\n  - "WP"',
    );
  });

  it("路径中的特殊字符被 JSON 转义", () => {
    expect(writeCollapsed(null, ['含"引号', "含:冒号"])).toBe(
      'mindmap-collapsed:\n  - "含\\"引号"\n  - "含:冒号"',
    );
  });
});

describe("setMindmapFlag", () => {
  it("新增键", () => {
    expect(setMindmapFlag("title: x", true)).toBe("title: x\nmindmap: true");
  });

  it("已存在时替换", () => {
    expect(setMindmapFlag("mindmap: false\ntitle: x", true)).toBe(
      "mindmap: true\ntitle: x",
    );
  });

  it("无 frontmatter 时新建", () => {
    expect(setMindmapFlag(null, true)).toBe("mindmap: true");
  });
});

describe("frontmatter key boundary detection (保存非拥有键)", () => {
  it("中文键在拥有键之后被保留", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\n名字: 张三\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toContain("名字: 张三");
    expect(result).toContain("title: x");
    expect(result).toBe('mindmap-collapsed:\n  - "new"\n名字: 张三\ntitle: x');
  });

  it("dotted 键在拥有键之后被保留", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\nmy.key: 1\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toContain("my.key: 1");
    expect(result).toContain("title: x");
    expect(result).toBe('mindmap-collapsed:\n  - "new"\nmy.key: 1\ntitle: x');
  });

  it("空行在拥有键之后被保留", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\n\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toBe('mindmap-collapsed:\n  - "new"\n\ntitle: x');
  });

  it("注释行在拥有键之后被保留", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\n# comment\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toContain("# comment");
    expect(result).toBe('mindmap-collapsed:\n  - "new"\n# comment\ntitle: x');
  });

  it("非拥有块序列键在拥有键之后被保留", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\ntags:\n  - a\n  - b\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toContain("tags:");
    expect(result).toContain("  - a");
    expect(result).toContain("  - b");
    expect(result).toBe(
      'mindmap-collapsed:\n  - "new"\ntags:\n  - a\n  - b\ntitle: x',
    );
  });

  it("嵌套映射在拥有键之后被保留", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\nobj:\n  sub: 1\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toContain("obj:");
    expect(result).toContain("  sub: 1");
    expect(result).toBe(
      'mindmap-collapsed:\n  - "new"\nobj:\n  sub: 1\ntitle: x',
    );
  });

  it("多行块标量在拥有键之后被保留", () => {
    const fm =
      'mindmap-collapsed:\n  - "old"\ndescription: |\n  line 1\n  line 2\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toContain("description: |");
    expect(result).toContain("  line 1");
    expect(result).toContain("  line 2");
    expect(result).toBe(
      'mindmap-collapsed:\n  - "new"\ndescription: |\n  line 1\n  line 2\ntitle: x',
    );
  });

  it("拥有键作为第一个键时被正确替换", () => {
    const fm =
      'mindmap-collapsed:\n  - "old"\nmindmap: true\ntitle: x\n名字: 张三';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toBe(
      'mindmap-collapsed:\n  - "new"\nmindmap: true\ntitle: x\n名字: 张三',
    );
  });

  it("拥有键作为最后一个键时被正确替换", () => {
    const fm = 'title: x\n名字: 张三\nmindmap-collapsed:\n  - "old"';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toBe('title: x\n名字: 张三\nmindmap-collapsed:\n  - "new"');
  });

  it("拥有键在中间时被正确替换，前后键都被保留", () => {
    const fm = 'title: x\nmindmap-collapsed:\n  - "old"\n名字: 张三';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toBe('title: x\nmindmap-collapsed:\n  - "new"\n名字: 张三');
  });

  it("值中包含冒号时被正确处理", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\ndesc: "value: with colon"\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toContain('desc: "value: with colon"');
    expect(result).toBe(
      'mindmap-collapsed:\n  - "new"\ndesc: "value: with colon"\ntitle: x',
    );
  });

  it("值中包含井号时被正确处理", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\ndesc: "value # hash"\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toContain('desc: "value # hash"');
    expect(result).toBe(
      'mindmap-collapsed:\n  - "new"\ndesc: "value # hash"\ntitle: x',
    );
  });

  it("中文键之后的 setMindmapFlag 保留中文键", () => {
    const fm = 'mindmap: false\n名字: 张三\ntitle: x';
    const result = setMindmapFlag(fm, true);
    expect(result).toContain("名字: 张三");
    expect(result).toContain("title: x");
    expect(result).toBe("mindmap: true\n名字: 张三\ntitle: x");
  });

  it("删除拥有键时其后的中文键被保留", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\n名字: 张三\ntitle: x';
    const result = writeCollapsed(fm, []);
    expect(result).toContain("名字: 张三");
    expect(result).toContain("title: x");
    expect(result).toBe("名字: 张三\ntitle: x");
  });
});

describe("frontmatter blank lines inside owned key block", () => {
  it("块内单个空行不终止块（块序列中的空行）", () => {
    const fm = 'mindmap-collapsed:\n  - "a"\n\n  - "b"\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    // 应该只有一个项目 "new"，没有孤立的 "- b"
    expect(result).toBe('mindmap-collapsed:\n  - "new"\ntitle: x');
  });

  it("块内多个空行不终止块", () => {
    const fm = 'mindmap-collapsed:\n  - "a"\n\n\n  - "b"\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toBe('mindmap-collapsed:\n  - "new"\ntitle: x');
  });

  it("readCollapsed 正确读取块内有空行的数据", () => {
    const fm = 'mindmap-collapsed:\n  - "a"\n\n  - "b"\ntitle: x';
    expect(readCollapsed(fm)).toEqual(["a", "b"]);
  });

  it("块内空行且拥有键是最后一个键时不终止块", () => {
    const fm = 'title: x\nmindmap-collapsed:\n  - "a"\n\n  - "b"';
    const result = writeCollapsed(fm, ["new"]);
    expect(result).toBe('title: x\nmindmap-collapsed:\n  - "new"');
  });

  it("空行之后的下一个键正确终止块", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\n\ntitle: x';
    const result = writeCollapsed(fm, ["new"]);
    // 空行后面紧接着 title，所以空行应该保留在两键之间
    expect(result).toBe('mindmap-collapsed:\n  - "new"\n\ntitle: x');
  });

  it("readCollapsed 正确停止在空行之后的顶层键", () => {
    const fm = 'mindmap-collapsed:\n  - "old"\n\ntitle: x';
    expect(readCollapsed(fm)).toEqual(["old"]);
  });
});
