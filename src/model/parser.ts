import { parseMarks } from "./marks";
import type { MindDoc, MindNode } from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const HEADING_RE = /^#[ \t]+(.*)$/;
const ANY_HEADING_RE = /^#{1,6}[ \t]/;
const LIST_ITEM_RE = /^([ \t]*)[-*+][ \t]+(.*)$/;
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
  depthWidth: number;
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
        depthWidth: indentWidth(item[1]),
        text: item[2],
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
  let rest = md;
  let frontmatter: string | null = null;

  const fm = FRONTMATTER_RE.exec(rest);
  if (fm) {
    frontmatter = fm[1];
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
  const rootText = hasHeading
    ? (HEADING_RE.exec(lines[headingIndex]) as RegExpExecArray)[1].trim()
    : fileName.replace(/\.md$/, "");
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
  };

  if (blockStart < 0) {
    return {
      frontmatter,
      hasHeading,
      root,
      preamble,
      headingGap: "",
      tail: sliceText(lines, searchFrom, lines.length),
    };
  }

  const { items, end } = scanListBlock(lines, blockStart);
  buildTree(items, root);

  return {
    frontmatter,
    hasHeading,
    root,
    preamble,
    headingGap: sliceText(lines, searchFrom, blockStart),
    tail: sliceText(lines, end, lines.length),
  };
}
