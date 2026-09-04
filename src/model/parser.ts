import { parseMarks } from "./marks";
import type { Bullet, MindDoc, MindNode } from "./types";

/** 第 2 组捕获结束围栏 `---` 之后的尾随空白，写回时原样重放。 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---([ \t]*)(?:\r?\n|$)/;
/** 第 1 组是 `#` 加其后的原始空白，第 2 组是标题行剩余部分（含尾随空白）。 */
const HEADING_RE = /^(#[ \t]+)(.*)$/;
const TRAILING_BLANK_RE = /[ \t]*$/;
const ANY_HEADING_RE = /^#{1,6}[ \t]/;
const LIST_ITEM_RE = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const ORDERED_ITEM_RE = /^[ \t]*\d+\.[ \t]/;
const FENCE_RE = /^[ \t]*(?:```|~~~)/;

/**
 * 按行区间取回原始文本。末尾统一补换行，因此不以换行结尾的文件在写回时
 * 会被补上一个尾换行 —— 这是唯一的已知归一化，无害且符合 Obsidian 惯例。
 */
function sliceText(lines: string[], from: number, to: number): string {
  const seg = lines.slice(from, to);
  // 区间延伸到文件末尾时，最后那个空串是文件尾换行的产物，不是真实空行。
  if (to >= lines.length && seg[seg.length - 1] === "") seg.pop();
  return seg.map((line) => line + "\n").join("");
}

/** Tab 按 4 空格计宽。 */
function indentWidth(indent: string): number {
  let width = 0;
  for (const ch of indent) width += ch === "\t" ? 4 : 1;
  return width;
}

interface ListItemLine {
  /** 原始缩进字符串，逐字保留（tab 与空格不折算），供 detectIndentUnitString 使用。 */
  indent: string;
  depthWidth: number;
  bullet: Bullet;
  text: string;
  continuation: string[];
}

/** 扫描列表块，返回条目与块结束的行号（不含）。 */
function scanListBlock(
  lines: string[],
  start: number,
): { items: ListItemLine[]; end: number } {
  const items: ListItemLine[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (ANY_HEADING_RE.test(line) || ORDERED_ITEM_RE.test(line) || FENCE_RE.test(line)) {
      break;
    }

    if (line.trim() === "") {
      // 空行：向前找第一个非空行，若不是列表项则块结束。
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length || !LIST_ITEM_RE.test(lines[j])) break;
      i = j;
      continue;
    }

    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      items.push({
        indent: item[1],
        depthWidth: indentWidth(item[1]),
        // 正则第 2 组只可能匹配到 `-`/`*`/`+` 三者之一，这里的断言是把这一点
        // 从正则转达给类型系统，不是运行时判断。
        bullet: item[2] as Bullet,
        text: item[3],
        continuation: [],
      });
      i++;
      continue;
    }

    // 缩进的非列表行：归为上一条目的续行。
    if (/^[ \t]/.test(line) && items.length > 0) {
      items[items.length - 1].continuation.push(line);
      i++;
      continue;
    }

    break;
  }

  return { items, end: i };
}

/** 从条目的缩进宽度推断缩进单位；没有缩进层级时返回 2。 */
function detectIndentUnit(items: ListItemLine[]): number {
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
 * `候选单位.repeat(k)`（k 为非负整数）。只要有一个条目对不上（例如整份文件
 * 混用了 tab 和空格，或缩进宽度不是候选单位的整数倍），就说明这份文件没有
 * 单一一致的缩进单位，写回时无法保真，退回两空格兜底。
 *
 * 没有任何条目比基准更深（没有缩进层级）时同样返回两空格兜底。
 */
function detectIndentUnitString(items: ListItemLine[]): string {
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

/** 按缩进宽度把扁平条目组装成树，缩进跳跃时挂到最近合法父节点。 */
function buildTree(items: ListItemLine[], root: MindNode): void {
  const unit = detectIndentUnit(items);
  const base = items.length > 0 ? items[0].depthWidth : 0;
  let nextId = 1;
  /** stack[d] 是深度 d 的最近节点，root 位于 stack[0]。 */
  const stack: MindNode[] = [root];

  for (const item of items) {
    const raw = Math.round((item.depthWidth - base) / unit) + 1;
    const depth = Math.max(1, Math.min(raw, stack.length));
    const { marks, rest } = parseMarks(item.text);

    const node: MindNode = {
      id: `n${nextId++}`,
      text: rest,
      marks,
      children: [],
      collapsed: false,
      continuation: item.continuation,
      bullet: item.bullet,
    };

    stack[depth - 1].children.push(node);
    stack.length = depth;
    stack.push(node);
  }
}

/**
 * 把 Markdown 解析为思维导图文档。
 * 列表块之外的一切内容（frontmatter、前言、尾块）原样保留。
 */
export function parse(md: string, fileName: string): MindDoc {
  // CRLF → LF：仅归一化真正的行尾序列，不触碰孤立的 \r（旧版 Mac 换行符或文本中的
  // 杂散字符）。归一化后 frontmatter/preamble/headingGap/tail 全部为 LF，写回时
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

  // 定位一级标题。
  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      headingIndex = i;
      break;
    }
  }

  const hasHeading = headingIndex >= 0;
  // 标题行的 `#` 与文字之间、以及文字之后的空白都逐字保留：否则 `#   T` /
  // `# T   ` 这类完全合法的写法会仅仅因为被导图视图打开过一次就被改写。
  const heading = hasHeading
    ? (HEADING_RE.exec(lines[headingIndex]) as RegExpExecArray)
    : null;
  const headingBody = heading === null ? "" : heading[2];
  const headingSuffix =
    heading === null ? "" : (TRAILING_BLANK_RE.exec(headingBody) as RegExpExecArray)[0];
  const rootText =
    heading === null
      ? fileName.replace(/\.md$/, "")
      : headingBody.slice(0, headingBody.length - headingSuffix.length);
  const headingPrefix = heading === null ? "# " : heading[1];
  const preamble = sliceText(lines, 0, hasHeading ? headingIndex : 0);

  // 定位列表块起点。
  const searchFrom = hasHeading ? headingIndex + 1 : 0;
  let blockStart = -1;
  for (let i = searchFrom; i < lines.length; i++) {
    if (LIST_ITEM_RE.test(lines[i])) {
      blockStart = i;
      break;
    }
    if (ANY_HEADING_RE.test(lines[i]) || FENCE_RE.test(lines[i])) break;
  }

  const root: MindNode = {
    id: "n0",
    text: rootText,
    marks: {},
    children: [],
    collapsed: false,
    continuation: [],
    // 根节点自身没有列表行；这里存的是「文件里第一个列表项用的标记字符」，
    // 供 tree-ops 给根的新直接子节点挑一个和现有兄弟一致的标记（见 makeNode）。
    bullet: "-",
  };

  if (blockStart < 0) {
    return {
      indentUnit: "  ",
      frontmatter,
      frontmatterFenceSuffix,
      hasHeading,
      headingPrefix,
      headingSuffix,
      root,
      preamble,
      headingGap: "",
      tail: sliceText(lines, searchFrom, lines.length),
    };
  }

  const { items, end } = scanListBlock(lines, blockStart);
  const firstBullet = items[0]?.bullet;
  if (firstBullet !== undefined) root.bullet = firstBullet;
  buildTree(items, root);
  // 没有一级标题时不推断真实缩进单位，直接兜底两空格：这种文件里的列表
  // 块脱离了标题上下文，属于本插件不主动优化的边缘情形（见 MindDoc.indentUnit）。
  const indentUnit = hasHeading ? detectIndentUnitString(items) : "  ";

  return {
    indentUnit,
    frontmatter,
    frontmatterFenceSuffix,
    hasHeading,
    headingPrefix,
    headingSuffix,
    root,
    preamble,
    headingGap: sliceText(lines, searchFrom, blockStart),
    tail: sliceText(lines, end, lines.length),
  };
}
