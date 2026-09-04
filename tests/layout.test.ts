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

  it("路径从父节点右下角经曲线连到子节点左下角，再沿子节点底边画到其右下角（下划线）", () => {
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
    expect(edge.path).toBe(
      `M ${x0} ${y0} C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1} H ${x1 + child.width}`,
    );
  });

  it("每条边追加的下划线段精确落在子节点右下角（trailing H 坐标 = to.x + to.width）", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    for (const edge of result.edges) {
      const to = result.rects.get(edge.toId)!;
      const match = edge.path.match(/H (-?[\d.]+)$/);
      expect(match, `edge ${edge.fromId}->${edge.toId} 缺少 H 段: ${edge.path}`).not.toBeNull();
      const trailingX = Number(match![1]);
      expect(trailingX).toBe(to.x + to.width);
    }
  });

  it("根节点没有入边，因此不会为它画出下划线段", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(result.edges.some((e) => e.toId === root.id)).toBe(false);
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

describe("根节点出边的起点", () => {
  it("根节点的出边从它的右边中点出发，不是右下角", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    const rootRect = result.rects.get("n0")!;
    const rootEdges = result.edges.filter((e) => e.fromId === "n0");
    expect(rootEdges).toHaveLength(2);
    for (const edge of rootEdges) {
      const start = edge.path.match(/^M (-?[\d.]+) (-?[\d.]+)/)!;
      expect(Number(start[1])).toBe(rootRect.x + rootRect.width);
      expect(Number(start[2])).toBe(rootRect.y + rootRect.height / 2);
    }
  });

  it("非根节点的出边仍从右下角出发，与它自己的下划线严丝合缝", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    // n1 的出边（指向 n2 / n3）起点必须等于 n1 入边的 H 段终点，
    // 否则父下划线与子曲线之间会出现可见台阶（见 bezier 的说明）。
    const parent = result.rects.get("n1")!;
    const incoming = result.edges.find((e) => e.toId === "n1")!;
    const seam = Number(incoming.path.match(/H (-?[\d.]+)$/)![1]);
    expect(seam).toBe(parent.x + parent.width);
    for (const edge of result.edges.filter((e) => e.fromId === "n1")) {
      const start = edge.path.match(/^M (-?[\d.]+) (-?[\d.]+)/)!;
      expect(Number(start[1])).toBe(parent.x + parent.width);
      expect(Number(start[2])).toBe(parent.y + parent.height);
    }
  });

  it("根节点高度为奇数时中点取半像素，不做取整", () => {
    const root = tree();
    const map = sizes(root);
    map.set("n0", { width: 100, height: 21 });
    const result = layout(root, map, DEFAULT_LAYOUT_OPTIONS);
    const rootRect = result.rects.get("n0")!;
    const edge = result.edges.find((e) => e.fromId === "n0")!;
    const start = edge.path.match(/^M (-?[\d.]+) (-?[\d.]+)/)!;
    expect(Number(start[2])).toBe(rootRect.y + 10.5);
  });
});
