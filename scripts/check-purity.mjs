import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Node 20 没有 fs.globSync，手工枚举纯函数层文件。
const PURE_DIRS = ["src/model"];
const PURE_FILES = ["src/view/layout.ts"];

const FORBIDDEN = [
  { re: /from\s+["']obsidian["']/, why: "import obsidian" },
  { re: /\bdocument\./, why: "使用 document" },
  { re: /\bwindow\./, why: "使用 window" },
  { re: /\bHTMLElement\b/, why: "引用 HTMLElement" },
];

const files = [
  ...PURE_DIRS.filter(existsSync).flatMap((d) =>
    readdirSync(d).filter((f) => f.endsWith(".ts")).map((f) => join(d, f)),
  ),
  ...PURE_FILES.filter(existsSync),
];
const errors = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const { re, why } of FORBIDDEN) {
    if (re.test(src)) errors.push(`${file}: 纯函数层不允许${why}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`纯函数层边界校验通过（${files.length} 个文件）`);
