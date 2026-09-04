import { isHeading, type Bullet, type Marks, type MindNode } from "./types";

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

/** 新节点跟着「未来的兄弟们」用同一个列表标记字符，避免在一个 `*` 列表里
 *  插进一行 `- `。根节点的 bullet 由 parser 取自文件里的第一个列表项，
 *  没有列表项时为 `-`（见 parser.ts）。
 *
 *  构造出的对象不带 `heading`，因此天然是列表项形态：解析双向（标题与列表项
 *  都读成节点），写回单向（图上新建的节点永远是列表项）。 */
function makeNode(id: string, text: string, bullet: Bullet): MindNode {
  return { id, text, marks: {}, children: [], collapsed: false, continuation: [], bullet };
}

/**
 * 标题子节点的起始下标；没有标题子节点时等于 `children.length`。
 *
 * list-before-heading 不变量：一个标题节点的 children 里，列表项形态的子节点
 * 必须全部排在标题形态的子节点之前。`# t` 的子节点若排成
 * `[- a, ## A, - new]`，序列化出来 `- new` 落在 `## A` 之后，重新解析时它就
 * 跑进 A 名下了——一次「加子节点」静默改变了树的形状。所有插入位置都要对
 * 这个下标 clamp。
 */
function firstHeadingIndex(children: readonly MindNode[]): number {
  const index = children.findIndex(isHeading);
  return index < 0 ? children.length : index;
}

/**
 * 该节点是否携带图上看不见的正文。
 *
 * 标题节点的 `continuation` 装着标题行之后、下一个节点行之前的一切——散文段落、
 * 有序列表、表格、代码块。这些内容不在导图上显示，所以删除这个节点会删掉用户
 * 看不见的东西。只有空行不算：`## A` 与它名下第一个列表项之间那个空行没有信息。
 */
export function hasHiddenContent(node: MindNode): boolean {
  return node.continuation.some((line) => line.trim() !== "");
}

/** 能否删除：根节点不能（没有可删的位置），携带不可见正文的节点不能。 */
export function canRemove(root: MindNode, id: string): boolean {
  if (id === root.id) return false;
  const target = findNode(root, id);
  return target !== null && !hasHiddenContent(target);
}

/** 能否加兄弟：根节点没有兄弟；其余都可以（标题产出同级标题，列表项产出列表项）。 */
export function canAddSibling(root: MindNode, id: string): boolean {
  return id !== root.id && findNode(root, id) !== null;
}

/** 能否打标：根节点不能，见 setMarks 的说明。 */
export function canMark(root: MindNode, id: string): boolean {
  return id !== root.id && findNode(root, id) !== null;
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
  // 父节点找不到时（调用方传了无效 id）mapTree 不会插入任何东西，bullet 取值
  // 无关紧要，回退到父节点缺省的 `-`。
  const child = makeNode(newId, text, findNode(root, parentId)?.bullet ?? "-");
  const next = mapTree(root, (node) => {
    if (node.id !== parentId) return null;
    // 插在第一个标题子节点之前，维护 list-before-heading 不变量。父节点没有
    // 标题子节点时这个下标就是末尾，行为与改造前一致。
    const children = [...node.children];
    children.splice(firstHeadingIndex(children), 0, child);
    return { ...node, collapsed: false, children };
  });
  return { root: next, newId };
}

export function addSibling(
  root: MindNode,
  siblingId: string,
  text = "",
): { root: MindNode; newId: string } {
  if (siblingId === root.id) return addChild(root, root.id, text);

  const target = findNode(root, siblingId);
  if (target === null) return { root, newId: siblingId };

  const newId = freshId(root);
  // 参照兄弟是标题时产出**同级标题**（复用同一个 prefix 与 level），不是列表项：
  // 列表项写在 `## A` 之后，重新解析时会成为 A 的第一个子节点而不是兄弟。
  // prefix 逐字复用而不是从 level 重算 `#`，与 serializer 的规则一致。
  const node: MindNode = isHeading(target)
    ? {
        id: newId,
        text,
        marks: {},
        children: [],
        collapsed: false,
        continuation: [],
        bullet: target.bullet,
        heading: {
          level: target.heading.level,
          prefix: target.heading.prefix,
          // 新标题不继承参照兄弟的尾随空白，也还没有名下的列表块。
          suffix: "",
          indentUnit: null,
        },
      }
    : makeNode(newId, text, target.bullet);

  const next = mapTree(root, (parent) => {
    const index = parent.children.findIndex((c) => c.id === siblingId);
    if (index < 0) return null;
    const children = [...parent.children];
    // list-before-heading 不变量：插列表项时上界是第一个标题子节点；插标题时
    // 下界是同一个位置（标题只能落在列表项之后）。
    const boundary = firstHeadingIndex(children);
    const at = isHeading(node)
      ? Math.max(index + 1, boundary)
      : Math.min(index + 1, boundary);
    children.splice(at, 0, node);
    return { ...parent, children };
  });
  return { root: next, newId };
}

export function removeNode(
  root: MindNode,
  id: string,
): { root: MindNode; nextSelectionId: string } {
  if (id === root.id) return { root, nextSelectionId: root.id };

  // 携带图上不可见正文的节点不可删——删了用户看不见的东西。判据是
  // continuation 里有没有非空行，不是「是不是标题节点」：`## A` 与它名下第一个
  // 列表项之间那个空行没有信息，为它禁掉整个标题的删除是过宽的。
  const target = findNode(root, id);
  if (target !== null && hasHiddenContent(target)) return { root, nextSelectionId: id };

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
  // 根节点不能带标记：文件没有 H1 行时（`MindDoc.hasHeading` 为假）根本没有
  // 可写的位置，`serialize` 会跳过整行，标记静默丢失。所以在变更源头拒绝。
  // 文件里的 H2–H6 可以带标记，写在 `#` 之后（见 serializer 的 composeLine）。
  if (id === root.id) return root;
  return mapTree(root, (node) =>
    node.id === id ? { ...node, marks: { ...marks } } : null,
  );
}

/** patch 中的字段与当前值相同则清除，否则设置。只影响 patch 涉及的字段。 */
export function toggleMark(root: MindNode, id: string, patch: Marks): MindNode {
  // 同上：根节点没有可靠的写入位置，序列化时会静默丢弃，故也是空操作。
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
  // 同 removeNode：标题节点携带图上不可见的 continuation，且换父之后
  // heading.prefix 与新位置的层级不再对应。
  if (moving === null || isHeading(moving)) return root;

  const detached = mapTree(root, (node) =>
    node.children.some((c) => c.id === id)
      ? { ...node, children: node.children.filter((c) => c.id !== id) }
      : null,
  );

  return mapTree(detached, (node) => {
    if (node.id !== newParentId) return null;
    const children = [...node.children];
    // 上界是第一个标题子节点而不是 children.length，维护 list-before-heading
    // 不变量：落在标题之后的列表项在重新解析时会跑进那个标题名下。
    const limit = firstHeadingIndex(children);
    children.splice(Math.max(0, Math.min(index, limit)), 0, moving);
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
