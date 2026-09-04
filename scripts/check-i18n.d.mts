// scripts/check-i18n.mjs 是 node 直接执行的脚本（与 check-purity.mjs 同款），
// 但它的两个纯函数要被 tests/i18n.test.ts 引用，而 tsconfig 没开 allowJs——
// 直接 import .mjs 会让 `tsc --noEmit` 报 TS7016（vitest 能跑通、typecheck 会红）。
// 这份声明是手写的：改 .mjs 的导出签名时必须同步改这里，tsc 不会替你发现漂移。
export declare function stripComments(src: string): string;
export declare function findChineseLiterals(
  src: string,
): { line: number; literal: string }[];
