import { formatMarks } from "./marks";
import type { MindDoc, MindNode } from "./types";

/** 组合标记与文本，避免空文本时出现尾随空格。 */
function composeLine(node: MindNode): string {
  const marks = formatMarks(node.marks);
  if (marks === "") return node.text;
  if (node.text === "") return marks;
  return `${marks} ${node.text}`;
}

function serializeNodes(
  nodes: readonly MindNode[],
  depth: number,
  indentUnit: string,
): string {
  let out = "";
  for (const node of nodes) {
    // 用节点自己的 bullet 而不是固定的 `-`：`*`/`+` 同样是合法的 CommonMark
    // 列表标记，把它们改写成 `-` 会让一个只是被导图视图打开过的文件产生
    // 全量 diff（见 README「写回归一化」一节的承诺）。
    // indentUnit 是整份文档统一的一个值，不按节点分别记忆——缩进宽度永远是
    // unit × depth，因此一个节点被拖拽换到别的深度也能得到正确缩进。
    out += `${indentUnit.repeat(depth)}${node.bullet} ${composeLine(node)}\n`;
    for (const line of node.continuation) out += `${line}\n`;
    out += serializeNodes(node.children, depth + 1, indentUnit);
  }
  return out;
}

/** 把思维导图文档写回 Markdown。列表块之外的内容原样保留。 */
export function serialize(doc: MindDoc): string {
  let out = "";
  // 结束围栏后的尾随空白按原样重放：`---   ` 是合法的 frontmatter 结束行，
  // 抹掉它属于未经许可的写回归一化。
  if (doc.frontmatter !== null) {
    out += `---\n${doc.frontmatter}\n---${doc.frontmatterFenceSuffix}\n`;
  }
  out += doc.preamble;
  // 根节点的 marks 有意不写回：H1 标题行没有承载行内标记语法的位置，标记是
  // 列表项的概念。tree-ops 负责保证 root.marks 永远不会被设置；这里不做兜底
  // 判断，纯粹依赖上游不变量，因此绝不能给 H1 拼接 formatMarks(doc.root.marks)。
  // headingPrefix/headingSuffix 保留标题行原来的空白排布（`#   T`、`# T   `），
  // 同理不做归一化。
  if (doc.hasHeading) {
    out += `${doc.headingPrefix}${doc.root.text}${doc.headingSuffix}\n`;
  }
  out += doc.headingGap;
  out += serializeNodes(doc.root.children, 0, doc.indentUnit);
  out += doc.tail;
  return out;
}
