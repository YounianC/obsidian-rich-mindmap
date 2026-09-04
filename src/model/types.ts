export type FlagColor =
  | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

/** 节点上的行内标记。三类各自可选，最多一个。 */
export interface Marks {
  /** 优先级 1–7 */
  priority?: number;
  /** 进度百分比 0–100，保留用户/AI 写入的原值 */
  progress?: number;
  flag?: FlagColor;
}

/** 无序列表标记字符。CommonMark 允许三种，写回时按原样保留。 */
export type Bullet = "-" | "*" | "+";

/**
 * 标题节点的来源形态。
 *
 * `serialize` 只读 `prefix` / `suffix`，**绝不从 `level` 重算 `#` 的个数**。
 * 任何形如 `"#".repeat(level)` 的代码都是缺陷：层级归属规则（哪个标题挂在谁
 * 名下）与文件字节必须保持解耦，否则调整归属规则就会改写用户的文件。
 */
export interface HeadingForm {
  /** 1–6。仅解析期用于层级归属计算，序列化不读它 */
  level: number;
  /** `#` 到文字之间的原始前缀（含 `#` 本身），例如 `"## "`、`"###   "` */
  prefix: string;
  /** 文字之后的原始尾随空白 */
  suffix: string;
  /** 该标题名下直接列表块的缩进单位；名下没有列表块时为 null，
   *  序列化时向上继承最近有值的标题祖先（见 serializer.ts）。 */
  indentUnit: string | null;
}

export interface MindNode {
  /** 会话内稳定的唯一 id，由 parser/tree-ops 生成，不写入文件 */
  id: string;
  /** 去掉行内标记后的节点文本，保留 Markdown 行内语法 */
  text: string;
  marks: Marks;
  children: MindNode[];
  collapsed: boolean;
  /** 列表项内部的续行，原样保留（不含首行） */
  continuation: string[];
  /** 该节点在文件里用的列表标记字符，写回时原样重新写出，避免把 `* a` 改成 `- a`。
   *  根节点没有列表行，它的取值只作为「新建根的直接子节点时用哪个字符」的来源，
   *  由 parser 取自文件里第一个列表项（没有列表项时为 `-`）。 */
  bullet: Bullet;
  /** 存在即为标题节点，不存在即为列表项。
   *
   *  根节点**恒有**此字段，包括文件没有 H1、根文字取自文件名的情形（那时由
   *  `MindDoc.hasHeading` 为 false 决定序列化不写出标题行）。若虚拟根不带
   *  heading，`isHeading(root)` 就是 false，根既不是标题也不是列表项，标题
   *  节点的各条约束（不可删、不可拖、不带标记）会从根身上漏掉。 */
  heading?: HeadingForm;
}

/** 判别节点形态的唯一入口。不要散落 `node.heading !== undefined`。 */
export function isHeading(
  node: MindNode,
): node is MindNode & { heading: HeadingForm } {
  return node.heading !== undefined;
}

export interface MindDoc {
  /** 缩进单位的**兜底值**，只在整条标题祖先链的 `HeadingForm.indentUnit` 都为
   *  null 时被 `serialize` 用到。真正生效的是标题节点各自记住的单位——这样
   *  「`## A` 下用 2 空格、`## B` 下用 4 空格」的文件不会被全文改写。
   *  由 parser 取自文档里第一个列表块；没有列表块时为 `"  "`。 */
  indentUnit: string;
  /** frontmatter 原始文本，不含 --- 分隔符；无 frontmatter 时为 null */
  frontmatter: string | null;
  /** frontmatter 结束围栏 `---` 之后、换行之前的空白，原样保留 */
  frontmatterFenceSuffix: string;
  /** 文件的第一个节点行是否就是一个 H1。false 时序列化不写根节点的标题行，
   *  根节点的文字来自文件名、改了也无处写回。 */
  hasHeading: boolean;
  root: MindNode;
  /** 第一个节点行（标题或列表项）之前的内容，原样保留。
   *  文件里零个节点行时，整份正文都落在这里。 */
  preamble: string;
}

export const FLAG_COLORS: readonly FlagColor[] = [
  "red", "orange", "yellow", "green", "blue", "purple", "gray",
] as const;
