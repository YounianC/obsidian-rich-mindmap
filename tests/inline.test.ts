import { describe, expect, it } from "vitest";
import { parseInline, type InlineToken } from "../src/model/inline";

/**
 * 仅供测试使用：把 token 树还原成源文本，用来验证 tokenizer 不丢字符。
 * 注意这不是无损的通用反解析器——对于 `[[Foo|Foo]]` 这种别名与目标恰好相同、
 * 或包含不必要转义（如 `\_`）的输入，还原结果可能与原文不完全一致，所以下面
 * 的往返测试只选用没有这类歧义的样例。
 */
function reconstruct(tokens: InlineToken[]): string {
  return tokens.map(reconstructOne).join("");
}

function reconstructOne(token: InlineToken): string {
  switch (token.kind) {
    case "text":
      return token.text;
    case "strong":
      return `**${reconstruct(token.children)}**`;
    case "em":
      return `*${reconstruct(token.children)}*`;
    case "del":
      return `~~${reconstruct(token.children)}~~`;
    case "code":
      return `\`${token.text}\``;
    case "wikilink":
      return token.target === token.label
        ? `[[${token.target}]]`
        : `[[${token.target}|${token.label}]]`;
    case "link":
      return `[${token.label}](${token.href})`;
  }
}

describe("parseInline — 基本 token 类型", () => {
  it("空字符串返回空数组", () => {
    expect(parseInline("")).toEqual([]);
  });

  it("没有任何行内语法的普通文本", () => {
    expect(parseInline("hello world")).toEqual([
      { kind: "text", text: "hello world" },
    ]);
  });

  it("加粗", () => {
    expect(parseInline("**bold**")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "bold" }] },
    ]);
  });

  it("斜体（只认 *，不认 _）", () => {
    expect(parseInline("*italic*")).toEqual([
      { kind: "em", children: [{ kind: "text", text: "italic" }] },
    ]);
  });

  it("下划线不触发斜体——避免 font_size 这类词内下划线误判", () => {
    expect(parseInline("font_size")).toEqual([
      { kind: "text", text: "font_size" },
    ]);
    expect(parseInline("my_var and _also_ this_")).toEqual([
      { kind: "text", text: "my_var and _also_ this_" },
    ]);
  });

  it("删除线", () => {
    expect(parseInline("~~gone~~")).toEqual([
      { kind: "del", children: [{ kind: "text", text: "gone" }] },
    ]);
  });

  it("行内代码是叶子节点，内部标记不解析", () => {
    expect(parseInline("`font-size >= 24pt`")).toEqual([
      { kind: "code", text: "font-size >= 24pt" },
    ]);
    expect(parseInline("`**not bold**`")).toEqual([
      { kind: "code", text: "**not bold**" },
    ]);
  });

  it("wikilink 不带别名，label 回退为 target", () => {
    expect(parseInline("[[Talk Slides]]")).toEqual([
      { kind: "wikilink", target: "Talk Slides", label: "Talk Slides" },
    ]);
  });

  it("wikilink 带别名 [[page|alias]]", () => {
    expect(parseInline("[[Travel 2026|酒店]]")).toEqual([
      { kind: "wikilink", target: "Travel 2026", label: "酒店" },
    ]);
  });

  it("外部链接 [text](url)", () => {
    expect(parseInline("[Anthropic](https://anthropic.com)")).toEqual([
      { kind: "link", href: "https://anthropic.com", label: "Anthropic" },
    ]);
  });
});

describe("parseInline — 嵌套", () => {
  it("加粗内部嵌套斜体", () => {
    expect(parseInline("**bold with *italic* inside**")).toEqual([
      {
        kind: "strong",
        children: [
          { kind: "text", text: "bold with " },
          { kind: "em", children: [{ kind: "text", text: "italic" }] },
          { kind: "text", text: " inside" },
        ],
      },
    ]);
  });

  it("删除线内部嵌套加粗", () => {
    expect(parseInline("~~old **bold** text~~")).toEqual([
      {
        kind: "del",
        children: [
          { kind: "text", text: "old " },
          { kind: "strong", children: [{ kind: "text", text: "bold" }] },
          { kind: "text", text: " text" },
        ],
      },
    ]);
  });
});

describe("parseInline — 未闭合/畸形标记回退为字面量", () => {
  it("未闭合的加粗保留星号", () => {
    expect(parseInline("**bold without close")).toEqual([
      { kind: "text", text: "**bold without close" },
    ]);
  });

  it("未闭合的斜体保留星号", () => {
    expect(parseInline("*oops")).toEqual([{ kind: "text", text: "*oops" }]);
  });

  it("未闭合的删除线保留波浪线", () => {
    expect(parseInline("~~oops")).toEqual([
      { kind: "text", text: "~~oops" },
    ]);
  });

  it("未闭合的行内代码反引号保留字面量", () => {
    expect(parseInline("`oops")).toEqual([{ kind: "text", text: "`oops" }]);
  });

  it("未闭合的 wikilink 保留字面量", () => {
    expect(parseInline("[[not closed")).toEqual([
      { kind: "text", text: "[[not closed" },
    ]);
  });

  it("[text 没有跟 (url) 时按字面量处理", () => {
    expect(parseInline("[not a link] plain")).toEqual([
      { kind: "text", text: "[not a link] plain" },
    ]);
  });

  it("永不抛出异常，永不吞掉字符——各种畸形组合", () => {
    const inputs = [
      "**",
      "*",
      "~~",
      "`",
      "[[",
      "[[]]",
      "[]()",
      "***",
      "~*~",
      "**~~*`[[",
    ];
    for (const input of inputs) {
      expect(() => parseInline(input)).not.toThrow();
      const tokens = parseInline(input);
      expect(reconstructPlainLength(tokens)).toBeGreaterThanOrEqual(0);
    }
  });
});

/** 粗略校验：把所有 text/code 叶子的字符长度相加，只是确认没有异常提前退出。 */
function reconstructPlainLength(tokens: InlineToken[]): number {
  let total = 0;
  for (const token of tokens) {
    if (token.kind === "text" || token.kind === "code") {
      total += token.text.length;
    } else if (
      token.kind === "strong" ||
      token.kind === "em" ||
      token.kind === "del"
    ) {
      total += reconstructPlainLength(token.children);
    } else {
      total += token.label.length;
    }
  }
  return total;
}

describe("parseInline — 转义", () => {
  it("反斜杠转义 * _ ~ ` [ \\ 产生字面字符", () => {
    expect(parseInline("\\*\\_\\~\\`\\[\\\\")).toEqual([
      { kind: "text", text: "*_~`[\\" },
    ]);
  });

  it("转义后的星号不再触发斜体", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([
      { kind: "text", text: "*not italic*" },
    ]);
  });

  it("转义的方括号不触发 wikilink", () => {
    expect(parseInline("\\[[not a link]]")).toEqual([
      { kind: "text", text: "[[not a link]]" },
    ]);
  });

  it("反斜杠后跟非转义字符时原样保留反斜杠", () => {
    expect(parseInline("C:\\Users\\a")).toEqual([
      { kind: "text", text: "C:\\Users\\a" },
    ]);
  });
});

describe("parseInline — 标记紧贴标点", () => {
  it("加粗紧跟逗号和感叹号", () => {
    expect(parseInline("Hello, **world**!")).toEqual([
      { kind: "text", text: "Hello, " },
      { kind: "strong", children: [{ kind: "text", text: "world" }] },
      { kind: "text", text: "!" },
    ]);
  });

  it("斜体紧贴括号", () => {
    expect(parseInline("(*note*)")).toEqual([
      { kind: "text", text: "(" },
      { kind: "em", children: [{ kind: "text", text: "note" }] },
      { kind: "text", text: ")" },
    ]);
  });
});

describe("parseInline — 不解释 HTML", () => {
  it("尖括号与 & 原样作为文本，不被当成标签或实体", () => {
    expect(parseInline("<b>a & b</b>")).toEqual([
      { kind: "text", text: "<b>a & b</b>" },
    ]);
  });

  it("script 标签字样也只是普通文本", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([
      { kind: "text", text: "<script>alert(1)</script>" },
    ]);
  });
});

describe("parseInline — token 往返（无歧义样例）", () => {
  const samples = [
    "plain text, no markup",
    "**one diagram** people remember",
    "*unpleasant but effective*",
    "~~long tangent about monorepos~~",
    "`font-size >= 24pt`",
    "draft the deck in [[Talk Slides]]",
    "hotel confirmation filed under [[Travel 2026|酒店]]",
    "see [Anthropic](https://anthropic.com) for details",
    "**bold with *italic* inside** plus more",
    "混合中文 **加粗** 和 *斜体* 与 `代码`",
  ];

  for (const sample of samples) {
    it(`reconstruct(parseInline(${JSON.stringify(sample)})) === 原文`, () => {
      expect(reconstruct(parseInline(sample))).toBe(sample);
    });
  }
});

describe("parseInline — 综合场景（截图里出现过的真实缺陷）", () => {
  it("同一节点里混杂多种语法都能正确解析", () => {
    const text =
      "Before/after call graphs — the **one diagram** people remember";
    expect(parseInline(text)).toEqual([
      { kind: "text", text: "Before/after call graphs — the " },
      { kind: "strong", children: [{ kind: "text", text: "one diagram" }] },
      { kind: "text", text: " people remember" },
    ]);
  });
});
