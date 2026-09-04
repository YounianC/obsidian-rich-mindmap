import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// 扫描范围：视图层与主层。src/model/** 不扫——那一层不含面向用户字符串，而它的
// 中文注释密度最高，扫它只会制造噪音。src/i18n.ts 排除，它就是中文表所在。
const SCAN_DIRS = ["src/view"];
const SCAN_FILES = ["src/main.ts", "src/settings.ts", "src/view.ts"];

const CJK = /[一-鿿]/;

/**
 * 剥离注释，逐字符扫而不是用正则。
 *
 * 朴素的「先把 `//` 到行尾删掉」会把 `"https://example.com"` 截断；反过来
 * 「先配对引号」的写法会被注释里的引号带偏。所以必须按状态机走一遍：任一时刻
 * 只可能处于「代码 / 单引号 / 双引号 / 反引号 / 行注释 / 块注释」之一。
 * 注释内容丢弃但保留换行，使行号不变。
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let state = "code";
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        state = c;
        out += c;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      i++;
      continue;
    }
    if (state === "block") {
      // 保留换行以维持行号
      if (c === "\n") out += c;
      if (c === "*" && next === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    // 字符串内部：先吃掉转义对，再判断是否遇到同种引号收尾
    if (c === "\\") {
      out += c + (next ?? "");
      i += 2;
      continue;
    }
    out += c;
    if (c === state) state = "code";
    i++;
  }
  return out;
}

/** 在已剥离注释的源码里找出含中文的字符串字面量，返回 `{ line, literal }`。 */
export function findChineseLiterals(src) {
  const clean = stripComments(src);
  const found = [];
  // 反引号不能漏：node-el.ts 的四条面向用户文案全是模板字符串，只匹配双引号
  // 会让这个文件整个漏在门禁之外。
  const re = /("(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*')/gs;
  for (const m of clean.matchAll(re)) {
    if (!CJK.test(m[0])) continue;
    found.push({
      line: clean.slice(0, m.index).split("\n").length,
      literal: m[0],
    });
  }
  return found;
}

const files = [
  ...SCAN_DIRS.filter(existsSync).flatMap((d) =>
    readdirSync(d, { recursive: true })
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(d, f)),
  ),
  ...SCAN_FILES.filter(existsSync),
];

const errors = [];
for (const file of files) {
  for (const { line, literal } of findChineseLiterals(readFileSync(file, "utf8"))) {
    errors.push(`${file}:${line}: 面向用户的字符串必须走 t()，不要写死中文 → ${literal}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  console.error(
    "\n（注释不受此约束。文案请加进 src/i18n.ts 的两张表，再用 t(\"key\") 取。）",
  );
  process.exit(1);
}
console.log(`界面文字 i18n 校验通过（${files.length} 个文件）`);
