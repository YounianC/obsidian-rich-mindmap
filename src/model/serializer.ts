import { formatMarks } from "./marks";
import { renderNote } from "./note";
import { isHeading, isOrdered, type MindDoc, type MindNode } from "./types";

/** 组合标记与文本，避免空文本时出现尾随空格。 */
function composeLine(node: MindNode): string {
  const marks = formatMarks(node.marks);
  if (marks === "") return node.text;
  if (node.text === "") return marks;
  return `${marks} ${node.text}`;
}

/**
 * 写出节点的备注行。`raw` 非 null 时逐字重放（保证往返字节相等）；用户编辑过
 * 备注（`raw === null`）时才按 `indent` 重新生成——缩进只有序列化期知道，
 * 这里是唯一该做这件事的地方。
 */
function serializeNote(node: MindNode, indent: string): string {
  if (node.note === undefined) return "";
  const lines = node.note.raw ?? renderNote(node.note.text, indent);
  let out = "";
  for (const line of lines) out += `${line}\n`;
  return out;
}

/**
 * 前序遍历写出子树。
 *
 * `listDepth` 是「从最近的标题祖先算起」的深度，不是树深度：一个 H3 下的一级
 * 列表项树深度是 3，而文件里的缩进是 0。标题节点把 listDepth 归零，并把自己
 * 记住的缩进单位传给子树；没有记住单位时沿用继承来的那个。
 */
function serializeNodes(
  nodes: readonly MindNode[],
  listDepth: number,
  indentUnit: string,
): string {
  let out = "";
  for (const node of nodes) {
    if (isHeading(node)) {
      // 逐字重放 prefix / suffix，**永不从 heading.level 重算 `#` 的个数**：
      // 层级归属规则与文件字节必须解耦，否则调整归属就会改写用户的文件。
      // 标记写在 `#` 之后、标题文字之前，与列表项同一套语法。
      out += `${node.heading.prefix}${composeLine(node)}${node.heading.suffix}\n`;
      // 标题行顶格，它的备注也顶格。
      out += serializeNote(node, "");
      for (const line of node.continuation) out += `${line}\n`;
      out += serializeNodes(node.children, 0, node.heading.indentUnit ?? indentUnit);
      continue;
    }
    // 用节点自己的标记而不是固定的 `-`：`*`/`+` 同样是合法的 CommonMark 列表
    // 标记，有序项的号与分隔符同理，把它们改写掉会让一个只是被导图视图打开过
    // 的文件产生全量 diff（见 README「写回归一化」一节的承诺）。序号**不从下标
    // 重算**，重算就是第六条未获许可的归一化——它只在 tree-ops 的结构变更里
    // 经 renumber 改变。
    const marker = isOrdered(node)
      ? `${node.ordered.number}${node.ordered.delim}`
      : node.bullet;
    out += `${indentUnit.repeat(listDepth)}${marker} ${composeLine(node)}\n`;
    // 比节点自己深一层，备注才落在这个列表项内部而不是掉出列表。
    out += serializeNote(node, indentUnit.repeat(listDepth + 1));
    for (const line of node.continuation) out += `${line}\n`;
    out += serializeNodes(node.children, listDepth + 1, indentUnit);
  }
  return out;
}

/** 把思维导图文档写回 Markdown。节点行之外的内容原样保留。 */
export function serialize(doc: MindDoc): string {
  let out = "";
  // 结束围栏后的尾随空白按原样重放：`---   ` 是合法的 frontmatter 结束行，
  // 抹掉它属于未经许可的写回归一化。
  if (doc.frontmatter !== null) {
    out += `---\n${doc.frontmatter}\n---${doc.frontmatterFenceSuffix}\n`;
  }
  out += doc.preamble;
  // 根节点的标题行：prefix/suffix 保留原来的空白排布（`#   T`、`# T   `），
  // 不做归一化。hasHeading 为假时文件里没有 H1 行，不写；此时 parse 保证
  // root.continuation 为空，所以下面那圈循环不会写出孤立的行。
  const rootIndentUnit = doc.root.heading?.indentUnit ?? doc.indentUnit;
  if (doc.hasHeading && isHeading(doc.root)) {
    // 根节点的 marks 有意不写：hasHeading 为假时根本没有 H1 行可写，标记会
    // 静默丢失。tree-ops.setMarks / toggleMark 对根 id 是 no-op 来保证这一点，
    // 所以这里直接写 root.text，不走 composeLine。
    // 根节点没有备注：parse 不对根做 splitNote，setNote 对根 id 是 no-op，
    // 所以这里不需要 serializeNote。
    out += `${doc.root.heading.prefix}${doc.root.text}${doc.root.heading.suffix}\n`;
    for (const line of doc.root.continuation) out += `${line}\n`;
  }
  out += serializeNodes(doc.root.children, 0, rootIndentUnit);
  return out;
}
