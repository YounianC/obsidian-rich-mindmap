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
}

export interface MindDoc {
  /** frontmatter 原始文本，不含 --- 分隔符；无 frontmatter 时为 null */
  frontmatter: string | null;
  /** frontmatter 结束围栏 `---` 之后、换行之前的空白，原样保留 */
  frontmatterFenceSuffix: string;
  /** 是否存在一级标题行；false 时序列化不写标题 */
  hasHeading: boolean;
  /** 一级标题行里 `#` 与标题文字之间的原始前缀（含 `#` 本身），例如 `"# "`、`"#   "` */
  headingPrefix: string;
  /** 一级标题文字之后的原始尾随空白 */
  headingSuffix: string;
  root: MindNode;
  /** 标题之前的内容，原样保留 */
  preamble: string;
  /** 一级标题与列表块之间的内容（通常是一个空行），原样保留 */
  headingGap: string;
  /** 列表块之后的内容，原样保留 */
  tail: string;
}

export const FLAG_COLORS: readonly FlagColor[] = [
  "red", "orange", "yellow", "green", "blue", "purple", "gray",
] as const;
