import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import {
  addChild,
  addSibling,
  findNode,
  findParent,
  freshId,
  moveNode,
  navigate,
  removeNode,
  setMarks,
  setText,
  toggleCollapse,
  toggleMark,
  visibleNodes,
} from "../src/model/tree-ops";
import type { MindNode } from "../src/model/types";

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
