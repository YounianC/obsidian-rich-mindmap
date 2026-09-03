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
}

export interface MindDoc {
  /** frontmatter 原始文本，不含 --- 分隔符；无 frontmatter 时为 null */
  frontmatter: string | null;
  /** 是否存在一级标题行；false 时序列化不写标题 */
  hasHeading: boolean;
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
