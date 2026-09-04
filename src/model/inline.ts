/**
 * 行内 Markdown 的纯函数 tokenizer。
 *
 * 为什么不用 Obsidian 的 `MarkdownRenderer.render()`：那是异步 API，而这个插件
 * 测量 → 布局 → 定位的渲染管线是同步的（见 src/view/renderer.ts）。把它接进来
 * 要么会让测量拿到还没渲染完的尺寸，要么会在渲染完成后引发一次可见的重排，还会
 * 打乱 `eventsAttached`/`needsFit`/`ResizeObserver` 这套已经调稳的生命周期。
 * `MarkdownRenderer.render()` 的输出还是块级 DOM（一层 <p> 包裹），需要额外拆包。
 * 所以这里自己实现一个小而窄的行内子集，输出 token 树，由 view 层同步地转成
 * DOM（见 src/view/node-el.ts），全程不出现 `innerHTML`。
 *
 * 支持的子集（就这些，故意不做更多）：
 * - `**bold**`      -> strong
 * - `*italic*`      -> em（只认 `*`，不认 `_`：`font_size`、`my_var` 这类词内
 *                     下划线在正常 Markdown 里本就不触发强调，若把 `_` 也算作
 *                     标记，会把大量代码变量名误判成斜体）
 * - `~~strike~~`    -> del
 * - `` `code` ``    -> code，叶子节点，内部不再递归解析（Markdown 本身的行为）
 * - `[[page]]` / `[[page|alias]]` -> wikilink，label 缺省回退为 target
 * - `[text](url)`   -> link
 * - 反斜杠转义：`\*` `\_` `\~` `` \` `` `\[` `\\` 产生对应字面字符，不再被当成
 *   标记；反斜杠后跟其他字符时反斜杠本身原样保留。
 *
 * 故意不支持：`#tag`、图片 `![]()`、任何 HTML、标题等块级语法。设计文档里
 * 「节点文字保留 #标签」说的是保留原样，不是把它渲染成链接——两者不是一回事。
 * 图片语法 `![alt](url)` 会被当成字面 `!` 加一个普通 `link` token 处理，不会
 * 抛异常，只是不出现 <img>，这是有意的降级而非缺陷。
 *
 * 任何未闭合或畸形的标记都必须原样回退成文本——不抛异常、不丢字符。
 */

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: InlineToken[] }
  | { kind: "em"; children: InlineToken[] }
  | { kind: "del"; children: InlineToken[] }
  | { kind: "code"; text: string }
  | { kind: "wikilink"; target: string; label: string }
  | { kind: "link"; href: string; label: string };

/** 反斜杠转义能产生字面字符的集合，其余字符后面的反斜杠原样保留。 */
const ESCAPABLE = new Set(["*", "_", "~", "`", "[", "\\"]);

interface SpanResult {
  tokens: InlineToken[];
  /** 消费到的下标（不含）。未闭合时等于扫描到的字符串末尾。 */
  end: number;
  /** 是否遇到了 closer 并正常闭合；false 表示扫到末尾都没找到。 */
  closed: boolean;
}

/**
 * 解析 `text[start..)` 直到遇到 `closer`（闭合并消费掉它）或扫到字符串末尾
 * （未闭合）。`closer` 为 `null` 表示顶层调用，解析到字符串末尾为止。
 */
function parseSpan(text: string, start: number, closer: string | null): SpanResult {
  const tokens: InlineToken[] = [];
  let buf = "";
  let pos = start;
  const len = text.length;

  const flush = (): void => {
    if (buf !== "") {
      tokens.push({ kind: "text", text: buf });
      buf = "";
    }
  };

  while (pos < len) {
    if (closer !== null && text.startsWith(closer, pos)) {
      flush();
      return { tokens, end: pos + closer.length, closed: true };
    }

    const ch = text[pos] as string;

    // 反斜杠转义。
    if (ch === "\\" && pos + 1 < len && ESCAPABLE.has(text[pos + 1] as string)) {
      buf += text[pos + 1];
      pos += 2;
      continue;
    }

    // 行内代码：叶子节点，内容原样保留，不再递归解析、不处理转义。
    if (ch === "`") {
      const closeAt = text.indexOf("`", pos + 1);
      if (closeAt === -1) {
        buf += ch;
        pos += 1;
      } else {
        flush();
        tokens.push({ kind: "code", text: text.slice(pos + 1, closeAt) });
        pos = closeAt + 1;
      }
      continue;
    }

    // wikilink：`[[page]]` 或 `[[page|alias]]`。
    if (text.startsWith("[[", pos)) {
      const closeAt = text.indexOf("]]", pos + 2);
      if (closeAt === -1) {
        buf += "[[";
        pos += 2;
      } else {
        flush();
        const inner = text.slice(pos + 2, closeAt);
        const pipeAt = inner.indexOf("|");
        const target = pipeAt === -1 ? inner : inner.slice(0, pipeAt);
        const label = pipeAt === -1 ? inner : inner.slice(pipeAt + 1);
        tokens.push({ kind: "wikilink", target, label });
        pos = closeAt + 2;
      }
      continue;
    }

    // 外部链接：`[text](url)`。label/href 都不递归解析行内语法，按字面量取。
    if (ch === "[") {
      const bracketClose = text.indexOf("]", pos + 1);
      if (
        bracketClose !== -1 &&
        text[bracketClose + 1] === "(" &&
        text.indexOf(")", bracketClose + 2) !== -1
      ) {
        const parenClose = text.indexOf(")", bracketClose + 2);
        flush();
        tokens.push({
          kind: "link",
          label: text.slice(pos + 1, bracketClose),
          href: text.slice(bracketClose + 2, parenClose),
        });
        pos = parenClose + 1;
        continue;
      }
      buf += ch;
      pos += 1;
      continue;
    }

    // 加粗：`**...**`，先于单星号斜体判断。
    if (text.startsWith("**", pos)) {
      const inner = parseSpan(text, pos + 2, "**");
      if (inner.closed) {
        flush();
        tokens.push({ kind: "strong", children: inner.tokens });
        pos = inner.end;
      } else {
        buf += "**";
        pos += 2;
      }
      continue;
    }

    // 删除线：`~~...~~`。
    if (text.startsWith("~~", pos)) {
      const inner = parseSpan(text, pos + 2, "~~");
      if (inner.closed) {
        flush();
        tokens.push({ kind: "del", children: inner.tokens });
        pos = inner.end;
      } else {
        buf += "~~";
        pos += 2;
      }
      continue;
    }

    // 斜体：单个 `*`。刻意不支持 `_`，见文件头注释。
    if (ch === "*") {
      const inner = parseSpan(text, pos + 1, "*");
      if (inner.closed) {
        flush();
        tokens.push({ kind: "em", children: inner.tokens });
        pos = inner.end;
      } else {
        buf += "*";
        pos += 1;
      }
      continue;
    }

    buf += ch;
    pos += 1;
  }

  flush();
  return { tokens, end: pos, closed: false };
}

export function parseInline(text: string): InlineToken[] {
  return parseSpan(text, 0, null).tokens;
}
