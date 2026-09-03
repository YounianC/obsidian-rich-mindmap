import { formatMarks } from "./marks";
import type { MindDoc, MindNode } from "./types";

const INDENT = "  ";

/** 组合标记与文本，避免空文本时出现尾随空格。 */
function composeLine(node: MindNode): string {
  const marks = formatMarks(node.marks);
  if (marks === "") return node.text;
  if (node.text === "") return marks;
  return `${marks} ${node.text}`;
}

function serializeNodes(nodes: readonly MindNode[], depth: number): string {
  let out = "";
  for (const node of nodes) {
    out += `${INDENT.repeat(depth)}- ${composeLine(node)}\n`;
    for (const line of node.continuation) out += `${line}\n`;
    out += serializeNodes(node.children, depth + 1);
  }
  return out;
}

/** 把思维导图文档写回 Markdown。列表块之外的内容原样保留。 */
export function serialize(doc: MindDoc): string {
  let out = "";
  if (doc.frontmatter !== null) out += `---\n${doc.frontmatter}\n---\n`;
  out += doc.preamble;
  if (doc.hasHeading) out += `# ${doc.root.text}\n`;
  out += doc.headingGap;
  out += serializeNodes(doc.root.children, 0);
  out += doc.tail;
  return out;
}
