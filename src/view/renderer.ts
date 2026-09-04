import type { MindNode } from "../model/types";
import { clear, el, svgEl } from "./dom";
import {
  childBranch,
  DEFAULT_LAYOUT_OPTIONS,
  layout,
  type LayoutResult,
  type Size,
} from "./layout";
import { measureAll } from "./measure";
import { branchClass, buildNodeEl, type OnOpenLink, type OnToggleCollapse } from "./node-el";

export interface RenderLayers {
  measureHost: HTMLElement;
  edges: SVGSVGElement;
  nodes: HTMLElement;
  /** 承载 edges 与 nodes 的可变换容器 */
  canvas: HTMLElement;
}

export function createLayers(root: HTMLElement): RenderLayers {
  const canvas = el("div", "mindmap-canvas", root);
  const edges = svgEl("svg", "mindmap-edges", canvas);
  const nodes = el("div", "mindmap-nodes", canvas);
  const measureHost = el("div", "mindmap-measure", root);
  return { canvas, edges, nodes, measureHost };
}

/** 深度越深线越细。 */
function strokeWidth(depth: number): number {
  return Math.max(1.5, 3 - (depth - 1) * 0.5);
}

interface Placement {
  node: MindNode;
  depth: number;
  branch: number;
}

/** 前序收集可见节点及其深度与所属分支。 */
function collectPlacements(root: MindNode): Placement[] {
  const result: Placement[] = [{ node: root, depth: 0, branch: 0 }];

  const walk = (node: MindNode, depth: number, branch: number): void => {
    if (node.collapsed) return;
    node.children.forEach((child, i) => {
      const nextBranch = childBranch(depth, i, branch);
      result.push({ node: child, depth: depth + 1, branch: nextBranch });
      walk(child, depth + 1, nextBranch);
    });
  };

  walk(root, 0, 0);
  return result;
}

/**
 * 测量 → 布局 → 绘制。返回布局结果供交互层做命中测试与视口自适应。
 */
export function renderMindmap(
  layers: RenderLayers,
  root: MindNode,
  selectedId: string | null,
  onOpenLink?: OnOpenLink,
  onToggleCollapse?: OnToggleCollapse,
): LayoutResult {
  const placements = collectPlacements(root);

  const elements = new Map<string, HTMLElement>();
  for (const { node, depth, branch } of placements) {
    elements.set(
      node.id,
      buildNodeEl(node, depth, branch, node === root, onOpenLink, onToggleCollapse),
    );
  }

  const sizes: Map<string, Size> = measureAll(elements, layers.measureHost);
  const result = layout(root, sizes, DEFAULT_LAYOUT_OPTIONS);

  clear(layers.nodes);
  clear(layers.edges);

  for (const edge of result.edges) {
    const path = svgEl("path", `mm-edge ${branchClass(edge.branch)}`, layers.edges);
    path.setAttribute("d", edge.path);
    path.setAttribute("stroke-width", String(strokeWidth(edge.depth)));
    path.setAttribute("fill", "none");
  }

  for (const [id, element] of elements) {
    const rect = result.rects.get(id);
    if (rect === undefined) continue;
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    if (id === selectedId) element.classList.add("mm-selected");
    layers.nodes.appendChild(element);
  }

  layers.canvas.style.width = `${result.width}px`;
  layers.canvas.style.height = `${result.height}px`;
  layers.edges.setAttribute("width", String(result.width));
  layers.edges.setAttribute("height", String(result.height));
  layers.edges.setAttribute("viewBox", `0 0 ${result.width} ${result.height}`);

  return result;
}
