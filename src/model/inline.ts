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
 *
 * **诚实说明缓存与 `MAX_DEPTH` 的交互（这条边界不是无条件纯的）**：
 * `parseSpan` 本身只依赖 `text`/`start`/`closer`，但 `MAX_DEPTH` 兜底（见下面
 * 的常量注释）会让"某个位置能不能再往下开一层新标记"这件事额外依赖调用者
 * 当时的递归深度 `depth`。缓存 key 不包含 `depth`，所以一个 `(start, closer)`
 * 结果一旦被写入缓存，就固定了"当时那次调用的 depth 预算下算出的结果"，
 * 后续任何 `depth` 更浅的调用命中缓存时都会直接复用这个结果，即使换成更浅
 * 的 depth 重新算一遍可能会得到不同的答案（该位置本可以成功打开一层新标记，
 * 而不是像缓存里那样因为撞到 `MAX_DEPTH` 而被迫当字面文本处理）。换句话说，
 * "同一个 `(start, closer)` 结果必然相同"这个假设，只有在不考虑 `MAX_DEPTH`
 * 硬上限时才严格成立；加了深度兜底之后，它变成"结果由**第一个到达该位置的
 * 调用**的 depth 预算决定，此后被固定下来"。这个不精确不影响本文件的安全性
 * 结论（`MAX_DEPTH` 只会让结果更保守，不会丢字符/抛异常），但如果以后要把
 * `MAX_DEPTH` 从"硬退化为字面文本"换成别的语义（例如按 depth 分桶缓存），
 * 这条注释是必须先读的背景。
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
 * 修法：给递归深度设一个硬上限。一旦某个位置的递归深度达到这个上限，直接
 * 放弃为它打开新的标记尝试、把开启符当字面文本处理——不递归、不抛异常、不丢
 * 字符，只是那个位置往后不再尝试识别标记。这只是加了一个提前退出条件，不
 * 改变现有的记忆化缓存/扫描逻辑，不是把算法换成 delimiter-stack scanner。
 *
 * **上限具体定多少、为什么不是 100**：这个值不是"远高于真实嵌套需求"就够
 * 了——它同时决定了"输出在什么规模开始偏离无上限时的正确结果"，而这条边界
 * 比崩溃阈值近得多。对 `"**a*b~~c".repeat(n)` 这个病态族，实测（人工模拟 +
 * 用例核对）在 `MAX_DEPTH = 100` 时，输出从 n=35（280 字符）就开始与"无上限
 * 版本"的 token 树产生分歧——比 8000 字符左右才会触发栈溢出的危险区低了一个
 * 数量级还多，也就是说旧的 100 这个值本身就是一个会被真实长文本（例如从别处
 * 粘贴进节点的一段几百字符、夹杂标点符号的文字）撞到的"过于保守"的上限,
 * 而不是它注释曾经声称的"远高于真实嵌套需求"。1200 把这条分歧边界推到足够
 * 高的位置，同时仍与约 3000 深度起才不稳定、约 8000 字符触发崩溃的危险区
 * 保持 2 倍以上的余量。**这只是一个止血创可贴，不是根治**：真正的修法是把
 * `parseSpan` 这个per-position 的递归下降改写成显式栈（explicit-stack）的
 * 循环实现，彻底不受调用栈深度限制，也就不需要在"正确性"和"安全"之间做
 * 任何权衡；这个改写留作后续任务，记录于设计 spec 的「已知限制」一节。
 */
const MAX_DEPTH = 1200;

/**
 * 解析 `text[start..)` 直到遇到 `closer`（闭合并消费掉它）或扫到字符串末尾
 * （未闭合）。`closer` 为 `null` 表示顶层调用，解析到字符串末尾为止。
 * `depth` 是当前递归深度（顶层调用传 0），`maxDepth` 是 `MAX_DEPTH` 兜底的
 * 上限（生产路径固定传 `MAX_DEPTH`；`parseInlineWithDepth` 让测试可以传别的
 * 值，用来对照"上限收紧/放宽会不会改变输出"，见文件末尾）。二者都**不参与
 * 缓存 key**——`(start, closer)` 相同就命中缓存，不管请求方当时的 `depth`/
 * `maxDepth` 是什么。这意味着缓存住的结果实际上锁定的是"第一个到达该位置的
 * 调用所看到的 depth 预算"：如果后来有个 `depth` 更浅、或 `maxDepth` 更宽松
 * 的调用请求同一个 `(start, closer)`，即便重新算一遍可能得到不同结果（比如
 * 本可以成功打开一层新标记），也会直接拿到缓存里那个在更紧的预算下算出的
 * （更保守的）答案。详见 `SpanCache` 定义处的完整说明。**这也是为什么下面
 * 的结构化测试要用两次独立的 `parseInline`/`parseInlineWithDepth` 调用（各自
 * 一份新缓存）来对照，而不是在同一份缓存里混用不同 `maxDepth` 调用。**
 */
function parseSpan(
  text: string,
  start: number,
  closer: string | null,
  cache: SpanCache,
  depth: number,
  maxDepth: number,
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
      const inner = depth < maxDepth ? parseSpan(text, pos + 2, "**", cache, depth + 1, maxDepth) : null;
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
      const inner = depth < maxDepth ? parseSpan(text, pos + 2, "~~", cache, depth + 1, maxDepth) : null;
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
      const inner = depth < maxDepth ? parseSpan(text, pos + 1, "*", cache, depth + 1, maxDepth) : null;
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
  return parseInlineWithDepth(text, MAX_DEPTH);
}

/**
 * 仅供测试使用：允许传入自定义的深度上限，而不是生产路径固定的 `MAX_DEPTH`。
 * 用来验证"把上限调得足够宽（例如 1_000_000，等价于实际不受限）"与
 * `parseInline`（固定用 `MAX_DEPTH`）在真实输入规模下产出**完全相同**的
 * token 树——即 `MAX_DEPTH` 目前的取值不会让任何被测的真实场景发生退化，
 * 而不只是"没有抛异常/没有超时"这种弱得多的断言。见
 * tests/inline.test.ts「结构化输出」describe 块。
 */
export function parseInlineWithDepth(text: string, maxDepth: number): InlineToken[] {
  const cache: SpanCache = new Map();
  return parseSpan(text, 0, null, cache, 0, maxDepth).tokens;
}
