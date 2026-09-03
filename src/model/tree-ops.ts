import type { Marks, MindNode } from "./types";

export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found !== null) return found;
  }
  return null;
}

export function findParent(root: MindNode, id: string): MindNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found !== null) return found;
  }
  return null;
}

/** 收集所有 id，取 `n<数字>` 的最大值 +1。 */
export function freshId(root: MindNode): string {
  let max = -1;
  const walk = (node: MindNode): void => {
    const match = /^n(\d+)$/.exec(node.id);
    if (match !== null) max = Math.max(max, Number(match[1]));
    node.children.forEach(walk);
  };
  walk(root);
  return `n${max + 1}`;
}

function makeNode(id: string, text: string): MindNode {
  return { id, text, marks: {}, children: [], collapsed: false, continuation: [] };
}

/** 对树做一次映射式重建；`fn` 返回 null 表示该节点不变。 */
function mapTree(
  node: MindNode,
  fn: (node: MindNode) => MindNode | null,
): MindNode {
  const replaced = fn(node);
  const base = replaced ?? node;
  return { ...base, children: base.children.map((c) => mapTree(c, fn)) };
}

export function addChild(
  root: MindNode,
  parentId: string,
  text = "",
): { root: MindNode; newId: string } {
  const newId = freshId(root);
  const child = makeNode(newId, text);
  const next = mapTree(root, (node) =>
    node.id === parentId
      ? { ...node, collapsed: false, children: [...node.children, child] }
      : null,
  );
  return { root: next, newId };
}

export function addSibling(
  root: MindNode,
  siblingId: string,
  text = "",
): { root: MindNode; newId: string } {
  if (siblingId === root.id) return addChild(root, root.id, text);

  const newId = freshId(root);
  const sibling = makeNode(newId, text);
  const next = mapTree(root, (node) => {
    const index = node.children.findIndex((c) => c.id === siblingId);
    if (index < 0) return null;
    const children = [...node.children];
    children.splice(index + 1, 0, sibling);
    return { ...node, children };
  });
  return { root: next, newId };
}

export function removeNode(
  root: MindNode,
  id: string,
): { root: MindNode; nextSelectionId: string } {
  if (id === root.id) return { root, nextSelectionId: root.id };

  const parent = findParent(root, id);
  if (parent === null) return { root, nextSelectionId: root.id };

  const index = parent.children.findIndex((c) => c.id === id);
  const siblings = parent.children;
  const nextSelectionId =
    siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? parent.id;

  const next = mapTree(root, (node) =>
    node.id === parent.id
      ? { ...node, children: node.children.filter((c) => c.id !== id) }
      : null,
  );
  return { root: next, nextSelectionId };
}

export function setText(root: MindNode, id: string, text: string): MindNode {
  return mapTree(root, (node) => (node.id === id ? { ...node, text } : null));
}

export function setMarks(root: MindNode, id: string, marks: Marks): MindNode {
  // H1 行没有行内标记语法；serializer 会忽略 root.marks，写回文件时会静默丢失，
  // 所以在变更源头直接拒绝对根节点设置标记，保持空操作。
  if (id === root.id) return root;
  return mapTree(root, (node) =>
    node.id === id ? { ...node, marks: { ...marks } } : null,
  );
}

/** patch 中的字段与当前值相同则清除，否则设置。只影响 patch 涉及的字段。 */
export function toggleMark(root: MindNode, id: string, patch: Marks): MindNode {
  // 同上：根节点没有可承载标记的行内语法，序列化时会静默丢弃，故也是空操作。
  if (id === root.id) return root;
  return mapTree(root, (node) => {
    if (node.id !== id) return null;
    const marks: Marks = { ...node.marks };
    for (const key of Object.keys(patch) as (keyof Marks)[]) {
      if (marks[key] === patch[key]) {
        delete marks[key];
      } else {
        // 三类标记类型各不相同，按键逐个赋值以保持类型安全。
        if (key === "priority") marks.priority = patch.priority;
        if (key === "progress") marks.progress = patch.progress;
        if (key === "flag") marks.flag = patch.flag;
      }
    }
    return { ...node, marks };
  });
}

function isDescendant(root: MindNode, ancestorId: string, id: string): boolean {
  const ancestor = findNode(root, ancestorId);
  if (ancestor === null) return false;
  return findNode(ancestor, id) !== null && ancestorId !== id;
}

export function moveNode(
  root: MindNode,
  id: string,
  newParentId: string,
  index: number,
): MindNode {
  if (id === root.id) return root;
  if (id === newParentId) return root;
  if (isDescendant(root, id, newParentId)) return root;

  const moving = findNode(root, id);
  if (moving === null) return root;

  const detached = mapTree(root, (node) =>
    node.children.some((c) => c.id === id)
      ? { ...node, children: node.children.filter((c) => c.id !== id) }
      : null,
  );

  return mapTree(detached, (node) => {
    if (node.id !== newParentId) return null;
    const children = [...node.children];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, moving);
    return { ...node, collapsed: false, children };
  });
}

export function toggleCollapse(root: MindNode, id: string): MindNode {
  const target = findNode(root, id);
  if (target === null || target.children.length === 0) return root;
  return mapTree(root, (node) =>
    node.id === id ? { ...node, collapsed: !node.collapsed } : null,
  );
}

/** 前序遍历，跳过折叠节点的子树。 */
export function visibleNodes(root: MindNode): MindNode[] {
  const result: MindNode[] = [];
  const walk = (node: MindNode): void => {
    result.push(node);
    if (!node.collapsed) node.children.forEach(walk);
  };
  walk(root);
  return result;
}

export function navigate(
  root: MindNode,
  id: string,
  dir: "up" | "down" | "left" | "right",
): string | null {
  const node = findNode(root, id);
  if (node === null) return null;

  if (dir === "right") {
    if (node.collapsed || node.children.length === 0) return null;
    return node.children[0].id;
  }

  const parent = findParent(root, id);
  if (parent === null) return null;
  if (dir === "left") return parent.id;

  const index = parent.children.findIndex((c) => c.id === id);
  const sibling = parent.children[dir === "up" ? index - 1 : index + 1];
  return sibling?.id ?? null;
}
