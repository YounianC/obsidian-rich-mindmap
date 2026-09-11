import {
  isHeading,
  isOrdered,
  type Bullet,
  type Marks,
  type MindNode,
  type OrderedForm,
} from "./types";

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

/** 新节点继承来的列表标记形态。`ordered` 缺席即为无序项。 */
interface MarkerForm {
  bullet: Bullet;
  ordered?: OrderedForm;
}

/** 读出一个节点的标记形态，供新节点继承。 */
function markerOf(node: MindNode): MarkerForm {
  return isOrdered(node)
    ? { bullet: node.bullet, ordered: { ...node.ordered } }
    : { bullet: node.bullet };
}

/** 新节点跟着「未来的兄弟们」用同一个列表标记形态，避免在一个 `*` 列表里插进
 *  一行 `- `、或在一个 `1.` 列表里插进一行 `- `。根节点的形态由 parser 取自
 *  文件里的第一个列表项，没有列表项时为 `-`（见 parser.ts）。
 *
 *  有序时带过来的 `number` 只是个合法初值；真正的号由调用方随后的 `renumber`
 *  按段首重算。
 *
 *  构造出的对象不带 `heading`，因此天然是列表项形态：解析双向（标题与列表项
 *  都读成节点），写回单向（图上新建的节点永远是列表项）。 */
function makeNode(id: string, text: string, marker: MarkerForm): MindNode {
  const node: MindNode = {
    id,
    text,
    marks: {},
    children: [],
    collapsed: false,
    continuation: [],
    bullet: marker.bullet,
  };
  if (marker.ordered !== undefined) node.ordered = { ...marker.ordered };
  return node;
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

/** 兄弟数组里的一段有序节点：左闭右开的下标区间，加上该段的分隔符。 */
interface OrderedRun {
  start: number;
  end: number;
  delim: OrderedForm["delim"];
}

/**
 * 把兄弟数组切成若干「极大的、连续的、**同 delim** 的有序节点」段。
 *
 * delim 不同在 CommonMark 里就是两个列表，跨 delim 连号是错的：`1. / 2. / 5) / 6)`
 * 是「从 1 起的一个列表」加「从 5 起的另一个列表」，不是一个 1–4 的列表。
 * 无序节点与标题节点都不带 `ordered`，因此天然会把段切断。
 */
function orderedRuns(children: readonly MindNode[]): OrderedRun[] {
  const runs: OrderedRun[] = [];
  let current: OrderedRun | null = null;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!isOrdered(node)) {
      current = null;
      continue;
    }
    if (current !== null && current.delim === node.ordered.delim) {
      current.end = i + 1;
      continue;
    }
    current = { start: i, end: i + 1, delim: node.ordered.delim };
    runs.push(current);
  }
  return runs;
}

/**
 * 结构变更后重排有序兄弟的序号。
 *
 * 每一段的起始号取 `prev` 里**同序号那一段**的段首号；`prev` 里没有对应段
 * （新长出来的段）时取 1。段内其余节点依次 +1，delim 各自保留不动。
 *
 * 「取变更前的段首号」这条规则同时照顾到三件事：保留用户从 `3.` 起头的列表；
 * 删掉段首时剩余节点各自保号（diff 最小）；把一个 `5.` 拖到 `1. / 2.` 的段首
 * 时不会把整段带成 5,6,7。
 *
 * **这个函数只被下面四个结构变更点调用。** 打开文件不改再切走时一个 tree-ops
 * 函数都不会被调用，所以什么都不会重编号——AGENTS.md 第 2 条不受影响。
 *
 * 号没有变化的节点保持原对象引用，不做无谓的复制。
 */
export function renumber(
  prev: readonly MindNode[],
  next: readonly MindNode[],
): MindNode[] {
  const prevRuns = orderedRuns(prev);
  const nextRuns = orderedRuns(next);
  if (nextRuns.length === 0) return [...next];

  const result = [...next];
  nextRuns.forEach((run, index) => {
    const prevRun = prevRuns[index];
    const anchor = prevRun === undefined ? null : prev[prevRun.start];
    // orderedRuns 只把带 ordered 的下标收进段里，所以 anchor 必然是有序节点；
    // isOrdered 在这里是把这一点转达给类型系统，不是运行时判断。
    const start = anchor !== null && isOrdered(anchor) ? anchor.ordered.number : 1;
    for (let i = run.start; i < run.end; i++) {
      const node = result[i];
      if (!isOrdered(node)) continue;
      const number = start + (i - run.start);
      if (node.ordered.number === number) continue;
      result[i] = { ...node, ordered: { ...node.ordered, number } };
    }
  });
  return result;
}

/**
 * 该节点是否携带图上看不见的正文。
 *
 * 标题节点的 `continuation` 装着标题行之后、下一个节点行之前的一切——散文段落、
 * 表格、代码块。这些内容不在导图上显示，所以删除这个节点会删掉用户
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

/** 能否加备注：根节点不能，见 setNote 的说明。 */
export function canNote(root: MindNode, id: string): boolean {
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
  // 父节点找不到时（调用方传了无效 id）mapTree 不会插入任何东西，形态取值
  // 无关紧要，回退到缺省的 `-`。
  const parentNode = findNode(root, parentId);
  let marker: MarkerForm = { bullet: "-" };
  if (parentNode !== null) {
    marker = isOrdered(parentNode)
      ? // 初始号给 1：新子节点要么独自成段（起始号本就是 1），要么接在既有段尾、
        // 号由下面的 renumber 按段首重算。
        {
          bullet: parentNode.bullet,
          ordered: { number: 1, delim: parentNode.ordered.delim },
        }
      : { bullet: parentNode.bullet };
  }
  const child = makeNode(newId, text, marker);
  const next = mapTree(root, (node) => {
    if (node.id !== parentId) return null;
    // 插在第一个标题子节点之前，维护 list-before-heading 不变量。父节点没有
    // 标题子节点时这个下标就是末尾，行为与改造前一致。
    const children = [...node.children];
    children.splice(firstHeadingIndex(children), 0, child);
    return { ...node, collapsed: false, children: renumber(node.children, children) };
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
    : // 参照兄弟是有序项时连号一起复制。插入位置恒为 index + 1，新节点永远不会
      // 成为段首，所以这个复制来的号只是个会被 renumber 立刻覆盖的合法初值。
      makeNode(newId, text, markerOf(target));

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
    return { ...parent, children: renumber(parent.children, children) };
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

  const next = mapTree(root, (node) => {
    if (node.id !== parent.id) return null;
    const children = node.children.filter((c) => c.id !== id);
    return { ...node, children: renumber(node.children, children) };
  });
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

/**
 * 写入或清除节点备注。文本去空白后为空即删除备注。
 *
 * 根节点不带备注，理由与 setMarks 相同：文件没有 H1 行时（`MindDoc.hasHeading`
 * 为假）根本没有可写的位置，`serialize` 会跳过整行，备注静默丢失。所以在变更
 * 源头拒绝，`parse` 也对称地不对根做 splitNote。
 *
 * `raw` 恒为 null：用户改过的备注不能再重放旧字节，交给 serialize 按节点当前的
 * 缩进重新生成（见 serializer 的 serializeNote）。
 */
export function setNote(root: MindNode, id: string, text: string): MindNode {
  if (id === root.id) return root;
  return mapTree(root, (node) => {
    if (node.id !== id) return null;
    if (text.trim() === "") {
      const next = { ...node };
      delete next.note;
      return next;
    }
    return { ...node, note: { text, raw: null } };
  });
}

function isDescendant(root: MindNode, ancestorId: string, id: string): boolean {
  const ancestor = findNode(root, ancestorId);
  if (ancestor === null) return false;
  return findNode(ancestor, id) !== null && ancestorId !== id;
}

/**
 * 深拷贝一棵子树并让其中所有备注的 `raw` 失效。
 *
 * 移动之后节点深度变了，旧缩进不再对；不置 null 的话备注行会留在原来的缩进
 * 列上——仍然解析回同一个节点（续行 sink 收一切非节点行），但在 Obsidian 自己的
 * 阅读视图里会掉出列表外。这是显式编辑触发的字节变化，不受「只允许五条写回
 * 归一化」约束（那五条约束的是「打开再切走」的空操作）。
 */
function clearNoteRaw(node: MindNode): MindNode {
  const next: MindNode = { ...node, children: node.children.map(clearNoteRaw) };
  if (next.note !== undefined) next.note = { ...next.note, raw: null };
  return next;
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

  const detached = mapTree(root, (node) => {
    if (!node.children.some((c) => c.id === id)) return null;
    const children = node.children.filter((c) => c.id !== id);
    return { ...node, children: renumber(node.children, children) };
  });

  return mapTree(detached, (node) => {
    if (node.id !== newParentId) return null;
    const children = [...node.children];
    // 上界是第一个标题子节点而不是 children.length，维护 list-before-heading
    // 不变量：落在标题之后的列表项在重新解析时会跑进那个标题名下。
    const limit = firstHeadingIndex(children);
    children.splice(Math.max(0, Math.min(index, limit)), 0, clearNoteRaw(moving));
    // 源父与目标父相同时这已是第二次 renumber，prev 是 detach 之后的数组——
    // 结果仍然正确（1,2,3 里把 c 移到 0 位：detach 得 a=1,b=2，insert 得
    // c=1,a=2,b=3）。
    return { ...node, collapsed: false, children: renumber(node.children, children) };
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
