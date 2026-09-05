import type { Note } from "./types";

/**
 * 引用行：可有缩进，`>` 之后最多吃掉一个空白字符。
 *
 * 只吃一个是刻意的：`>  备注` 的第二个空格属于正文，吃掉它会让「写回时补回
 * 一个空格」与原文对不上，进而在 renderNote 重新生成时产生字节差异。
 */
const QUOTE_RE = /^[ \t]*>[ \t]?(.*)$/;

/**
 * 从续行**开头**切出备注。不是开头的引用块不收——备注在语义上必须紧贴节点行，
 * 中间隔了散文之后的引用块是普通正文，收编它会让「哪块是备注」变得不可预测。
 *
 * `note.raw` 是切下来的原始行，逐字保留（见 types.ts 的 Note 说明）。
 */
export function splitNote(continuation: readonly string[]): {
  note: Note | null;
  rest: string[];
} {
  const decoded: string[] = [];
  let end = 0;
  while (end < continuation.length) {
    const match = QUOTE_RE.exec(continuation[end]);
    if (match === null) break;
    decoded.push(match[1]);
    end++;
  }
  if (end === 0) return { note: null, rest: [...continuation] };
  return {
    note: { text: decoded.join("\n"), raw: continuation.slice(0, end) },
    rest: continuation.slice(end),
  };
}

/**
 * 备注正文 → 待写出的行。
 *
 * 空行写成 `indent + ">"` 而不是真空行：真空行会把一个引用块劈成两个，重新
 * 解析时 splitNote 只会收到前半段，后半段掉进 continuation 变成图上不可见的
 * 正文——一次编辑静默吃掉半条备注。
 */
export function renderNote(text: string, indent: string): string[] {
  return text
    .split("\n")
    .map((line) => (line === "" ? `${indent}>` : `${indent}> ${line}`));
}
