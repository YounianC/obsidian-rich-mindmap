import type { MindNode } from "./types";

const COLLAPSED_KEY = "mindmap-collapsed";
const MINDMAP_KEY = "mindmap";

/** 路径分隔符 `/` 与转义符 `\` 需要转义。 */
export function encodeSegment(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\//g, "\\/");
}

/** 节点 id → 路径（从根的子节点算起，根节点自身不产生路径）。 */
export function nodePaths(root: MindNode): Map<string, string> {
  const result = new Map<string, string>();

  const walk = (nodes: readonly MindNode[], prefix: string): void => {
    for (const node of nodes) {
      const path = prefix === ""
        ? encodeSegment(node.text)
        : `${prefix}/${encodeSegment(node.text)}`;
      result.set(node.id, path);
      walk(node.children, path);
    }
  };

  walk(root.children, "");
  return result;
}

/** 前序遍历收集已折叠节点的路径。 */
export function collectCollapsedPaths(root: MindNode): string[] {
  const paths = nodePaths(root);
  const result: string[] = [];

  const walk = (nodes: readonly MindNode[]): void => {
    for (const node of nodes) {
      if (node.collapsed) {
        const path = paths.get(node.id);
        if (path !== undefined) result.push(path);
      }
      walk(node.children);
    }
  };

  walk(root.children);
  return result;
}

/** 按路径集合施加折叠标记，返回新树。路径重复只命中第一个，失配静默忽略。 */
export function applyCollapsedPaths(
  root: MindNode,
  paths: readonly string[],
): MindNode {
  const wanted = new Set(paths);
  const used = new Set<string>();

  const rebuild = (node: MindNode, prefix: string, isRoot: boolean): MindNode => {
    const path = isRoot
      ? ""
      : prefix === ""
        ? encodeSegment(node.text)
        : `${prefix}/${encodeSegment(node.text)}`;

    const collapsed = !isRoot && wanted.has(path) && !used.has(path);
    if (collapsed) used.add(path);

    return {
      ...node,
      collapsed,
      children: node.children.map((child) => rebuild(child, path, false)),
    };
  };

  return rebuild(root, "", true);
}

/** frontmatter 按行切分，返回 [行数组] 便于逐键操作。 */
function toLines(frontmatter: string | null): string[] {
  return frontmatter === null || frontmatter === ""
    ? []
    : frontmatter.split("\n");
}

function fromLines(lines: readonly string[]): string | null {
  return lines.length === 0 ? null : lines.join("\n");
}

const KEY_LINE_RE = /^([A-Za-z0-9_-]+):/;

/** 定位某个顶层键覆盖的行区间 [start, end)；不存在时返回 null。 */
function findKeyRange(
  lines: readonly string[],
  key: string,
): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const match = KEY_LINE_RE.exec(lines[i]);
    if (match === null || match[1] !== key) continue;

    // A YAML key's block is the key line plus all following indented lines and internal blank lines.
    // We use indentation to detect the end, not key-like patterns, so non-ASCII keys (Chinese 名字:),
    // dotted keys (my.key:), and comments are correctly recognized as block boundaries and preserved.
    // Blank lines inside the block (e.g., between block-sequence items) are preserved; blank lines
    // followed by non-indented content belong to the separator, not the block.
    let end = i + 1;
    while (end < lines.length) {
      if (/^[ \t]/.test(lines[end])) {
        end++;
        continue;
      }
      if (lines[end].trim() === "") {
        // Empty line: belongs to this block only if indented content follows.
        // Otherwise, it's a separator between top-level keys and must be preserved.
        let j = end + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && /^[ \t]/.test(lines[j])) {
          end = j;
          continue;
        }
      }
      break;
    }
    return { start: i, end };
  }
  return null;
}

/** 读取折叠路径列表。兼容双引号块序列、裸标量块序列与空的流式 `[]`。 */
export function readCollapsed(frontmatter: string | null): string[] {
  const lines = toLines(frontmatter);
  const range = findKeyRange(lines, COLLAPSED_KEY);
  if (range === null) return [];

  const result: string[] = [];
  for (let i = range.start; i < range.end; i++) {
    const item = /^\s*-\s+(.*)$/.exec(lines[i]);
    if (item === null) continue;

    const raw = item[1].trim();
    if (raw.startsWith('"')) {
      try {
        result.push(JSON.parse(raw) as string);
      } catch {
        result.push(raw);
      }
    } else {
      result.push(raw);
    }
  }
  return result;
}

/** 用给定行块替换（或新增、删除）某个顶层键。 */
function replaceKey(
  frontmatter: string | null,
  key: string,
  block: readonly string[],
): string | null {
  const lines = toLines(frontmatter);
  const range = findKeyRange(lines, key);

  if (range === null) {
    return fromLines([...lines, ...block]);
  }
  return fromLines([
    ...lines.slice(0, range.start),
    ...block,
    ...lines.slice(range.end),
  ]);
}

/** 写入折叠路径列表；空列表时删除该键。 */
export function writeCollapsed(
  frontmatter: string | null,
  paths: readonly string[],
): string | null {
  const block = paths.length === 0
    ? []
    : [`${COLLAPSED_KEY}:`, ...paths.map((p) => `  - ${JSON.stringify(p)}`)];
  return replaceKey(frontmatter, COLLAPSED_KEY, block);
}

/** 写入 `mindmap: true|false`。结果一定非空，因此返回 string。 */
export function setMindmapFlag(
  frontmatter: string | null,
  value: boolean,
): string {
  const result = replaceKey(frontmatter, MINDMAP_KEY, [
    `${MINDMAP_KEY}: ${String(value)}`,
  ]);
  return result ?? `${MINDMAP_KEY}: ${String(value)}`;
}
