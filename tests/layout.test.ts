import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { toggleCollapse, visibleNodes } from "../src/model/tree-ops";
import {
  DEFAULT_LAYOUT_OPTIONS,
  layout,
  type Rect,
  type Size,
} from "../src/view/layout";
import type { MindNode } from "../src/model/types";

/** n0=根 / n1=A / n2=A1 / n3=A2 / n4=B */
function tree(): MindNode {
  return parse("# 根\n\n- A\n  - A1\n  - A2\n- B\n", "x.md").root;
}

/** 给每个节点一个固定尺寸，便于断言。 */
function sizes(root: MindNode, size: Size = { width: 100, height: 20 }) {
  const map = new Map<string, Size>();
  for (const node of visibleNodes(root)) map.set(node.id, { ...size });
  return map;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("layout", () => {
  it("为每个可见节点产出矩形", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect([...result.rects.keys()].sort()).toEqual([
      "n0", "n1", "n2", "n3", "n4",
    ]);
  });

  it("任意两个节点矩形不重叠", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    const rects = [...result.rects.values()];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j]), `${i} vs ${j}`).toBe(false);
      }
    }
  });

  it("子节点 x = 父节点右边缘 + hGap", () => {
    const root = tree();
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, hGap: 50 };
    const result = layout(root, sizes(root), opts);
    const parent = result.rects.get("n1")!;
    const child = result.rects.get("n2")!;
    expect(child.x).toBe(parent.x + parent.width + 50);
  });

  it("父节点垂直居中于其子节点跨度", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    const parent = result.rects.get("n1")!;
    const first = result.rects.get("n2")!;
    const last = result.rects.get("n3")!;
    const parentCenter = parent.y + parent.height / 2;
    const childrenCenter = (first.y + (last.y + last.height)) / 2;
    expect(parentCenter).toBeCloseTo(childrenCenter, 6);
  });

  it("兄弟节点之间的垂直间距等于 vGap", () => {
    const root = tree();
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, vGap: 10 };
    const result = layout(root, sizes(root), opts);
    const a1 = result.rects.get("n2")!;
    const a2 = result.rects.get("n3")!;
    expect(a2.y - (a1.y + a1.height)).toBe(10);
  });

  it("折叠节点的子树不参与布局也不占空间", () => {
    const root = toggleCollapse(tree(), "n1");
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(result.rects.has("n2")).toBe(false);
    const a = result.rects.get("n1")!;
    const b = result.rects.get("n4")!;
    expect(b.y - (a.y + a.height)).toBe(DEFAULT_LAYOUT_OPTIONS.vGap);
  });

  it("缺失尺寸的节点按 0 计并仍产出矩形", () => {
    const root = tree();
    const partial = sizes(root);
    partial.delete("n3");
    const result = layout(root, partial, DEFAULT_LAYOUT_OPTIONS);
    expect(result.rects.get("n3")).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      width: 0,
      height: 0,
    });
  });

  it("画布尺寸包含内边距", () => {
    const root = tree();
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, padding: 30 };
    const result = layout(root, sizes(root), opts);
    const maxRight = Math.max(
      ...[...result.rects.values()].map((r) => r.x + r.width),
    );
    expect(result.width).toBe(maxRight + 30);
  });

  it("所有节点坐标不小于内边距", () => {
    const root = tree();
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, padding: 30 };
    const result = layout(root, sizes(root), opts);
    for (const rect of result.rects.values()) {
      expect(rect.x).toBeGreaterThanOrEqual(30);
      expect(rect.y).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("layout 连线", () => {
  it("每条父子关系产出一条边", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(
      result.edges.map((e) => `${e.fromId}->${e.toId}`).sort(),
    ).toEqual(["n0->n1", "n0->n4", "n1->n2", "n1->n3"]);
  });

  it("路径从父节点右下角连到子节点左下角", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    const edge = result.edges.find((e) => e.toId === "n2")!;
    const parent = result.rects.get("n1")!;
    const child = result.rects.get("n2")!;
    const x0 = parent.x + parent.width;
    const y0 = parent.y + parent.height;
    const x1 = child.x;
    const y1 = child.y + child.height;
    const mx = (x0 + x1) / 2;
    expect(edge.path).toBe(`M ${x0} ${y0} C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`);
  });

  it("branch 为所属根分支序号，depth 为子节点深度", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(result.edges.find((e) => e.toId === "n1")).toMatchObject({
      branch: 0,
      depth: 1,
    });
    expect(result.edges.find((e) => e.toId === "n2")).toMatchObject({
      branch: 0,
      depth: 2,
    });
    expect(result.edges.find((e) => e.toId === "n4")).toMatchObject({
      branch: 1,
      depth: 1,
    });
  });

  it("折叠节点不产出其子树的边", () => {
    const root = toggleCollapse(tree(), "n1");
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(result.edges.map((e) => e.toId).sort()).toEqual(["n1", "n4"]);
  });
});
