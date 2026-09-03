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
