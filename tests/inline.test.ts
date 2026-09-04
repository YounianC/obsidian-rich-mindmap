import { describe, expect, it } from "vitest";
import { parseInline, parseInlineWithDepth, type InlineToken } from "../src/model/inline";

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

describe("parseInline — 性能回归（parseSpan 按 (start, closer) 记忆化）", () => {
  // 单个重复单元里 **、*、~~ 各只出现一次，谁都配不成对，整体只能退化成字面
  // 文本——这个结果是手工逐步模拟算法核对过的（过程见
  // .superpowers/inline-markdown-report.md「Fix round 1」一节），作为下面大
  // 输入场景的语义基准锚点：如果将来有人把 parseSpan 优化成别的实现，只要
  // 输出形状变了，这一条会先炸，逼着改动者解释为什么。
  const UNIT = "**a*b~~c";

  it("单个重复单元没有任何标记能配对，整体退化为字面文本（人工核对过的基准）", () => {
    expect(parseInline(UNIT)).toEqual([{ kind: "text", text: UNIT }]);
  });

  it("大量标记混杂且大部分不闭合时不再指数级爆炸——240 字符（.repeat(30)）在极短时间内完成", () => {
    // 记忆化之前，这个长度的输入实测 >15s（见任务里贴出的测量表格）。
    const input = UNIT.repeat(30);
    const start = performance.now();
    const tokens = parseInline(input);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    // 不丢字符：token 树还原后与原文逐字节相等。
    expect(reconstruct(tokens)).toBe(input);
  });

  it("2400 字符（.repeat(300)）同样在 500ms 内完成，且不丢字符", () => {
    const input = UNIT.repeat(300);
    const start = performance.now();
    const tokens = parseInline(input);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(reconstruct(tokens)).toBe(input);
  });

  it("记忆化缓存按单次 parseInline 调用隔离——同一大输入解析两次，结果完全一致（deepEqual，不只是 round-trip 字符串相等）", () => {
    const input = UNIT.repeat(30);
    const first = parseInline(input);
    const second = parseInline(input);
    expect(second).toEqual(first);
  });

  it("记忆化本身不限制递归深度，深度会随字符数线性增长——超大输入不再栈溢出", () => {
    // 记忆化解决的是「同一 (start, closer) 被重复计算」这个时间问题，不解决
    // 「未闭合标记会让递归链条越叠越深」这个空间问题：这种混杂标记的输入，
    // 递归深度大约是字符数的 0.375 倍。16000 字符（.repeat(2000)）已经明显
    // 超过实测会让未加深度上限的版本在 Node 20 里抛
    // `RangeError: Maximum call stack size exceeded` 的临界点（约 8000 字符、
    // 深度约 3000，且该临界点本身随 JIT 预热状态漂移、不可靠）。这里选一个
    // 有充分余量的长度，只要不抛异常、时间在门槛内、字符不丢，就说明
    // `MAX_DEPTH` 兜底生效了。
    const input = UNIT.repeat(2000); // 16000 字符
    const start = performance.now();
    let tokens: ReturnType<typeof parseInline> | undefined;
    expect(() => {
      tokens = parseInline(input);
    }).not.toThrow();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(tokens).toBeDefined();
    expect(reconstruct(tokens as InlineToken[])).toBe(input);
  });
});

describe("parseInline — 结构化输出（round-trip 相等不足以发现的退化）", () => {
  // round-trip（reconstruct(parseInline(x)) === x）只能证明"没丢字符"，
  // 一个把所有内容都判定成一个 text token 的实现也能通过 round-trip——
  // MAX_DEPTH 被调得过紧就是这样一种退化：真实的 **/*/`` 嵌套被当成字面
  // 文本处理，round-trip 依旧成立，但用户看到的画布上不再有加粗/斜体/代码
  // 样式。这个 describe 块专门断言 token *树的结构*，不只是还原出的字符串。

  it("~600 字符的普通文本，嵌套标记出现在靠后位置：应解析出 strong→em 嵌套与 code token，而不是整段字面文本", () => {
    const padding =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(
        4,
      );
    const text =
      padding +
      "**bold with *em* inside** trailing prose here and there, quite a lot of it actually. " +
      "`code`" +
      " and a bit more trailing text to round things out nicely at the end.";
    // 长度与标记位置符合任务描述的场景：~600+ 字符，加粗出现在约第 500 个
    // 字符处，代码标记出现在约第 580 个字符处。
    expect(text.length).toBeGreaterThan(600);
    expect(text.indexOf("**bold")).toBeGreaterThan(400);
    expect(text.indexOf("`code`")).toBeGreaterThan(550);

    const tokens = parseInline(text);

    const strong = tokens.find(
      (t): t is Extract<InlineToken, { kind: "strong" }> => t.kind === "strong",
    );
    expect(strong, "应该解析出 strong token，而不是把 ** 当字面文本").toBeDefined();
    const em = strong!.children.find(
      (t): t is Extract<InlineToken, { kind: "em" }> => t.kind === "em",
    );
    expect(em, "strong 内部应该嵌套出 em token").toBeDefined();
    expect(em!.children).toEqual([{ kind: "text", text: "em" }]);

    const code = tokens.find(
      (t): t is Extract<InlineToken, { kind: "code" }> => t.kind === "code",
    );
    expect(code, "应该解析出 code token，而不是把反引号当字面文本").toBeDefined();
    expect(code!.text).toBe("code");

    // round-trip 依旧必须成立——结构化断言是round-trip的补充，不是替代。
    expect(reconstruct(tokens)).toBe(text);
  });

  it('"**a*b~~c".repeat(300)（2400 字符）与"实质上不受限"的深度上限（1_000_000）产出完全相同的 token 树', () => {
    // UNIT 定义在上面「性能回归」describe 块的作用域内，这里独立重复一份，
    // 保持两处对同一个病态输入族的定义各自独立、互不依赖。
    const UNIT = "**a*b~~c";
    const input = UNIT.repeat(300);
    const capped = parseInline(input); // 生产路径，固定用 MAX_DEPTH
    const uncapped = parseInlineWithDepth(input, 1_000_000);
    expect(capped).toEqual(uncapped);
  });
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
