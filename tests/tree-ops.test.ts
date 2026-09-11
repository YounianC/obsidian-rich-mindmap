import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { serialize } from "../src/model/serializer";
import {
  addChild,
  addSibling,
  canNote,
  canRemove,
  findNode,
  findParent,
  freshId,
  hasHiddenContent,
  moveNode,
  navigate,
  removeNode,
  renumber,
  setMarks,
  setNote,
  setText,
  toggleCollapse,
  toggleMark,
  visibleNodes,
} from "../src/model/tree-ops";
import { isHeading, type MindNode } from "../src/model/types";

/** n0=根 / n1=A / n2=A1 / n3=A2 / n4=B */
function tree(): MindNode {
  return parse("# 根\n\n- A\n  - A1\n  - A2\n- B\n", "x.md").root;
}

describe("查找", () => {
  it("findNode 命中与失配", () => {
    expect(findNode(tree(), "n2")?.text).toBe("A1");
    expect(findNode(tree(), "nope")).toBeNull();
  });

  it("findParent 返回父节点，根节点无父", () => {
    expect(findParent(tree(), "n2")?.text).toBe("A");
    expect(findParent(tree(), "n0")).toBeNull();
  });
});

describe("freshId", () => {
  it("取最大编号 +1", () => {
    expect(freshId(tree())).toBe("n5");
  });
});

describe("addChild", () => {
  it("追加为末子并返回新 id", () => {
    const { root, newId } = addChild(tree(), "n1", "新节点");
    expect(newId).toBe("n5");
    expect(findNode(root, "n1")?.children.map((c) => c.text)).toEqual([
      "A1", "A2", "新节点",
    ]);
  });

  it("不修改原树", () => {
    const original = tree();
    addChild(original, "n1", "x");
    expect(findNode(original, "n1")?.children).toHaveLength(2);
  });

  it("父节点折叠时自动展开", () => {
    const collapsed = toggleCollapse(tree(), "n1");
    expect(findNode(collapsed, "n1")?.collapsed).toBe(true);
    const { root } = addChild(collapsed, "n1", "x");
    expect(findNode(root, "n1")?.collapsed).toBe(false);
  });

  it("默认文本为空串", () => {
    const { root, newId } = addChild(tree(), "n1");
    expect(findNode(root, newId)?.text).toBe("");
  });
});

describe("addSibling", () => {
  it("插在目标节点之后", () => {
    const { root } = addSibling(tree(), "n2", "新");
    expect(findNode(root, "n1")?.children.map((c) => c.text)).toEqual([
      "A1", "新", "A2",
    ]);
  });

  it("对根节点调用时等价于加子节点", () => {
    const { root } = addSibling(tree(), "n0", "新");
    expect(root.children.map((c) => c.text)).toEqual(["A", "B", "新"]);
  });
});

describe("removeNode", () => {
  it("删除节点及其子树", () => {
    const { root } = removeNode(tree(), "n1");
    expect(root.children.map((c) => c.text)).toEqual(["B"]);
  });

  it("后继选中取下一个兄弟", () => {
    expect(removeNode(tree(), "n2").nextSelectionId).toBe("n3");
  });

  it("无下一个兄弟时取上一个兄弟", () => {
    expect(removeNode(tree(), "n3").nextSelectionId).toBe("n2");
  });

  it("无兄弟时取父节点", () => {
    const { root } = removeNode(tree(), "n3");
    expect(removeNode(root, "n2").nextSelectionId).toBe("n1");
  });

  it("对根节点调用时原样返回", () => {
    const original = tree();
    const { root, nextSelectionId } = removeNode(original, "n0");
    expect(root).toBe(original);
    expect(nextSelectionId).toBe("n0");
  });
});

describe("setText / setMarks / toggleMark", () => {
  it("setText 改文本", () => {
    expect(findNode(setText(tree(), "n2", "改了"), "n2")?.text).toBe("改了");
  });

  it("setMarks 整体替换", () => {
    const root = setMarks(tree(), "n2", { priority: 3 });
    expect(findNode(root, "n2")?.marks).toEqual({ priority: 3 });
  });

  it("toggleMark 首次设置", () => {
    const root = toggleMark(tree(), "n2", { priority: 1 });
    expect(findNode(root, "n2")?.marks).toEqual({ priority: 1 });
  });

  it("toggleMark 同值再点即清除", () => {
    const once = toggleMark(tree(), "n2", { priority: 1 });
    const twice = toggleMark(once, "n2", { priority: 1 });
    expect(findNode(twice, "n2")?.marks).toEqual({});
  });

  it("toggleMark 异值则替换", () => {
    const once = toggleMark(tree(), "n2", { priority: 1 });
    const twice = toggleMark(once, "n2", { priority: 5 });
    expect(findNode(twice, "n2")?.marks).toEqual({ priority: 5 });
  });

  it("toggleMark 只影响 patch 里的字段", () => {
    const withBoth = setMarks(tree(), "n2", { priority: 1, progress: 50 });
    const toggled = toggleMark(withBoth, "n2", { priority: 1 });
    expect(findNode(toggled, "n2")?.marks).toEqual({ progress: 50 });
  });

  it("setMarks 对根节点是空操作，原样返回", () => {
    const original = tree();
    const result = setMarks(original, "n0", { priority: 3 });
    expect(result).toBe(original);
    expect(result.marks).toEqual({});
  });

  it("toggleMark 对根节点是空操作，原样返回", () => {
    const original = tree();
    const result = toggleMark(original, "n0", { priority: 3 });
    expect(result).toBe(original);
    expect(result.marks).toEqual({});
  });
});

describe("moveNode", () => {
  it("移动到另一个父节点的指定位置", () => {
    const root = moveNode(tree(), "n2", "n4", 0);
    expect(findNode(root, "n1")?.children.map((c) => c.text)).toEqual(["A2"]);
    expect(findNode(root, "n4")?.children.map((c) => c.text)).toEqual(["A1"]);
  });

  it("同父内重排", () => {
    const root = moveNode(tree(), "n3", "n1", 0);
    expect(findNode(root, "n1")?.children.map((c) => c.text)).toEqual([
      "A2", "A1",
    ]);
  });

  it("移到自身后代时原样返回", () => {
    const original = tree();
    expect(moveNode(original, "n1", "n2", 0)).toBe(original);
  });

  it("移到自身时原样返回", () => {
    const original = tree();
    expect(moveNode(original, "n1", "n1", 0)).toBe(original);
  });

  it("移动根节点时原样返回", () => {
    const original = tree();
    expect(moveNode(original, "n0", "n1", 0)).toBe(original);
  });
});

describe("toggleCollapse / visibleNodes", () => {
  it("折叠后其子树不可见", () => {
    const root = toggleCollapse(tree(), "n1");
    expect(visibleNodes(root).map((n) => n.text)).toEqual(["根", "A", "B"]);
  });

  it("默认全部可见", () => {
    expect(visibleNodes(tree()).map((n) => n.text)).toEqual([
      "根", "A", "A1", "A2", "B",
    ]);
  });

  it("叶子节点不可折叠", () => {
    const original = tree();
    expect(toggleCollapse(original, "n2")).toBe(original);
  });
});

describe("navigate", () => {
  it("up/down 在同层兄弟间移动", () => {
    expect(navigate(tree(), "n2", "down")).toBe("n3");
    expect(navigate(tree(), "n3", "up")).toBe("n2");
  });

  it("到边界返回 null", () => {
    expect(navigate(tree(), "n2", "up")).toBeNull();
    expect(navigate(tree(), "n3", "down")).toBeNull();
  });

  it("left 到父节点", () => {
    expect(navigate(tree(), "n2", "left")).toBe("n1");
    expect(navigate(tree(), "n1", "left")).toBe("n0");
  });

  it("right 到第一个子节点", () => {
    expect(navigate(tree(), "n1", "right")).toBe("n2");
  });

  it("折叠或无子节点时 right 返回 null", () => {
    expect(navigate(tree(), "n2", "right")).toBeNull();
    expect(navigate(toggleCollapse(tree(), "n1"), "n1", "right")).toBeNull();
  });
});

/** `# t` / `- a` / `## H` / `- b` —— 根下先一个列表项，再一个标题节点。 */
function headingTree(): MindNode {
  return parse("# t\n\n- a\n## H\n\n- b\n", "我的导图.md").root;
}

describe("标题节点的编辑约束", () => {
  it("headingTree 的形状符合预期", () => {
    const root = headingTree();
    expect(root.children.map((c) => c.text)).toEqual(["a", "H"]);
    expect(isHeading(root.children[0])).toBe(false);
    expect(isHeading(root.children[1])).toBe(true);
    expect(root.children[1].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("addChild 到标题父节点：新节点插在第一个标题子节点之前", () => {
    const root = headingTree();
    const { root: next, newId } = addChild(root, root.id, "新");
    expect(next.children.map((c) => c.text)).toEqual(["a", "新", "H"]);
    expect(isHeading(next.children[1])).toBe(false);
    expect(next.children[1].id).toBe(newId);
  });

  it("addChild 到没有列表子节点的标题上，插在最前", () => {
    const root = parse("# t\n\n## H\n", "我的导图.md").root;
    const { root: next } = addChild(root, root.id, "新");
    expect(next.children.map((c) => c.text)).toEqual(["新", "H"]);
  });

  it("addChild 到标题节点自己，新节点是列表项形态", () => {
    const root = headingTree();
    const h = root.children[1];
    const { root: next, newId } = addChild(root, h.id, "新");
    const added = findNode(next, newId);
    expect(added?.text).toBe("新");
    expect(isHeading(added as MindNode)).toBe(false);
  });

  it("addChild 到列表项父节点：追加到末尾，行为不变", () => {
    const root = headingTree();
    const { root: next } = addChild(root, root.children[0].id, "新");
    expect(next.children[0].children.map((c) => c.text)).toEqual(["新"]);
  });

  it("addSibling 对标题节点产出同级标题，prefix 逐字复用", () => {
    const root = headingTree();
    const h = root.children[1];
    const { root: next, newId } = addSibling(root, h.id, "新章节");
    expect(next.children.map((c) => c.text)).toEqual(["a", "H", "新章节"]);
    const added = findNode(next, newId) as MindNode;
    expect(isHeading(added)).toBe(true);
    expect(added.heading?.prefix).toBe("## ");
    expect(added.heading?.level).toBe(2);
    expect(added.heading?.suffix).toBe("");
    expect(added.heading?.indentUnit).toBeNull();
  });

  it("addSibling 产出的标题落在列表项之后，维护 list-before-heading", () => {
    const root = headingTree();
    const { root: next } = addSibling(root, root.children[1].id, "新章节");
    const forms = next.children.map((c) => (isHeading(c) ? "heading" : "item"));
    expect(forms).toEqual(["item", "heading", "heading"]);
  });

  it("removeNode 允许删除没有携带不可见正文的标题节点", () => {
    // headingTree 的 `## H` 后面紧跟一个空行，continuation 里没有非空行
    const root = headingTree();
    const h = root.children[1];
    expect(h.continuation.filter((l) => l.trim() !== "")).toEqual([]);
    const { root: next } = removeNode(root, h.id);
    expect(next.children.map((c) => c.text)).toEqual(["a"]);
  });

  it("removeNode 拒绝删除携带不可见正文的标题节点", () => {
    const root = parse("# t\n\n## H\n\n一段说明\n\n- b\n", "我的导图.md").root;
    const h = root.children[0];
    expect(h.continuation).toContain("一段说明");
    const { root: next, nextSelectionId } = removeNode(root, h.id);
    expect(next).toBe(root);
    expect(nextSelectionId).toBe(h.id);
  });

  it("removeNode 同样拒绝携带不可见正文的列表项（判据不看形态）", () => {
    // 用表格行而不是有序列表：有序列表现在会产生节点，不再是「图上不可见的正文」。
    const root = parse("# t\n\n- a\n| 表头 |\n- b\n", "我的导图.md").root;
    const a = root.children[0];
    expect(a.continuation).toEqual(["| 表头 |"]);
    expect(removeNode(root, a.id).root).toBe(root);
  });

  it("moveNode 拒绝标题节点作为源", () => {
    const root = headingTree();
    expect(moveNode(root, root.children[1].id, root.id, 0)).toBe(root);
  });

  it("moveNode 落点索引不得越过第一个标题子节点", () => {
    const root = headingTree();
    const b = root.children[1].children[0];
    // 要求插到根的 index 2（即 H 之后），必须被夹到 1
    const next = moveNode(root, b.id, root.id, 2);
    expect(next.children.map((c) => c.text)).toEqual(["a", "b", "H"]);
    expect(next.children[1].children).toEqual([]);
  });

  it("setMarks / toggleMark 对非根标题节点生效", () => {
    const root = headingTree();
    const h = root.children[1];
    expect(setMarks(root, h.id, { priority: 1 }).children[1].marks).toEqual({
      priority: 1,
    });
    expect(toggleMark(root, h.id, { flag: "red" }).children[1].marks).toEqual({
      flag: "red",
    });
  });

  it("setMarks / toggleMark 对根节点仍是 no-op", () => {
    const root = headingTree();
    expect(setMarks(root, root.id, { priority: 1 })).toBe(root);
    expect(toggleMark(root, root.id, { priority: 1 })).toBe(root);
  });

  it("标题节点带标记时写回到 `#` 之后", () => {
    const doc = parse("# t\n\n## H\n\n- b\n", "我的导图.md");
    const next = { ...doc, root: setMarks(doc.root, doc.root.children[0].id, { priority: 2 }) };
    expect(serialize(next)).toBe("# t\n\n## (p2) H\n\n- b\n");
  });

  it("setMarks 对列表项照常生效", () => {
    const root = headingTree();
    const a = root.children[0];
    expect(setMarks(root, a.id, { priority: 1 }).children[0].marks).toEqual({
      priority: 1,
    });
  });

  it("toggleCollapse 对标题节点照常生效", () => {
    const root = headingTree();
    const h = root.children[1];
    expect(toggleCollapse(root, h.id).children[1].collapsed).toBe(true);
  });

  it("setText 对标题节点照常生效，形态不变", () => {
    const root = headingTree();
    const h = root.children[1];
    const next = setText(root, h.id, "改名");
    expect(next.children[1].text).toBe("改名");
    expect(isHeading(next.children[1])).toBe(true);
    expect(next.children[1].heading?.prefix).toBe("## ");
  });
});

describe("setNote / canNote", () => {
  it("给节点写入备注", () => {
    const doc = parse("# t\n\n- a\n", "x.md");
    const a = doc.root.children[0];
    const next = setNote(doc.root, a.id, "第一行\n第二行");
    expect(next.children[0].note).toEqual({ text: "第一行\n第二行", raw: null });
  });

  it("覆盖已有备注时 raw 置 null，写回按当前缩进重新生成", () => {
    const doc = parse("# t\n\n- a\n  >旧备注\n", "x.md");
    const a = doc.root.children[0];
    expect(a.note?.raw).toEqual(["  >旧备注"]);
    const next = setNote(doc.root, a.id, "新备注");
    expect(next.children[0].note).toEqual({ text: "新备注", raw: null });
    expect(serialize({ ...doc, root: next })).toBe("# t\n\n- a\n  > 新备注\n");
  });

  it("空白文本即删除备注", () => {
    const doc = parse("# t\n\n- a\n  > 备注\n", "x.md");
    const a = doc.root.children[0];
    const next = setNote(doc.root, a.id, "   \n  ");
    expect(next.children[0].note).toBeUndefined();
    expect(serialize({ ...doc, root: next })).toBe("# t\n\n- a\n");
  });

  it("对根 id 是 no-op", () => {
    const doc = parse("# t\n\n- a\n", "x.md");
    expect(setNote(doc.root, doc.root.id, "备注")).toBe(doc.root);
  });

  it("canNote：根不可，其余可", () => {
    const doc = parse("# t\n\n- a\n", "x.md");
    expect(canNote(doc.root, doc.root.id)).toBe(false);
    expect(canNote(doc.root, doc.root.children[0].id)).toBe(true);
    expect(canNote(doc.root, "不存在的 id")).toBe(false);
  });
});

describe("备注不让节点变成不可删/不可拖", () => {
  it("只带备注的节点 hasHiddenContent 为 false", () => {
    const doc = parse("# t\n\n- a\n  > 备注\n", "x.md");
    const a = doc.root.children[0];
    expect(hasHiddenContent(a)).toBe(false);
    expect(canRemove(doc.root, a.id)).toBe(true);
  });
});

describe("moveNode 使备注的 raw 失效", () => {
  it("移动子树内所有节点的 raw 都置 null", () => {
    const doc = parse("# t\n\n- a\n  > A 的备注\n  - b\n    > B 的备注\n- c\n", "x.md");
    const a = doc.root.children[0];
    const c = doc.root.children[1];

    const next = moveNode(doc.root, a.id, c.id, 0);
    const movedA = next.children[0].children[0];
    expect(movedA.id).toBe(a.id);
    expect(movedA.note).toEqual({ text: "A 的备注", raw: null });
    expect(movedA.children[0].note).toEqual({ text: "B 的备注", raw: null });
    // 深度变了，写回时按新缩进重新生成。
    expect(serialize({ ...doc, root: next })).toBe(
      "# t\n\n- c\n  - a\n    > A 的备注\n    - b\n      > B 的备注\n",
    );
  });

  it("没被移动的节点保留原始 raw", () => {
    const doc = parse("# t\n\n- a\n  > A 的备注\n- c\n  > C 的备注\n", "x.md");
    const a = doc.root.children[0];
    const c = doc.root.children[1];
    const next = moveNode(doc.root, a.id, c.id, 0);
    expect(next.children[0].note?.raw).toEqual(["  > C 的备注"]);
  });
});

/** 造一串列表项兄弟。`"-"` 表示无序，`"3."` / `"5)"` 表示有序。 */
function siblings(...specs: string[]): MindNode[] {
  return specs.map((spec, index) => {
    const base: MindNode = {
      id: `s${index}`,
      text: `t${index}`,
      marks: {},
      children: [],
      collapsed: false,
      continuation: [],
      bullet: "-",
    };
    if (spec === "-") return base;
    const delim = spec.slice(-1) as "." | ")";
    return { ...base, ordered: { number: Number(spec.slice(0, -1)), delim } };
  });
}

/** 把兄弟串还原成 `siblings` 的输入形态，便于整串断言。 */
function specs(nodes: readonly MindNode[]): string[] {
  return nodes.map((n) =>
    n.ordered === undefined ? "-" : `${n.ordered.number}${n.ordered.delim}`,
  );
}

describe("renumber", () => {
  it("段内插入：起始号沿用变更前的段首号", () => {
    const prev = siblings("1.", "2.", "3.");
    const next = [prev[0], ...siblings("9."), prev[1], prev[2]];
    expect(specs(renumber(prev, next))).toEqual(["1.", "2.", "3.", "4."]);
  });

  it("删掉段首：剩下的节点各自保号，不被拉回 1", () => {
    const prev = siblings("3.", "4.", "5.");
    expect(specs(renumber(prev, [prev[1], prev[2]]))).toEqual(["3.", "4."]);
  });

  it("拖到段首：起始号仍取变更前的段首号，不被新来的节点带偏", () => {
    const prev = siblings("1.", "2.");
    const next = [...siblings("5."), prev[0], prev[1]];
    expect(specs(renumber(prev, next))).toEqual(["1.", "2.", "3."]);
  });

  it("新长出来的段从 1 起", () => {
    expect(specs(renumber([], siblings("1.")))).toEqual(["1."]);
    expect(specs(renumber([], siblings("7.")))).toEqual(["1."]);
  });

  it("无序节点把有序段一分为二，第二段从 1 起", () => {
    const prev = siblings("1.", "2.", "3.");
    const next = [prev[0], ...siblings("-"), prev[1], prev[2]];
    expect(specs(renumber(prev, next))).toEqual(["1.", "-", "1.", "2."]);
  });

  it("delim 不同就是两个段，各自独立计数", () => {
    const prev = siblings("1.", "2.", "5)", "6)");
    const next = [prev[0], ...siblings("9."), prev[1], prev[2], prev[3]];
    expect(specs(renumber(prev, next))).toEqual(["1.", "2.", "3.", "5)", "6)"]);
  });

  it("纯无序的兄弟串原样返回", () => {
    const prev = siblings("-", "-");
    const next = [prev[0], ...siblings("-"), prev[1]];
    expect(specs(renumber(prev, next))).toEqual(["-", "-", "-"]);
    expect(renumber(prev, next).every((n) => n.ordered === undefined)).toBe(true);
  });

  it("号没变的节点保持同一个对象引用", () => {
    const prev = siblings("1.", "2.");
    const out = renumber(prev, [prev[0], prev[1]]);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(prev[1]);
  });

  it("不改动入参数组", () => {
    const prev = siblings("1.", "2.");
    renumber(prev, [prev[0], ...siblings("9."), prev[1]]);
    expect(specs(prev)).toEqual(["1.", "2."]);
    expect(prev[1].ordered).toEqual({ number: 2, delim: "." });
  });
});

/** n0=根 / n1=a / n2=b / n3=c，一条从 1 起的有序列表 */
function orderedTree(): MindNode {
  return parse("# 根\n\n1. a\n2. b\n3. c\n", "x.md").root;
}

describe("有序列表上的结构编辑", () => {
  it("addSibling 插入后整段重排", () => {
    const { root } = addSibling(orderedTree(), "n1", "new");
    expect(root.children.map((c) => c.text)).toEqual(["a", "new", "b", "c"]);
    expect(root.children.map((c) => c.ordered?.number)).toEqual([1, 2, 3, 4]);
  });

  it("addSibling 继承参照兄弟的分隔符", () => {
    const root = parse("# 根\n\n1) a\n", "x.md").root;
    const next = addSibling(root, "n1", "new").root;
    expect(next.children.map((c) => c.ordered)).toEqual([
      { number: 1, delim: ")" },
      { number: 2, delim: ")" },
    ]);
  });

  it("removeNode 删掉段首后剩余节点保号", () => {
    const root = parse("# 根\n\n3. a\n4. b\n5. c\n", "x.md").root;
    const next = removeNode(root, "n1").root;
    expect(next.children.map((c) => c.ordered?.number)).toEqual([3, 4]);
  });

  it("removeNode 删掉中间节点后其后的重排", () => {
    const next = removeNode(orderedTree(), "n2").root;
    expect(next.children.map((c) => c.text)).toEqual(["a", "c"]);
    expect(next.children.map((c) => c.ordered?.number)).toEqual([1, 2]);
  });

  it("addChild 给有序父节点产出有序子节点，从 1 起", () => {
    const { root } = addChild(orderedTree(), "n1", "child");
    const a = findNode(root, "n1") as MindNode;
    expect(a.children[0].ordered).toEqual({ number: 1, delim: "." });
  });

  it("addChild 给无序父节点产出无序子节点", () => {
    const root = parse("# 根\n\n* a\n", "x.md").root;
    const a = findNode(addChild(root, "n1", "child").root, "n1") as MindNode;
    expect(a.children[0].ordered).toBeUndefined();
    expect(a.children[0].bullet).toBe("*");
  });

  it("addChild 到根：继承文件里第一个列表项的形态", () => {
    const root = parse("# 根\n\n1) a\n", "x.md").root;
    const next = addChild(root, "n0", "new").root;
    expect(next.children[1].ordered).toEqual({ number: 2, delim: ")" });
  });

  it("moveNode 跨父移动：源父与目标父各自重排", () => {
    // 按文档顺序分配 id：n1=a / n2=b / n3=b1 / n4=c
    const root = parse("# 根\n\n1. a\n2. b\n  1. b1\n3. c\n", "x.md").root;
    const next = moveNode(root, "n3", "n0", 0);
    expect(next.children.map((c) => c.text)).toEqual(["b1", "a", "b", "c"]);
    expect(next.children.map((c) => c.ordered?.number)).toEqual([1, 2, 3, 4]);
    expect((findNode(next, "n2") as MindNode).children).toEqual([]);
  });

  it("moveNode 同父内移动：两次重排的结果正确", () => {
    const next = moveNode(orderedTree(), "n3", "n0", 0);
    expect(next.children.map((c) => c.text)).toEqual(["c", "a", "b"]);
    expect(next.children.map((c) => c.ordered?.number)).toEqual([1, 2, 3]);
  });

  it("moveNode 把无序节点拖进有序段：段一分为二，第二段从 1 起", () => {
    const root = parse("# 根\n\n1. a\n2. b\n3. c\n\n## A\n\n- u\n", "x.md").root;
    const u = root.children.find((c) => c.text === "A")?.children[0] as MindNode;
    const next = moveNode(root, u.id, "n0", 1);
    expect(next.children.slice(0, 4).map((c) => c.text)).toEqual(["a", "u", "b", "c"]);
    expect(next.children.slice(0, 4).map((c) => c.ordered?.number)).toEqual([
      1,
      undefined,
      1,
      2,
    ]);
  });

  it("纯无序的树经过四个 op 后不会凭空长出 ordered 字段", () => {
    const hasOrdered = (node: MindNode): boolean =>
      node.ordered !== undefined || node.children.some(hasOrdered);
    let root = tree();
    root = addChild(root, "n1", "x").root;
    root = addSibling(root, "n2", "y").root;
    root = moveNode(root, "n4", "n1", 0);
    root = removeNode(root, "n3").root;
    expect(hasOrdered(root)).toBe(false);
  });

  it("编辑后序列化出的序号连续", () => {
    const doc = parse("# 根\n\n1. a\n2. b\n", "x.md");
    const next = { ...doc, root: addSibling(doc.root, "n1", "new").root };
    expect(serialize(next)).toBe("# 根\n\n1. a\n2. new\n3. b\n");
  });
});
