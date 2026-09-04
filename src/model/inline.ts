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
 * `parseSpan` 的记忆化缓存，key 是 `${start}:${closer}`。`closer` 只有四种取值
 * （`null`/`"**"`/`"*"`/`"~~"`），所以 key 空间是 O(4n)。
 *
 * 为什么需要它：未闭合的 `**`/`*`/`~~` 会让"从某个位置尝试某种闭合符"这个子
 * 问题在不同的递归上下文里被重复求解——一次是某个外层标记尝试匹配、失败后
 * 在其内部递归里顺带算过的，另一次是外层失败后主循环从原地重新扫描时再次
 * 触发的。两次调用的 `(start, closer)` 完全相同，结果也必然相同（`parseSpan`
 * 是纯函数，只依赖 `text`/`start`/`closer`），互不影响，可以安全共享。不加
 * 记忆化时，形如 `"**a*b~~c".repeat(n)` 这种"标记混杂且大量不闭合"的输入会
 * 触发指数级的重复子问题求解——64 字符输入约 3.3k 次调用，字符数每 +32 大约
 * 翻 16 倍，160 字符就要 1.27s、200 字符以上直接挂死；这正是把节点文字塞进
 * 同步渲染管线（AGENTS.md「一句话架构」）想要杜绝的场景：一个这样的节点会在
 * 每次 render() 时冻结 Obsidian 主线程。加上按 (start, closer) 的记忆化后，
 * 每个 key 只真正求解一次，总工作量降到多项式级别（详见
 * tests/inline.test.ts 里 `.repeat(30)`/`.repeat(300)` 的性能回归测试）。
 */
type SpanCache = Map<string, SpanResult>;

function spanCacheKey(start: number, closer: string | null): string {
  return `${start}:${closer ?? ""}`;
}

/**
 * `parseSpan` 的递归深度上限。记忆化解决的是重复计算（时间），但完全不限制
 * 单次调用链的深度（空间）——每遇到一个未闭合的 `**`/`~~`/`*` 就会往下多递归
 * 一层去找它的闭合符，而这个"往下一层"的次数在 `"**a*b~~c".repeat(n)` 这类
 * 标记混杂、大量不闭合的输入上，是随字符数**线性增长**的（实测约
 * `0.375 × 字符数`：2400 字符时递归深度约 900，8000 字符时约 3000）。
 * Node 20 的默认调用栈在深度 3000 附近就开始不稳定——同一段代码，冷启动直接
 * 跑会在 8000 字符处抛 `RangeError: Maximum call stack size exceeded`，
 * JIT 热身过后反而不抛，说明这条边界本来就贴着 V8 的栈预算走、不可预测，
 * 换成 Electron 渲染进程（Obsidian 的实际运行环境，栈预算可能更小）只会更容易
 * 触发，而不是更难。这不是构造出来的攻击输入——用户往一个节点里粘一段几千
 * 字符、夹杂大量星号/波浪线的文本（代码、数学记号、口语化的强调）就够得着。
 * 崩溃比原来的"卡死"更糟：那是一个未捕获异常，会在 `render()` 内部——同步
 * 渲染管线的核心路径上——直接抛出。
 *
 * 修法：给递归深度设一个远高于任何真实嵌套需求、又远低于任何危险栈深度的
 * 硬上限。真实的 Markdown 嵌套（`**a *b ~~c~~* d**` 这种）几乎不可能超过个位数
 * 层级，100 已经是极大的余量；一旦某个位置的递归深度达到这个上限，直接放弃
 * 为它打开新的标记尝试、把开启符当字面文本处理——不递归、不抛异常、不丢
 * 字符，只是那个位置往后不再尝试识别标记（真实文本几乎不会撞到这个上限，
 * 见 tests/inline.test.ts 里 `.repeat(2000)` 那条深度回归测试）。这只是加了
 * 一个提前退出条件，不改变现有的记忆化缓存/扫描逻辑，不是把算法换成
 * delimiter-stack scanner。
 */
const MAX_DEPTH = 100;

/**
 * 解析 `text[start..)` 直到遇到 `closer`（闭合并消费掉它）或扫到字符串末尾
 * （未闭合）。`closer` 为 `null` 表示顶层调用，解析到字符串末尾为止。
 * `depth` 是当前递归深度（顶层调用传 0），用于 `MAX_DEPTH` 兜底，见上面的
 * 说明；它不参与缓存 key——同一个 `(start, closer)` 不管在哪个深度被请求，
 * 只要缓存里已经有答案就直接复用。
 */
function parseSpan(
  text: string,
  start: number,
  closer: string | null,
  cache: SpanCache,
  depth: number,
): SpanResult {
  const key = spanCacheKey(start, closer);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

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

  const finish = (result: SpanResult): SpanResult => {
    cache.set(key, result);
    return result;
  };

  while (pos < len) {
    if (closer !== null && text.startsWith(closer, pos)) {
      flush();
      return finish({ tokens, end: pos + closer.length, closed: true });
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
      const inner = depth < MAX_DEPTH ? parseSpan(text, pos + 2, "**", cache, depth + 1) : null;
      if (inner !== null && inner.closed) {
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
      const inner = depth < MAX_DEPTH ? parseSpan(text, pos + 2, "~~", cache, depth + 1) : null;
      if (inner !== null && inner.closed) {
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
      const inner = depth < MAX_DEPTH ? parseSpan(text, pos + 1, "*", cache, depth + 1) : null;
      if (inner !== null && inner.closed) {
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
  return finish({ tokens, end: pos, closed: false });
}

export function parseInline(text: string): InlineToken[] {
  const cache: SpanCache = new Map();
  return parseSpan(text, 0, null, cache, 0).tokens;
}
