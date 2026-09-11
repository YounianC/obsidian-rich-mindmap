import { parseMarks } from "./marks";
import { splitNote } from "./note";
import type { Bullet, MindDoc, MindNode, OrderedForm } from "./types";

/** 第 2 组捕获结束围栏 `---` 之后的尾随空白，写回时原样重放。 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---([ \t]*)(?:\r?\n|$)/;
/**
 * 顶格的 ATX 标题。第 1 组是 `#` 加其后的原始空白，第 2 组是剩余部分（含尾随空白）。
 *
 * 要求 `#` 与文字之间有空白，是 `#tag` 不被误判成标题的原因；要求顶格（`^#`，
 * 不允许前导空格），是列表续行里的 `  ## x` 不被误判成标题的原因。两者都是
 * 刻意的，代价是不认 CommonMark 允许的最多 3 个前导空格的缩进标题。
 */
const HEADING_RE = /^(#{1,6}[ \t]+)(.*)$/;
const TRAILING_BLANK_RE = /[ \t]*$/;
const LIST_ITEM_RE = /^([ \t]*)([-*+])[ \t]+(.*)$/;
/**
 * 有序列表项。第 2 组是序号（CommonMark 上限 9 位），第 3 组是分隔符。
 *
 * 与 `LIST_ITEM_RE` 一样要求标记与文字之间有空白，所以 `1.x` 不是列表项；
 * 位数上限让 `1234567890. x` 这类长数字开头的散文行不被误判（正则回溯时
 * `[.)]` 永远对不上数字，整条匹配失败）。
 */
const ORDERED_ITEM_RE = /^([ \t]*)(\d{1,9})([.)])[ \t]+(.*)$/;
/** 开围栏允许带信息串（```js）；闭围栏不允许（见 closesFence）。 */
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/** Tab 按 4 空格计宽。 */
function indentWidth(indent: string): number {
  let width = 0;
  for (const ch of indent) width += ch === "\t" ? 4 : 1;
  return width;
}

interface ItemMatch {
  indent: string;
  bullet: Bullet;
  ordered: OrderedForm | null;
  text: string;
}

/**
 * 把一行识别成列表项（无序或有序），不是列表项时返回 null。
 *
 * 两条正则的首个有效字符不可能相同（`-*+` 与数字），所以试的顺序无关紧要。
 */
function matchItem(line: string): ItemMatch | null {
  const unordered = LIST_ITEM_RE.exec(line);
  if (unordered !== null) {
    return {
      indent: unordered[1],
      // 正则第 2 组只可能匹配到 `-`/`*`/`+` 三者之一，这里的断言是把这一点从
      // 正则转达给类型系统，不是运行时判断。
      bullet: unordered[2] as Bullet,
      ordered: null,
      text: unordered[3],
    };
  }

  const ordered = ORDERED_ITEM_RE.exec(line);
  if (ordered === null) return null;
  return {
    indent: ordered[1],
    // 有序项的 bullet 是死字段（serialize 只在 ordered 缺席时读它），填入与
    // parser 各处一致的占位值。
    bullet: "-",
    ordered: {
      number: Number(ordered[2]),
      // 同上，第 3 组只可能是 `.` 或 `)`。
      delim: ordered[3] as OrderedForm["delim"],
    },
    text: ordered[4],
  };
}

interface HeadingEntry {
  kind: "heading";
  level: number;
  prefix: string;
  text: string;
  suffix: string;
  continuation: string[];
}

interface ItemEntry {
  kind: "item";
  /** 原始缩进字符串，逐字保留（tab 与空格不折算），供 detectIndentUnitString 使用。 */
  indent: string;
  depthWidth: number;
  bullet: Bullet;
  /** 有序项的号与分隔符；无序项为 null */
  ordered: OrderedForm | null;
  text: string;
  continuation: string[];
}

type ScanEntry = HeadingEntry | ItemEntry;

/** 判断一行是否闭合当前围栏：同字符、长度不小于开围栏、且行内无其他内容。 */
function closesFence(line: string, marker: string): boolean {
  const match = FENCE_CLOSE_RE.exec(line);
  if (match === null) return false;
  return match[1][0] === marker[0] && match[1].length >= marker.length;
}

/**
 * 对正文（已剥掉 frontmatter）做一次线性扫描，切成标题条目与列表项条目。
 *
 * 非节点行（散文、表格、围栏、缩进续行）一律落进「当前条目」的
 * continuation；还没有任何条目时落进 preamble。
 *
 * 围栏状态机是必需的：改造前遇到围栏就终止扫描，所以代码块里的 `## 假标题`
 * 从来不构成威胁；现在扫描不再终止，围栏内的行必须绝不产生节点。
 */
function scanDocument(lines: string[]): { entries: ScanEntry[]; preamble: string[] } {
  const entries: ScanEntry[] = [];
  const preamble: string[] = [];
  let fenceMarker: string | null = null;

  // 文件以换行结尾时 split 产生的末尾空串不是真实空行，不参与扫描。
  // 不以换行结尾的文件因此会在写回时补上尾换行——这是归一化第 1 条。
  const end =
    lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

  const sink = (line: string): void => {
    if (entries.length === 0) preamble.push(line);
    else entries[entries.length - 1].continuation.push(line);
  };

  let i = 0;
  while (i < end) {
    const line = lines[i];

    if (fenceMarker !== null) {
      sink(line);
      if (closesFence(line, fenceMarker)) fenceMarker = null;
      i++;
      continue;
    }

    const fence = FENCE_OPEN_RE.exec(line);
    if (fence !== null) {
      sink(line);
      fenceMarker = fence[1];
      i++;
      continue;
    }

    if (line.trim() === "") {
      let j = i + 1;
      while (j < end && lines[j].trim() === "") j++;
      // 归一化第 2 条：两个列表项之间的空行被丢弃（松散列表压缩成紧凑列表）。
      //
      // 三个条件都是必需的：
      // - 前一个条目是列表项——`# t` 与 `- a` 之间那个空行是标题节点的
      //   continuation，丢了就产生未获许可的字节差异；
      // - 前一个条目**还没有吸收任何 continuation**——列表项条目会持续吸收
      //   续行，所以「上一个条目是列表项」不等于「上一行是列表项行」。少了
      //   这一条，`- a` / 空行 / 散文 / 空行 / `- c` 里第二个空行会被当成松散
      //   列表的填充丢掉，而它分隔的是段落与列表，不是一个松散列表的两个项
      //   ——那是第六条未获许可的归一化，且相对改造前（这些形态整段留在文件
      //   末尾原样保留）是字节保真的倒退；
      // - 空行之后紧跟的确实是列表项。
      //
      // 代价是 `- a` / `  续行` / 空行 / `- b` 里那个空行现在被保留，而改造前
      // 是丢弃的。这是刻意的选择：归一化越少越好，而第 2 条的措辞是「项之间
      // 夹空行」，指的是直接夹在两个项之间的空行。
      const previous = entries[entries.length - 1];
      const following = j < end ? matchItem(lines[j]) : null;
      if (
        following !== null &&
        previous !== undefined &&
        previous.kind === "item" &&
        previous.continuation.length === 0 &&
        // 第四个条件（同类守卫）：空行两侧必须是**同一个列表**。CommonMark 里
        // 无序与有序是两个列表，有序之间换分隔符（`1.` → `1)`）同样开一个新
        // 列表，压缩它们之间的空行既没有必要，又会在今天逐字节保真的文件
        // （`- a` / 空行 / `1. x`，`1. a` / 空行 / `1) x`）上凭空产生差异
        // ——那是第六条未获许可的归一化。少了这一条，CORPUS 里的
        // `"# t\n\n- a\n1. 步骤\n\n- b\n"` 立刻变红。
        //
        // 刻意**不**比较无序的标记字符：CommonMark 认为 `- a` 与 `* b` 也是两个
        // 列表，但「`- a` / 空行 / `* b` 被压缩」是改造前就有的行为，收紧它属于
        // 本次改动之外的范围。这里只堵住本次新开的口子。
        (previous.ordered?.delim ?? null) === (following.ordered?.delim ?? null)
      ) {
        i = j;
        continue;
      }
      for (let k = i; k < j; k++) sink(lines[k]);
      i = j;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const body = heading[2];
      const suffix = (TRAILING_BLANK_RE.exec(body) as RegExpExecArray)[0];
      entries.push({
        kind: "heading",
        level: heading[1].replace(/[ \t]+$/, "").length,
        prefix: heading[1],
        text: body.slice(0, body.length - suffix.length),
        suffix,
        continuation: [],
      });
      i++;
      continue;
    }

    const item = matchItem(line);
    if (item !== null) {
      entries.push({
        kind: "item",
        indent: item.indent,
        depthWidth: indentWidth(item.indent),
        bullet: item.bullet,
        ordered: item.ordered,
        text: item.text,
        continuation: [],
      });
      i++;
      continue;
    }

    sink(line);
    i++;
  }

  return { entries, preamble };
}

/** 从条目的缩进宽度推断缩进单位；没有缩进层级时返回 2。 */
function detectIndentUnit(items: readonly ItemEntry[]): number {
  const base = items.length > 0 ? items[0].depthWidth : 0;
  for (const item of items) {
    const delta = item.depthWidth - base;
    if (delta > 0) return delta;
  }
  return 2;
}

/**
 * 推断写回列表缩进时使用的字面单位字符串（如 `"  "`、`"\t"`、`"    "`）。
 *
 * 取块内第一个比基准缩进（items[0] 的缩进）更深的条目，把它的原始缩进字符串
 * 减去基准缩进的长度，得到候选单位。随后校验这个单位能否*逐字符*、一致地
 * 解释块内每一个条目的缩进——即每个条目的缩进都必须恰好等于
 * `候选单位.repeat(k)`（k 为非负整数）。只要有一个条目对不上（例如这个块
 * 混用了 tab 和空格，或缩进宽度不是候选单位的整数倍），就说明它没有单一
 * 一致的缩进单位，写回时无法保真，退回两空格兜底。
 *
 * 没有任何条目比基准更深（没有缩进层级）时同样返回两空格兜底。
 */
function detectIndentUnitString(items: readonly ItemEntry[]): string {
  if (items.length === 0) return "  ";
  const baseLen = items[0].indent.length;
  const deeper = items.find((item) => item.indent.length > baseLen);
  if (deeper === undefined) return "  ";
  const unit = deeper.indent.slice(baseLen);
  if (unit === "") return "  ";
  for (const item of items) {
    const suffix = item.indent.slice(baseLen);
    if (suffix.length % unit.length !== 0) return "  ";
    if (unit.repeat(suffix.length / unit.length) !== suffix) return "  ";
  }
  return unit;
}

/** entries 里连续的列表项条目构成一个块。块内缩进基准取块首项。 */
function itemBlocks(entries: readonly ScanEntry[]): ItemEntry[][] {
  const blocks: ItemEntry[][] = [];
  let current: ItemEntry[] | null = null;
  for (const entry of entries) {
    if (entry.kind === "item") {
      if (current === null) {
        current = [];
        blocks.push(current);
      }
      current.push(entry);
    } else {
      current = null;
    }
  }
  return blocks;
}

/**
 * 按文档顺序把扁平条目组装成树。
 *
 * 标题栈决定标题的归属：level 为 L 的标题挂到栈里最近的 level < L 的标题下，
 * 找不到就挂到根下。因此跳级（H1→H3）、第二个 H1、无 H1 以 H2 开头三种情形
 * 都有确定行为，且树深度与标题 level 不再严格对应——这不构成问题，序列化
 * 重放 prefix，不从 level 重算 `#`。
 *
 * 列表项挂到最近的标题节点下，块内相对深度按该块首项的缩进为基准逐块计算。
 * 每个块的字面缩进单位写进它所属标题的 `heading.indentUnit`；一个标题下可能
 * 有多个被散文隔开的列表块，而槽位只有一个，规则是**取第一个能推断出单位的
 * 块**，后续块按这个单位重新缩进（落在归一化第 4 条里）。
 *
 * 这里就地改写 `owner.heading.indentUnit` 与 `parent.children`。解析期正在
 * 构造这棵树，此刻还没有任何外部持有者，就地写入不违反不可变约定——
 * `tree-ops` 的不可变要求约束的是**编辑操作**，不是解析期的构造。
 *
 * id 按文档顺序分配，等于前序，与 AGENTS.md 第 4 条一致。
 */
function buildTree(entries: readonly ScanEntry[], root: MindNode): void {
  const blockOf = new Map<ItemEntry, ItemEntry[]>();
  for (const block of itemBlocks(entries)) {
    for (const item of block) blockOf.set(item, block);
  }

  let nextId = 1;
  /** headingStack[0] 恒为根节点。根的 level 视为 1。 */
  const headingStack: { node: MindNode; level: number }[] = [{ node: root, level: 1 }];
  /** 当前列表块的栈，listStack[d] 是块内深度 d 的最近节点；遇到标题即清空。 */
  let listStack: MindNode[] = [];
  let base = 0;
  let unit = 2;

  for (const entry of entries) {
    if (entry.kind === "heading") {
      while (
        headingStack.length > 1 &&
        headingStack[headingStack.length - 1].level >= entry.level
      ) {
        headingStack.pop();
      }
      const parent = headingStack[headingStack.length - 1].node;
      // 标题文字同样解析行内标记：`## (p1) A` 的 `(p1)` 是标记，不是文字。
      // 代价是标记会漏到插件之外——大纲面板、`[[笔记#标题]]` 引用、搜索结果里
      // 都会带上 `(p1)`，且给标题打标会让已有的标题引用失效。这是已知并接受的
      // 取舍（见 README「行内标记」一节）。根节点例外，见 tree-ops.setMarks。
      const headingMarks = parseMarks(entry.text);
      const headingNote = splitNote(entry.continuation);
      const node: MindNode = {
        id: `n${nextId++}`,
        text: headingMarks.rest,
        marks: headingMarks.marks,
        children: [],
        collapsed: false,
        continuation: headingNote.rest,
        bullet: "-",
        heading: {
          level: entry.level,
          prefix: entry.prefix,
          suffix: entry.suffix,
          indentUnit: null,
        },
      };
      // 只在有备注时挂字段：`note: null` 与「没有备注」是两种状态，让不带备注的
      // 节点根本不出现这个键，结构比较与 JSON 快照都更干净。
      if (headingNote.note !== null) node.note = headingNote.note;
      parent.children.push(node);
      headingStack.push({ node, level: entry.level });
      listStack = [];
      continue;
    }

    const block = blockOf.get(entry);
    if (listStack.length === 0) {
      const owner = headingStack[headingStack.length - 1].node;
      listStack = [owner];
      base = block === undefined ? entry.depthWidth : block[0].depthWidth;
      unit = block === undefined ? 2 : detectIndentUnit(block);
      if (
        owner.heading !== undefined &&
        owner.heading.indentUnit === null &&
        block !== undefined
      ) {
        owner.heading.indentUnit = detectIndentUnitString(block);
      }
    }

    const raw = Math.round((entry.depthWidth - base) / unit) + 1;
    const depth = Math.max(1, Math.min(raw, listStack.length));
    const { marks, rest } = parseMarks(entry.text);
    const itemNote = splitNote(entry.continuation);

    const node: MindNode = {
      id: `n${nextId++}`,
      text: rest,
      marks,
      children: [],
      collapsed: false,
      continuation: itemNote.rest,
      bullet: entry.bullet,
    };
    // 只在有序时挂字段：`ordered: null` 与「不是有序项」是两种状态，让无序节点
    // 根本不出现这个键，结构比较与 JSON 快照都更干净（与 note 同一条规则）。
    if (entry.ordered !== null) node.ordered = { ...entry.ordered };
    if (itemNote.note !== null) node.note = itemNote.note;

    listStack[depth - 1].children.push(node);
    listStack.length = depth;
    listStack.push(node);
  }
}

/**
 * 把 Markdown 解析为思维导图文档。
 * 节点行之外的一切内容（frontmatter、前言、散文、表格、围栏、续行）
 * 原样保留在 preamble 或某个节点的 continuation 里。
 */
export function parse(md: string, fileName: string): MindDoc {
  // CRLF → LF：仅归一化真正的行尾序列，不触碰孤立的 \r（旧版 Mac 换行符或文本中的
  // 杂散字符）。归一化后 frontmatter/preamble/continuation 全部为 LF，写回时
  // 输出统一的行尾，不会产生混合换行符的文件。
  let rest = md.replace(/\r\n/g, "\n");
  let frontmatter: string | null = null;
  let frontmatterFenceSuffix = "";

  const fm = FRONTMATTER_RE.exec(rest);
  if (fm) {
    frontmatter = fm[1];
    frontmatterFenceSuffix = fm[2];
    rest = rest.slice(fm[0].length);
  }

  const lines = rest.split("\n");
  const { entries, preamble } = scanDocument(lines);

  // 只有当文件的第一个节点行就是一个 H1 时，它才充当根节点。第一个节点行是
  // 列表项、或是 H2+ 时，根节点是文件名的虚拟节点（hasHeading = false），
  // 那个 H2 成为它的子节点——这正是「文件里出现 ## 就只剩空根」的修复路径。
  //
  // 先取局部 const 再判别：TS 不会从 `entries[0]?.kind === "heading"` 这种
  // 元素访问上收窄 `entries[0]` 的类型。下面 `hasHeading ? rootEntry.text : …`
  // 能通过收窄，靠的是两者都是 const（TS 4.4+ 的 aliased condition）。
  const first = entries[0];
  const rootEntry =
    first !== undefined && first.kind === "heading" && first.level === 1 ? first : null;
  const hasHeading = rootEntry !== null;
  const bodyEntries = hasHeading ? entries.slice(1) : entries;

  // MindDoc.indentUnit 是兜底值，只在整条标题祖先链都没有单位时被 serialize
  // 用到。取文档里第一个列表块的单位。
  const firstBlock = itemBlocks(bodyEntries)[0];
  const indentUnit = firstBlock === undefined ? "  " : detectIndentUnitString(firstBlock);

  const firstItem = entries.find((e): e is ItemEntry => e.kind === "item");

  const root: MindNode = {
    id: "n0",
    text: hasHeading ? rootEntry.text : fileName.replace(/\.md$/, ""),
    marks: {},
    children: [],
    collapsed: false,
    // 根节点不做 splitNote：根不支持备注（tree-ops.setNote 对根 id 是 no-op，
    // 理由与 setMarks 相同），若解析期仍把根下面的引用块收成备注，导图上会出现
    // 一个点不动的角标。与「parse 不对根的 H1 调 parseMarks」逐字对称。
    continuation: hasHeading ? rootEntry.continuation : [],
    // 根节点自身没有列表行；这里存的是「文件里第一个列表项用的标记字符」，
    // 供 tree-ops 给根的新直接子节点挑一个和现有兄弟一致的标记（见 makeNode）。
    bullet: firstItem?.bullet ?? "-",
    heading: {
      level: 1,
      prefix: hasHeading ? rootEntry.prefix : "# ",
      suffix: hasHeading ? rootEntry.suffix : "",
      // 由 buildTree 统一填（根就是 headingStack[0]）。不在这里抢先填「文档第
      // 一个块」的值：那与「取本标题名下第一个块」的规则不一致——根名下可能
      // 根本没有列表块（例如 `# t` 紧跟 `## A`，所有列表都在 A 名下）。
      indentUnit: null,
    },
  };

  // 与 bullet 完全对称：根节点没有自己的列表行，这里存的是「文件里第一个列表项
  // 的形态」，供 tree-ops 给根的新直接子节点挑一个与现有兄弟一致的标记。
  // 因此 isOrdered(root) 可能为真而根并不是有序列表项——安全性来自 serialize 的
  // 结构：根走 doc.root.heading.prefix 那条独立分支，永远不进 serializeNodes。
  if (firstItem?.ordered != null) root.ordered = { ...firstItem.ordered };

  buildTree(bodyEntries, root);

  return {
    indentUnit,
    frontmatter,
    frontmatterFenceSuffix,
    hasHeading,
    root,
    preamble: preamble.map((line) => line + "\n").join(""),
  };
}
