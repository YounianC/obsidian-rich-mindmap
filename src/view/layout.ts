import type { MindNode } from "../model/types";

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Edge {
  fromId: string;
  toId: string;
  /** SVG path 的 d 属性 */
  path: string;
  /** 子节点深度，根的直接子节点为 1 */
  depth: number;
  /** 所属根分支序号，用于配色 */
  branch: number;
}

export interface LayoutOptions {
  hGap: number;
  vGap: number;
  padding: number;
}

export interface LayoutResult {
  rects: Map<string, Rect>;
  edges: Edge[];
  width: number;
  height: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  hGap: 56,
  vGap: 14,
  padding: 48,
};

const ZERO: Size = { width: 0, height: 0 };

/**
 * 分支序号的唯一定义：根（depth 0）的每个直接子节点各自开一个分支，更深的层级
 * 一律继承祖先的分支号。连线配色（本文件的 place/collectEdges）与节点配色
 * （renderer.ts 的 collectPlacements）必须用同一条规则，否则同一棵子树的边色和
 * 节点色会错位——三处各写一遍是这类不一致的常见来源，因此收敛到这里。
 */
export function childBranch(depth: number, index: number, branch: number): number {
  return depth === 0 ? index : branch;
}

function hasVisibleChildren(node: MindNode): boolean {
  return !node.collapsed && node.children.length > 0;
}

/** 后序计算每棵子树的垂直跨度。 */
function computeSpans(
  root: MindNode,
  sizes: Map<string, Size>,
  vGap: number,
): Map<string, number> {
  const spans = new Map<string, number>();

  const walk = (node: MindNode): number => {
    const own = (sizes.get(node.id) ?? ZERO).height;
    if (!hasVisibleChildren(node)) {
      spans.set(node.id, own);
      return own;
    }

    let childrenSpan = 0;
    node.children.forEach((child, i) => {
      childrenSpan += walk(child) + (i > 0 ? vGap : 0);
    });

    const span = Math.max(own, childrenSpan);
    spans.set(node.id, span);
    return span;
  };

  walk(root);
  return spans;
}

function bezier(from: Rect, to: Rect): string {
  const x0 = from.x + from.width;
  const y0 = from.y + from.height;
  const x1 = to.x;
  const y1 = to.y + to.height;
  const mx = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
}

/**
 * 把可见的思维导图树布局为坐标与连线。根节点在左，整树向右展开。
 * 缺失尺寸的节点按 0×0 处理，仍会产出矩形，避免测量竞态导致节点消失。
 */
export function layout(
  root: MindNode,
  sizes: Map<string, Size>,
  opts: LayoutOptions,
): LayoutResult {
  const spans = computeSpans(root, sizes, opts.vGap);
  const rects = new Map<string, Rect>();
  const edges: Edge[] = [];

  const place = (
    node: MindNode,
    x: number,
    top: number,
    depth: number,
    branch: number,
  ): void => {
    const size = sizes.get(node.id) ?? ZERO;
    const span = spans.get(node.id) ?? size.height;

    rects.set(node.id, {
      x,
      y: top + (span - size.height) / 2,
      width: size.width,
      height: size.height,
    });

    if (!hasVisibleChildren(node)) return;

    let childrenSpan = 0;
    node.children.forEach((child, i) => {
      childrenSpan += (spans.get(child.id) ?? 0) + (i > 0 ? opts.vGap : 0);
    });

    const childX = x + size.width + opts.hGap;
    let childTop = top + (span - childrenSpan) / 2;

    for (const [i, child] of node.children.entries()) {
      place(child, childX, childTop, depth + 1, childBranch(depth, i, branch));
      childTop += (spans.get(child.id) ?? 0) + opts.vGap;
    }
  };

  place(root, opts.padding, opts.padding, 0, 0);

  // 连线需要两端矩形都已就位，因此单独遍历一次。
  const collectEdges = (node: MindNode, depth: number, branch: number): void => {
    if (!hasVisibleChildren(node)) return;
    const from = rects.get(node.id);
    if (from === undefined) return;

    node.children.forEach((child, i) => {
      const to = rects.get(child.id);
      if (to === undefined) return;
      const nextBranch = childBranch(depth, i, branch);
      edges.push({
        fromId: node.id,
        toId: child.id,
        path: bezier(from, to),
        depth: depth + 1,
        branch: nextBranch,
      });
      collectEdges(child, depth + 1, nextBranch);
    });
  };

  collectEdges(root, 0, 0);

  let maxRight = 0;
  let maxBottom = 0;
  for (const rect of rects.values()) {
    maxRight = Math.max(maxRight, rect.x + rect.width);
    maxBottom = Math.max(maxBottom, rect.y + rect.height);
  }

  return {
    rects,
    edges,
    width: maxRight + opts.padding,
    height: maxBottom + opts.padding,
  };
}
