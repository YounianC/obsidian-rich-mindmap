import { describe, expect, it } from "vitest";
import { decidePaneAction, type PaneSnapshot } from "../src/source-pane";

/** 便于读的构造器：pane("a", "note.md") 表示 leaf "a" 正显示 note.md。
 *  用字符串当 leaf，泛型 T 因此被实例化成 string——这正是把它做成泛型的
 *  目的：测试不需要 mock 整个 Obsidian Workspace。 */
function pane(leaf: string, path: string | null): PaneSnapshot<string> {
  return { leaf, path };
}

describe("decidePaneAction", () => {
  it("没有配对、也没有任何面板显示该文件 → 新建分屏", () => {
    expect(decidePaneAction([], null, "note.md")).toEqual({ kind: "create" });
  });

  it("没有配对，但用户自己已经开着显示该文件的面板 → 复用它，不新开第三个", () => {
    const panes = [pane("other", "别的.md"), pane("mine", "note.md")];
    expect(decidePaneAction(panes, null, "note.md")).toEqual({
      kind: "reveal",
      leaf: "mine",
    });
  });

  it("有配对且它仍显示该文件 → 关掉它（按钮是 toggle）", () => {
    const panes = [pane("paired", "note.md")];
    expect(decidePaneAction(panes, "paired", "note.md")).toEqual({
      kind: "close",
      leaf: "paired",
    });
  });

  it("配对面板已被用户关掉（不在列表里）→ 新建，不报错", () => {
    expect(decidePaneAction([], "gone", "note.md")).toEqual({ kind: "create" });
  });

  it("配对面板被挪去开了别的文件 → 视为配对已断，新建", () => {
    const panes = [pane("paired", "别的.md")];
    expect(decidePaneAction(panes, "paired", "note.md")).toEqual({ kind: "create" });
  });

  it("配对面板被手动切成了导图视图（不再出现在 markdown 面板列表里），但另有面板显示该文件 → 复用那个，而不是关掉", () => {
    const panes = [pane("another", "note.md")];
    expect(decidePaneAction(panes, "flipped", "note.md")).toEqual({
      kind: "reveal",
      leaf: "another",
    });
  });

  it("多个面板显示该文件时，关掉的是配对的那个，不是列表里第一个", () => {
    const panes = [pane("first", "note.md"), pane("paired", "note.md")];
    expect(decidePaneAction(panes, "paired", "note.md")).toEqual({
      kind: "close",
      leaf: "paired",
    });
  });

  it("path 为 null 的面板（视图还没绑上文件）永不被选中", () => {
    const panes = [pane("blank", null)];
    expect(decidePaneAction(panes, null, "note.md")).toEqual({ kind: "create" });
    expect(decidePaneAction(panes, "blank", "note.md")).toEqual({ kind: "create" });
  });
});
