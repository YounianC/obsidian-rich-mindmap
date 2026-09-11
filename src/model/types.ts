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
 * 有序列表项的标记形态。存在即为有序项，不存在即为无序项。
 *
 * `serialize` 直接写出 `number` 与 `delim`，**绝不从节点在兄弟里的下标重算序号**。
 * 用户写的可能是 `1. 1. 1.`（全是 1，CommonMark 合法）、可能从 `3.` 起头、可能用
 * `)` 分隔符；重算就等于给项目加第六条写回归一化，违反 AGENTS.md 第 2 条。
 * 只有 `tree-ops` 的结构变更（增/删/移）才会经 `renumber` 改写 `number`。
 */
export interface OrderedForm {
  /** 文件里的原始序号，1–9 位数字（CommonMark 的上限） */
  number: number;
  /** CommonMark 允许的两种分隔符，原样保留 */
  delim: "." | ")";
}

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

/**
 * 节点备注：紧跟节点行的连续引用行（`> …`），解析期由 note.ts 的 splitNote
 * 从 `continuation` 里摘出来。
 *
 * `raw` 是这个设计的承重墙。用户写的可能是 `>备注`（无空格）、`>  备注`
 * （两个空格）、tab 缩进。只存解码后的 `text`、写回时统一渲染成 `> `，就等于
 * 给项目加了第六条写回归一化——违反 AGENTS.md 第 2 条。所以解析期把原始行
 * 整条留住，**只有用户真正改了备注才置 `raw = null`**，那时才由 serialize
 * 按节点当前的缩进重新生成。
 */
export interface Note {
  /** 去掉缩进与 `>` 前缀后的备注正文，行间以 \n 连接 */
  text: string;
  /** 来自文件的原始行（含缩进与前缀），逐字重放；用户编辑后为 null */
  raw: string[] | null;
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
  /** 该节点在文件里用的无序列表标记字符，写回时原样重新写出，避免把 `* a` 改成 `- a`。
   *  **仅在 `ordered === undefined` 时被 `serialize` 读取**；有序节点上它是解析期
   *  填入的占位值（`-`），性质与 `HeadingForm.level`「解析期用、序列化不读」相同。
   *  根节点没有列表行，它的取值只作为「新建根的直接子节点时用哪个字符」的来源，
   *  由 parser 取自文件里第一个列表项（没有列表项时为 `-`）。 */
  bullet: Bullet;
  /** 存在即为有序列表项。标题节点不带此字段。
   *
   *  根节点是个例外，与 `bullet` 完全对称：它存的是「文件里第一个列表项的形态」，
   *  供 tree-ops 给根的新直接子节点挑一个与现有兄弟一致的标记。所以
   *  **`isOrdered(root)` 可能为真而根并不是有序列表项** —— 安全性来自 `serialize`
   *  的结构：根节点走 `doc.root.heading.prefix` 那条独立分支写出，永远不进
   *  `serializeNodes` 的标记分支。 */
  ordered?: OrderedForm;
  /** 存在即为「这个节点带备注」。根节点恒无此字段：parser 不对根做 splitNote，
   *  tree-ops.setNote 对根 id 是 no-op（理由与 setMarks 相同）。 */
  note?: Note;
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

/** 判别列表项标记形态的唯一入口。不要散落 `node.ordered !== undefined`。 */
export function isOrdered(
  node: MindNode,
): node is MindNode & { ordered: OrderedForm } {
  return node.ordered !== undefined;
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
