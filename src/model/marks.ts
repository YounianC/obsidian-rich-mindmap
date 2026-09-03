import { FLAG_COLORS, type FlagColor, type Marks } from "./types";

/** 面板点选各档位时写入的代表值。 */
export const PROGRESS_STAGE_VALUES: readonly number[] = [
  0, 17, 33, 50, 67, 83, 100,
] as const;

/** 档位下界（含），共 7 档，索引即档位。 */
const STAGE_LOWER_BOUNDS: readonly number[] = [0, 1, 25, 42, 59, 76, 100];

/** 把 0–100 的进度值映射到 0–6 档位。 */
export function progressStage(progress: number): number {
  for (let stage = STAGE_LOWER_BOUNDS.length - 1; stage >= 0; stage--) {
    if (progress >= STAGE_LOWER_BOUNDS[stage]) return stage;
  }
  return 0;
}

const PRIORITY_RE = /^p([1-7])$/;
const PROGRESS_RE = /^(\d{1,3})%$/;
const FLAG_RE = /^flag:([a-z]+)$/;

function isFlagColor(value: string): value is FlagColor {
  return (FLAG_COLORS as readonly string[]).includes(value);
}

/** 把单个 token 应用到 marks 上；无法识别时返回 false。 */
function applyToken(token: string, marks: Marks): boolean {
  const priority = PRIORITY_RE.exec(token);
  if (priority) {
    marks.priority = Number(priority[1]);
    return true;
  }

  const progress = PROGRESS_RE.exec(token);
  if (progress) {
    const value = Number(progress[1]);
    if (value > 100) return false;
    marks.progress = value;
    return true;
  }

  const flag = FLAG_RE.exec(token);
  if (flag && isFlagColor(flag[1])) {
    marks.flag = flag[1];
    return true;
  }

  return false;
}

/**
 * 解析节点文本最前面的括号组。
 * 仅当组内每个 token 都可识别时才视为标记，否则整组按普通文字处理。
 */
export function parseMarks(text: string): { marks: Marks; rest: string } {
  const group = /^\(([^)]*)\)\s*/.exec(text);
  if (!group) return { marks: {}, rest: text };

  const tokens = group[1].trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { marks: {}, rest: text };

  const marks: Marks = {};
  for (const token of tokens) {
    if (!applyToken(token, marks)) return { marks: {}, rest: text };
  }

  return { marks, rest: text.slice(group[0].length) };
}

/** 按 优先级 → 进度 → 旗帜 的固定顺序输出括号组；空标记返回空串。 */
export function formatMarks(marks: Marks): string {
  const tokens: string[] = [];
  if (marks.priority !== undefined) tokens.push(`p${marks.priority}`);
  if (marks.progress !== undefined) tokens.push(`${marks.progress}%`);
  if (marks.flag !== undefined) tokens.push(`flag:${marks.flag}`);
  return tokens.length > 0 ? `(${tokens.join(" ")})` : "";
}
