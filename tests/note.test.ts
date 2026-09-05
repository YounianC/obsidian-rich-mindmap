import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { renderNote, splitNote } from "../src/model/note";
import { parse } from "../src/model/parser";
import type { MindNode } from "../src/model/types";

describe("splitNote", () => {
  it("收编开头连续的引用行，遇到非引用行截断", () => {
    const result = splitNote(["  > 第一行", "  > 第二行", "  普通续行"]);
    expect(result.note).toEqual({
      text: "第一行\n第二行",
      raw: ["  > 第一行", "  > 第二行"],
    });
    expect(result.rest).toEqual(["  普通续行"]);
  });

  it("开头不是引用行时不收编，续行原样返回", () => {
    const result = splitNote(["  普通续行", "  > 不是备注"]);
    expect(result.note).toBeNull();
    expect(result.rest).toEqual(["  普通续行", "  > 不是备注"]);
  });

  it("空续行返回空备注", () => {
    expect(splitNote([])).toEqual({ note: null, rest: [] });
  });

  it("`>` 后没有空格也认，且 raw 逐字保留", () => {
    const result = splitNote(["  >备注"]);
    expect(result.note).toEqual({ text: "备注", raw: ["  >备注"] });
  });

  it("`>` 后有两个空格时只吃掉一个，第二个属于正文", () => {
    expect(splitNote(["  >  备注"]).note?.text).toBe(" 备注");
  });

  it("tab 缩进同样认", () => {
    expect(splitNote(["\t> 备注"]).note?.text).toBe("备注");
  });

  it("`>` 单独成行解码成空行", () => {
    expect(splitNote(["  > 上", "  >", "  > 下"]).note?.text).toBe("上\n\n下");
  });

  it("callout 一律按引用行收编，不做特判", () => {
    const result = splitNote(["  > [!note] 提示", "  > 内容"]);
    expect(result.note?.text).toBe("[!note] 提示\n内容");
  });
});

describe("renderNote", () => {
  it("每行加缩进与 `> ` 前缀", () => {
    expect(renderNote("第一行\n第二行", "  ")).toEqual(["  > 第一行", "  > 第二行"]);
  });

  it("空行写成 `indent + \">\"` 而不是真空行", () => {
    // 真空行会把一个引用块劈成两个，重新解析时 splitNote 只收到前半段，
    // 后半段掉进 continuation 变成不可见正文——一次编辑静默吃掉半条备注。
    expect(renderNote("上\n\n下", "\t")).toEqual(["\t> 上", "\t>", "\t> 下"]);
  });
});

describe("renderNote → splitNote 往返", () => {
  it("对任意正文成立", () => {
    const bodyArb = fc
      .array(
        fc.constantFrom("普通文字", "", " 前导空格", "> 引用", "- 列表", "# 标题", "```"),
        { minLength: 1, maxLength: 6 },
      )
      .map((lines) => lines.join("\n"));

    fc.assert(
      fc.property(bodyArb, fc.constantFrom("", "  ", "    ", "\t"), (body, indent) => {
        const back = splitNote(renderNote(body, indent));
        expect(back.note?.text).toBe(body);
        expect(back.rest).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

function countNodes(node: MindNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/**
 * 对抗性测试：备注正文里写什么都不能改变导图的节点数。
 *
 * 这是「`>` 前缀天然是逃逸字符」这个论证的可执行版本。只有正确性用例不够——
 * 门禁看不见「某个输入让备注长出一个假节点、或打开一个假围栏」这类问题。
 * AGENTS.md：手写 parser 只交正确性测试不够，必须同时带对抗性输入测试。
 */
describe("备注正文不改变导图结构", () => {
  it("对任意正文成立", () => {
    const hostileLine = fc.constantFrom(
      "- 列表项",
      "* 星号列表",
      "+ 加号列表",
      "  - 缩进列表项",
      "# 一级标题",
      "## 二级标题",
      "###### 六级标题",
      "```",
      "```js",
      "~~~",
      "> 引用",
      ">> 双层引用",
      "1. 有序列表",
      "普通文字",
      "",
      "\t- tab 缩进列表项",
      "---",
    );
    const bodyArb = fc
      .array(hostileLine, { minLength: 1, maxLength: 8 })
      .map((lines) => lines.join("\n"));

    const baseline = countNodes(parse("# t\n\n- a\n- b\n", "x.md").root);

    fc.assert(
      fc.property(bodyArb, (body) => {
        const note = renderNote(body, "  ").join("\n");
        const md = `# t\n\n- a\n${note}\n- b\n`;
        const doc = parse(md, "x.md");
        expect(countNodes(doc.root)).toBe(baseline);
        // 备注必须整条落在 a 身上，一个字符都不能漏进别处。
        expect(doc.root.children[0].note?.text).toBe(body);
      }),
      { numRuns: 500 },
    );
  });
});
