# Obsidian 本地思维导图插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Obsidian 实现一个本地思维导图视图，数据存为普通 Markdown 缩进列表 + 行内标记，支持完整编辑闭环、优先级/进度/旗帜标记、悬浮工具栏与美观的曲线渲染。

**Architecture:** 纯函数层（`src/model/`、`src/view/layout.ts`）负责 Markdown ↔ 树 ↔ 坐标的全部转换，完全无 DOM 依赖、全部单测覆盖；DOM 层（`src/view/` 其余文件）负责测量、渲染、交互。渲染混合方案：连线用 SVG 贝塞尔曲线，节点用绝对定位 HTML div。`src/view.ts` 作为唯一的编排者，把交互意图转成 `tree-ops` 的不可变操作，再走防抖序列化写回文件。

**Tech Stack:** TypeScript 5、esbuild、Obsidian API（`obsidian` npm 包）、vitest（含 fast-check 属性测试）、原生 DOM（不用 React）。

## Global Constraints

- Node 20+，包管理用 npm。
- TypeScript `strict: true`，禁止 `any`（必要时用 `unknown` + 类型守卫）。
- `src/model/**` 与 `src/view/layout.ts` **不得 import `obsidian`，不得触碰 DOM**。这是纯函数层的硬边界，由 Task 2 建立的 lint 脚本校验。
- 所有面向用户的字符串用中文。
- 所有颜色必须来自 Obsidian CSS 变量或插件自有 CSS 变量，禁止在 TS 里硬编码颜色字面量。
- frontmatter 中插件只拥有 `mindmap` 与 `mindmap-collapsed` 两个键，其余键与顺序原样保留。
- 缩进写入统一 2 空格；读取兼容 2 空格 / 4 空格 / Tab。
- 保存只走 `TextFileView` 的 `getViewData`/`setViewData` 机制 + 400ms 防抖，**禁止直接调用 `vault.modify`**。
- 允许且仅允许三条写回归一化：不以换行结尾的文件被补上尾换行；松散列表（列表项之间的空行）被写成紧凑列表；CRLF 换行在读取时归一化为 LF。其余任何内容变化都是 bug。
- 每个 Task 结束时 `npx tsc --noEmit` 与 `npx vitest run` 必须全绿。

---
## File Structure

| 文件 | 职责 | 层 |
|---|---|---|
| `manifest.json` | Obsidian 插件元数据 | 配置 |
| `package.json` / `tsconfig.json` / `esbuild.config.mjs` / `vitest.config.ts` | 构建与测试配置 | 配置 |
| `scripts/check-purity.mjs` | 校验纯函数层未引入 obsidian/DOM | 配置 |
| `styles.css` | 全部视觉样式与 CSS 变量 | 视图 |
| `src/model/types.ts` | `MindNode` / `Marks` / `MindDoc` 类型 | 纯函数 |
| `src/model/marks.ts` | 行内标记 解析 ↔ 格式化 | 纯函数 |
| `src/model/parser.ts` | Markdown → `MindDoc` | 纯函数 |
| `src/model/serializer.ts` | `MindDoc` → Markdown | 纯函数 |
| `src/model/collapse-state.ts` | frontmatter 折叠键 ↔ 树折叠标记，含路径转义 | 纯函数 |
| `src/model/tree-ops.ts` | 树的不可变增删改移与折叠 | 纯函数 |
| `src/view/layout.ts` | 树 + 尺寸 → 坐标与连线控制点 | 纯函数 |
| `src/view/dom.ts` | `el` / `svgEl` / `clear` DOM 小工具 | 视图 |
| `src/view/node-el.ts` | 单个节点的 DOM 构造与三类标记徽标 | 视图 |
| `src/view/measure.ts` | 离屏测量节点尺寸 | 视图 |
| `src/view/renderer.ts` | SVG 连线 + DOM 节点绘制 | 视图 |
| `src/view/camera.ts` | 缩放/平移状态与坐标变换 | 视图 |
| `src/view/controls.ts` | 右上角缩放控件 | 视图 |
| `src/view/interaction.ts` | 鼠标键盘事件 → 意图事件、就地编辑 | 视图 |
| `src/view/drag.ts` | 节点拖拽与落点解析 | 视图 |
| `src/view/popover.ts` | 浮层定位（工具栏/面板共用） | 视图 |
| `src/view/input-popover.ts` | 单行输入浮层（插入链接） | 视图 |
| `src/view/toolbar.ts` | 悬浮工具栏 | 视图 |
| `src/view/marks-panel.ts` | 优先级/进度/旗帜面板 | 视图 |
| `src/view.ts` | `MindmapView`，编排上述模块与文件读写 | 视图 |
| `src/settings.ts` | 设置项与设置面板 | 视图 |
| `src/main.ts` | 插件入口：注册视图/命令/菜单 | 视图 |
| `tests/*.test.ts` | 纯函数层单测与属性测试 | 测试 |

---

### Task 1: 项目脚手架与纯函数层边界

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.config.mjs`, `manifest.json`, `scripts/check-purity.mjs`, `src/model/types.ts`, `styles.css`
- Test: `tests/purity.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 类型 `Marks`、`MindNode`、`MindDoc`、`FlagColor`；npm 脚本 `build`、`dev`、`test`、`typecheck`、`check:purity`

- [ ] **Step 1: 初始化 npm 与依赖**

```bash
npm init -y
npm pkg set name="obsidian-mindmap" version="0.1.0" description="Obsidian 本地思维导图" type="module" private=true
npm pkg delete main
npm install --save-dev typescript@5 esbuild obsidian builtin-modules vitest fast-check @types/node
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 3: 写 `manifest.json`**

```json
{
  "id": "obsidian-mindmap",
  "name": "思维导图",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "把 Markdown 缩进列表渲染成可编辑的思维导图，原始数据始终是普通 Markdown。",
  "author": "younian",
  "isDesktopOnly": false
}
```

- [ ] **Step 4: 写 `esbuild.config.mjs`**

```js
import esbuild from "esbuild";
import builtins from "builtin-modules";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  treeShaking: true,
  outfile: "main.js",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- [ ] **Step 5: 写 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 6: 加 npm 脚本**

```bash
npm pkg set scripts.build="node esbuild.config.mjs"
npm pkg set scripts.dev="node esbuild.config.mjs --watch"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.typecheck="tsc --noEmit"
npm pkg set scripts.check:purity="node scripts/check-purity.mjs"
```

- [ ] **Step 7: 写纯函数层边界校验脚本 `scripts/check-purity.mjs`**

```js
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
```

- [ ] **Step 8: 写 `src/model/types.ts`**

```ts
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
```

- [ ] **Step 9: 写 `styles.css` 骨架（CSS 变量与容器）**

```css
.mindmap-view {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: var(--background-primary);

  --mm-branch-1: #8b5cf6;
  --mm-branch-2: #3b82f6;
  --mm-branch-3: #06b6d4;
  --mm-branch-4: #10b981;
  --mm-branch-5: #f59e0b;
  --mm-branch-6: #ef4444;
  --mm-branch-7: #ec4899;

  --mm-h-gap: 56px;
  --mm-v-gap: 14px;
}

.mindmap-canvas {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
}

.mindmap-edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
```

- [ ] **Step 10: 写边界校验的自测 `tests/purity.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

describe("纯函数层边界", () => {
  it("check-purity 脚本以退出码 0 通过", () => {
    const out = execFileSync("node", ["scripts/check-purity.mjs"], {
      encoding: "utf8",
    });
    expect(out).toContain("边界校验通过");
  });
});
```

- [ ] **Step 11: 运行验证**

Run: `npx tsc --noEmit && npx vitest run && node esbuild.config.mjs`
Expected: 类型检查通过；`purity.test.ts` 通过；`main.js` 生成失败并报 `src/main.ts` 不存在 —— 这是预期的，因为入口在 Task 7 才写。此时先跳过 build 验证，只要 `tsc` 与 `vitest` 通过即可。

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: 项目脚手架与纯函数层边界校验"
```

---
### Task 2: 行内标记 解析与格式化

**Files:**
- Create: `src/model/marks.ts`
- Test: `tests/marks.test.ts`

**Interfaces:**
- Consumes: `Marks`、`FlagColor`、`FLAG_COLORS` from `src/model/types.ts`
- Produces:
  - `parseMarks(text: string): { marks: Marks; rest: string }`
  - `formatMarks(marks: Marks): string` — 返回不含尾随空格的括号组，空标记返回 `""`
  - `progressStage(progress: number): number` — 返回 0–6 档位
  - `PROGRESS_STAGE_VALUES: readonly number[]` — 面板点选写入的代表值 `[0,17,33,50,67,83,100]`

- [ ] **Step 1: 写失败测试 `tests/marks.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  formatMarks,
  parseMarks,
  progressStage,
  PROGRESS_STAGE_VALUES,
} from "../src/model/marks";

describe("parseMarks", () => {
  it("解析单个优先级", () => {
    expect(parseMarks("(p1) 管理向")).toEqual({
      marks: { priority: 1 },
      rest: "管理向",
    });
  });

  it("解析优先级+进度+旗帜的组合", () => {
    expect(parseMarks("(p3 60% flag:blue) 部分开发自测")).toEqual({
      marks: { priority: 3, progress: 60, flag: "blue" },
      rest: "部分开发自测",
    });
  });

  it("token 顺序不敏感", () => {
    expect(parseMarks("(flag:blue 60% p3) x").marks).toEqual(
      parseMarks("(p3 60% flag:blue) x").marks,
    );
  });

  it("重复标记以最后一次为准", () => {
    expect(parseMarks("(p1 p5) x").marks).toEqual({ priority: 5 });
  });

  it("括号组含未知 token 时整组按文字处理", () => {
    expect(parseMarks("(p1 备注) 任务")).toEqual({
      marks: {},
      rest: "(p1 备注) 任务",
    });
  });

  it("完全无关的括号组按文字处理", () => {
    expect(parseMarks("(备注) 这是什么")).toEqual({
      marks: {},
      rest: "(备注) 这是什么",
    });
  });

  it("只吃掉最前面的一个括号组", () => {
    expect(parseMarks("(p1) (备注) 任务")).toEqual({
      marks: { priority: 1 },
      rest: "(备注) 任务",
    });
  });

  it("越界值不匹配，按文字处理", () => {
    expect(parseMarks("(p9) x").marks).toEqual({});
    expect(parseMarks("(150%) x").marks).toEqual({});
    expect(parseMarks("(flag:pink) x").marks).toEqual({});
  });

  it("无括号组时原样返回", () => {
    expect(parseMarks("任务安排")).toEqual({ marks: {}, rest: "任务安排" });
  });

  it("空括号组按文字处理", () => {
    expect(parseMarks("() x")).toEqual({ marks: {}, rest: "() x" });
  });

  it("括号组后无空格也能解析", () => {
    expect(parseMarks("(p1)管理向")).toEqual({
      marks: { priority: 1 },
      rest: "管理向",
    });
  });

  it("0% 与 100% 都是合法进度", () => {
    expect(parseMarks("(0%) x").marks).toEqual({ progress: 0 });
    expect(parseMarks("(100%) x").marks).toEqual({ progress: 100 });
  });
});

describe("formatMarks", () => {
  it("空标记返回空串", () => {
    expect(formatMarks({})).toBe("");
  });

  it("按 优先级→进度→旗帜 顺序输出", () => {
    expect(formatMarks({ flag: "blue", progress: 60, priority: 3 })).toBe(
      "(p3 60% flag:blue)",
    );
  });

  it("单项输出", () => {
    expect(formatMarks({ priority: 1 })).toBe("(p1)");
    expect(formatMarks({ progress: 0 })).toBe("(0%)");
    expect(formatMarks({ flag: "red" })).toBe("(flag:red)");
  });
});

describe("progressStage", () => {
  it("按 spec 的区间落档", () => {
    const cases: [number, number][] = [
      [0, 0], [1, 1], [24, 1], [25, 2], [41, 2],
      [42, 3], [58, 3], [59, 4], [75, 4], [76, 5],
      [99, 5], [100, 6],
    ];
    for (const [input, stage] of cases) {
      expect(progressStage(input), `progress=${input}`).toBe(stage);
    }
  });

  it("代表值各自落在自己的档位上", () => {
    PROGRESS_STAGE_VALUES.forEach((v, i) => {
      expect(progressStage(v), `stage=${i}`).toBe(i);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/marks.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../src/model/marks"`

- [ ] **Step 3: 写实现 `src/model/marks.ts`**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/marks.test.ts && npx tsc --noEmit && node scripts/check-purity.mjs`
Expected: 全部 PASS，边界校验通过

- [ ] **Step 5: Commit**

```bash
git add src/model/marks.ts tests/marks.test.ts
git commit -m "feat: 行内标记解析与格式化"
```

---
### Task 3: Markdown 解析

**Files:**
- Create: `src/model/parser.ts`
- Test: `tests/parser.test.ts`

**Interfaces:**
- Consumes: `MindDoc`、`MindNode` from `types.ts`；`parseMarks` from `marks.ts`
- Produces:
  - `parse(md: string, fileName: string): MindDoc`
  - id 生成规则：根节点 `n0`，其余按前序遍历顺序 `n1`、`n2`…（确定性，便于测试）
  - 解析出的所有节点 `collapsed` 恒为 `false`（折叠状态由 Task 5 的 `collapse-state.ts` 施加）

**列表块终止规则**（必须严格实现）：从块首行起逐行扫描，遇到下列任一情况时块结束，该行及其后全部内容进入 `tail`：

1. 标题行 `/^#{1,6}\s/`
2. 有序列表项 `/^\s*\d+\.\s/`
3. 代码块围栏 `/^\s*```/`
4. 空行，且其后第一个非空行不是无序列表项

块内非 `- ` 开头的缩进行，作为上一节点的 `continuation`（原样保留，含前导空白）。

- [ ] **Step 1: 写失败测试 `tests/parser.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";

const SAMPLE = `---
title: 我的笔记
mindmap: true
---

# 工作内容

- 呼叫中心
  - (p1) 管理向
    - 任务安排
  - 业务向
- WP
`;

describe("parse", () => {
  it("提取 frontmatter 原始文本", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.frontmatter).toBe("title: 我的笔记\nmindmap: true");
  });

  it("一级标题作为根节点", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.hasHeading).toBe(true);
    expect(doc.root.text).toBe("工作内容");
    expect(doc.root.id).toBe("n0");
  });

  it("按缩进构建层级", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["呼叫中心", "WP"]);
    const callCenter = doc.root.children[0];
    expect(callCenter.children.map((c) => c.text)).toEqual(["管理向", "业务向"]);
    expect(callCenter.children[0].marks).toEqual({ priority: 1 });
    expect(callCenter.children[0].children.map((c) => c.text)).toEqual([
      "任务安排",
    ]);
  });

  it("id 按前序遍历递增", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.root.children[0].id).toBe("n1");
    expect(doc.root.children[0].children[0].id).toBe("n2");
    expect(doc.root.children[0].children[0].children[0].id).toBe("n3");
  });

  it("解析出的节点 collapsed 均为 false", () => {
    const doc = parse(SAMPLE, "工作内容.md");
    expect(doc.root.children[0].collapsed).toBe(false);
  });

  it("无 frontmatter 时为 null", () => {
    const doc = parse("# 标题\n\n- a\n", "x.md");
    expect(doc.frontmatter).toBeNull();
  });

  it("无一级标题时用文件名作根节点", () => {
    const doc = parse("- a\n- b\n", "我的导图.md");
    expect(doc.hasHeading).toBe(false);
    expect(doc.root.text).toBe("我的导图");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("无列表块时只有根节点", () => {
    const doc = parse("# 标题\n\n一段普通文字\n", "x.md");
    expect(doc.root.children).toEqual([]);
    expect(doc.tail).toBe("\n一段普通文字\n");
  });

  it("兼容 4 空格缩进", () => {
    const doc = parse("# t\n\n- a\n    - b\n", "x.md");
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("兼容 Tab 缩进", () => {
    const doc = parse("# t\n\n- a\n\t- b\n", "x.md");
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("缩进跳跃时挂到最近合法父节点", () => {
    const doc = parse("# t\n\n- a\n      - b\n", "x.md");
    expect(doc.root.children[0].children.map((c) => c.text)).toEqual(["b"]);
  });

  it("标题行终止列表块", () => {
    const doc = parse("# t\n\n- a\n## 附录\n- b\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.tail).toBe("## 附录\n- b\n");
  });

  it("有序列表项终止列表块", () => {
    const doc = parse("# t\n\n- a\n1. 步骤\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.tail).toBe("1. 步骤\n");
  });

  it("代码块围栏终止列表块", () => {
    const doc = parse("# t\n\n- a\n```js\nx\n```\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.tail).toBe("```js\nx\n```\n");
  });

  it("空行后接非列表行终止列表块", () => {
    const doc = parse("# t\n\n- a\n\n结尾说明\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
    expect(doc.tail).toBe("\n结尾说明\n");
  });

  it("空行后接列表行不终止列表块", () => {
    const doc = parse("# t\n\n- a\n\n- b\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("非列表缩进行作为上一节点的续行", () => {
    const doc = parse("# t\n\n- a\n  续行内容\n- b\n", "x.md");
    expect(doc.root.children[0].continuation).toEqual(["  续行内容"]);
    expect(doc.root.children.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("保留标题之前的前言", () => {
    const doc = parse("说明文字\n\n# t\n\n- a\n", "x.md");
    expect(doc.preamble).toBe("说明文字\n\n");
    expect(doc.root.text).toBe("t");
  });

  it("保留标题与列表块之间的空行", () => {
    const doc = parse("# t\n\n- a\n", "x.md");
    expect(doc.headingGap).toBe("\n");
  });

  it("节点文本保留 Markdown 行内语法", () => {
    const doc = parse("# t\n\n- (p2) 回答问题 [[业务手册]] **重要**\n", "x.md");
    expect(doc.root.children[0].text).toBe("回答问题 [[业务手册]] **重要**");
  });

  it("支持 * 与 + 作为列表标记", () => {
    const doc = parse("# t\n\n* a\n", "x.md");
    expect(doc.root.children.map((c) => c.text)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../src/model/parser"`

- [ ] **Step 3: 写实现 `src/model/parser.ts`**

```ts
import { parseMarks } from "./marks";
import type { MindDoc, MindNode } from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const HEADING_RE = /^#[ \t]+(.*)$/;
const ANY_HEADING_RE = /^#{1,6}[ \t]/;
const LIST_ITEM_RE = /^([ \t]*)[-*+][ \t]+(.*)$/;
const ORDERED_ITEM_RE = /^[ \t]*\d+\.[ \t]/;
const FENCE_RE = /^[ \t]*(?:```|~~~)/;

/**
 * 按行区间取回原始文本。末尾统一补换行，因此不以换行结尾的文件在写回时
 * 会被补上一个尾换行 —— 这是唯一的已知归一化，无害且符合 Obsidian 惯例。
 */
function sliceText(lines: string[], from: number, to: number): string {
  const seg = lines.slice(from, to);
  // 区间延伸到文件末尾时，最后那个空串是文件尾换行的产物，不是真实空行。
  if (to >= lines.length && seg[seg.length - 1] === "") seg.pop();
  return seg.map((line) => line + "\n").join("");
}

/** Tab 按 4 空格计宽。 */
function indentWidth(indent: string): number {
  let width = 0;
  for (const ch of indent) width += ch === "\t" ? 4 : 1;
  return width;
}

interface ListItemLine {
  depthWidth: number;
  text: string;
  continuation: string[];
}

/** 扫描列表块，返回条目与块结束的行号（不含）。 */
function scanListBlock(
  lines: string[],
  start: number,
): { items: ListItemLine[]; end: number } {
  const items: ListItemLine[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (ANY_HEADING_RE.test(line) || ORDERED_ITEM_RE.test(line) || FENCE_RE.test(line)) {
      break;
    }

    if (line.trim() === "") {
      // 空行：向前找第一个非空行，若不是列表项则块结束。
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length || !LIST_ITEM_RE.test(lines[j])) break;
      i = j;
      continue;
    }

    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      items.push({
        depthWidth: indentWidth(item[1]),
        text: item[2],
        continuation: [],
      });
      i++;
      continue;
    }

    // 缩进的非列表行：归为上一条目的续行。
    if (/^[ \t]/.test(line) && items.length > 0) {
      items[items.length - 1].continuation.push(line);
      i++;
      continue;
    }

    break;
  }

  return { items, end: i };
}

/** 从条目的缩进宽度推断缩进单位；没有缩进层级时返回 2。 */
function detectIndentUnit(items: ListItemLine[]): number {
  const base = items.length > 0 ? items[0].depthWidth : 0;
  for (const item of items) {
    const delta = item.depthWidth - base;
    if (delta > 0) return delta;
  }
  return 2;
}

/** 按缩进宽度把扁平条目组装成树，缩进跳跃时挂到最近合法父节点。 */
function buildTree(items: ListItemLine[], root: MindNode): void {
  const unit = detectIndentUnit(items);
  const base = items.length > 0 ? items[0].depthWidth : 0;
  let nextId = 1;
  /** stack[d] 是深度 d 的最近节点，root 位于 stack[0]。 */
  const stack: MindNode[] = [root];

  for (const item of items) {
    const raw = Math.round((item.depthWidth - base) / unit) + 1;
    const depth = Math.max(1, Math.min(raw, stack.length));
    const { marks, rest } = parseMarks(item.text);

    const node: MindNode = {
      id: `n${nextId++}`,
      text: rest,
      marks,
      children: [],
      collapsed: false,
      continuation: item.continuation,
    };

    stack[depth - 1].children.push(node);
    stack.length = depth;
    stack.push(node);
  }
}

/**
 * 把 Markdown 解析为思维导图文档。
 * 列表块之外的一切内容（frontmatter、前言、尾块）原样保留。
 */
export function parse(md: string, fileName: string): MindDoc {
  let rest = md;
  let frontmatter: string | null = null;

  const fm = FRONTMATTER_RE.exec(rest);
  if (fm) {
    frontmatter = fm[1];
    rest = rest.slice(fm[0].length);
  }

  const lines = rest.split("\n");

  // 定位一级标题。
  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      headingIndex = i;
      break;
    }
  }

  const hasHeading = headingIndex >= 0;
  const rootText = hasHeading
    ? (HEADING_RE.exec(lines[headingIndex]) as RegExpExecArray)[1].trim()
    : fileName.replace(/\.md$/, "");
  const preamble = sliceText(lines, 0, hasHeading ? headingIndex : 0);

  // 定位列表块起点。
  const searchFrom = hasHeading ? headingIndex + 1 : 0;
  let blockStart = -1;
  for (let i = searchFrom; i < lines.length; i++) {
    if (LIST_ITEM_RE.test(lines[i])) {
      blockStart = i;
      break;
    }
    if (ANY_HEADING_RE.test(lines[i]) || FENCE_RE.test(lines[i])) break;
  }

  const root: MindNode = {
    id: "n0",
    text: rootText,
    marks: {},
    children: [],
    collapsed: false,
    continuation: [],
  };

  if (blockStart < 0) {
    return {
      frontmatter,
      hasHeading,
      root,
      preamble,
      headingGap: "",
      tail: sliceText(lines, searchFrom, lines.length),
    };
  }

  const { items, end } = scanListBlock(lines, blockStart);
  buildTree(items, root);

  return {
    frontmatter,
    hasHeading,
    root,
    preamble,
    headingGap: sliceText(lines, searchFrom, blockStart),
    tail: sliceText(lines, end, lines.length),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/parser.test.ts && npx tsc --noEmit && node scripts/check-purity.mjs`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/model/parser.ts tests/parser.test.ts
git commit -m "feat: Markdown 解析为思维导图树"
```

---
### Task 4: Markdown 序列化与往返稳定性

**Files:**
- Create: `src/model/serializer.ts`
- Test: `tests/serializer.test.ts`, `tests/roundtrip.test.ts`

**Interfaces:**
- Consumes: `MindDoc`、`MindNode` from `types.ts`；`formatMarks` from `marks.ts`
- Produces: `serialize(doc: MindDoc): string` — 缩进统一 2 空格；标记按 `优先级 → 进度 → 旗帜` 输出；`frontmatter` / `preamble` / `headingGap` / `tail` 原样写回

- [ ] **Step 1: 写失败测试 `tests/serializer.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { serialize } from "../src/model/serializer";

describe("serialize", () => {
  it("缩进统一为 2 空格", () => {
    const doc = parse("# t\n\n- a\n    - b\n        - c\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- a\n  - b\n    - c\n");
  });

  it("Tab 缩进归一化为 2 空格", () => {
    const doc = parse("# t\n\n- a\n\t- b\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- a\n  - b\n");
  });

  it("* 与 + 列表标记归一化为 -", () => {
    const doc = parse("# t\n\n* a\n+ b\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- a\n- b\n");
  });

  it("标记按固定顺序写回", () => {
    const doc = parse("# t\n\n- (flag:blue 60% p3) a\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- (p3 60% flag:blue) a\n");
  });

  it("空文本节点带标记时不产生尾随空格", () => {
    const doc = parse("# t\n\n- (p1)\n", "x.md");
    expect(serialize(doc)).toBe("# t\n\n- (p1)\n");
  });

  it("无一级标题时不写标题行", () => {
    const doc = parse("- a\n", "我的导图.md");
    expect(serialize(doc)).toBe("- a\n");
  });

  it("frontmatter 未知键与顺序原样保留", () => {
    const md = "---\nzzz: 1\naaa: 2\nmindmap: true\n---\n\n# t\n\n- a\n";
    expect(serialize(parse(md, "x.md"))).toBe(md);
  });

  it("续行原样写回", () => {
    const md = "# t\n\n- a\n  续行内容\n- b\n";
    expect(serialize(parse(md, "x.md"))).toBe(md);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/serializer.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../src/model/serializer"`

- [ ] **Step 3: 写实现 `src/model/serializer.ts`**

```ts
import { formatMarks } from "./marks";
import type { MindDoc, MindNode } from "./types";

const INDENT = "  ";

/** 组合标记与文本，避免空文本时出现尾随空格。 */
function composeLine(node: MindNode): string {
  const marks = formatMarks(node.marks);
  if (marks === "") return node.text;
  if (node.text === "") return marks;
  return `${marks} ${node.text}`;
}

function serializeNodes(nodes: readonly MindNode[], depth: number): string {
  let out = "";
  for (const node of nodes) {
    out += `${INDENT.repeat(depth)}- ${composeLine(node)}\n`;
    for (const line of node.continuation) out += `${line}\n`;
    out += serializeNodes(node.children, depth + 1);
  }
  return out;
}

/** 把思维导图文档写回 Markdown。列表块之外的内容原样保留。 */
export function serialize(doc: MindDoc): string {
  let out = "";
  if (doc.frontmatter !== null) out += `---\n${doc.frontmatter}\n---\n`;
  out += doc.preamble;
  if (doc.hasHeading) out += `# ${doc.root.text}\n`;
  out += doc.headingGap;
  out += serializeNodes(doc.root.children, 0);
  out += doc.tail;
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/serializer.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 写往返测试 `tests/roundtrip.test.ts`**

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { serialize } from "../src/model/serializer";
import type { MindDoc, MindNode } from "../src/model/types";
import { FLAG_COLORS } from "../src/model/types";

/** 规范化 Markdown 语料：这些文本应满足 serialize(parse(md)) === md。 */
const CORPUS: string[] = [
  "# t\n\n- a\n",
  "# t\n\n- a\n  - b\n    - c\n- d\n",
  "---\nmindmap: true\n---\n\n# 工作内容\n\n- 呼叫中心\n  - (p1) 管理向\n",
  "---\ntitle: x\nzzz: 1\n---\n\n# t\n\n- (p3 60% flag:blue) a\n",
  "说明文字\n\n# t\n\n- a\n",
  "- a\n- b\n",
  "# t\n\n- a\n## 附录\n\n正文\n",
  "# t\n\n- a\n1. 步骤\n",
  "# t\n\n- a\n```js\nconst x = 1;\n```\n",
  "# t\n\n- a\n\n结尾说明\n",
  "# t\n\n- a\n  续行内容\n- b\n",
  "# t\n\n- (备注) 这是什么\n",
  "# t\n\n- (p1) (备注) 任务\n",
  "# t\n\n- 回答问题 [[业务手册]] **重要**\n",
];

describe("serialize(parse(md)) === md", () => {
  for (const md of CORPUS) {
    it(`语料: ${JSON.stringify(md).slice(0, 50)}`, () => {
      expect(serialize(parse(md, "我的导图.md"))).toBe(md);
    });
  }
});

/** 去掉 id，便于结构比较（id 不写入文件，往返后由 parser 重新分配）。 */
function stripIds(node: MindNode): unknown {
  return {
    text: node.text,
    marks: node.marks,
    collapsed: node.collapsed,
    continuation: node.continuation,
    children: node.children.map(stripIds),
  };
}

/** 生成对解析安全的节点文本：不含换行、括号、行首井号、首尾空白。 */
const safeText = fc
  .array(
    fc.constantFrom(..."abcxyz任务安排管理向数据0123".split("")),
    { minLength: 1, maxLength: 12 },
  )
  .map((chars) => chars.join(""));

const marksArb = fc.record(
  {
    priority: fc.option(fc.integer({ min: 1, max: 7 }), { nil: undefined }),
    progress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    flag: fc.option(fc.constantFrom(...FLAG_COLORS), { nil: undefined }),
  },
  { requiredKeys: [] },
);

function nodeArb(depth: number): fc.Arbitrary<MindNode> {
  // depth 递减到 0 即停，因此可以直接递归构造，无需 fc.letrec。
  const childrenArb: fc.Arbitrary<MindNode[]> =
    depth <= 0 ? fc.constant([]) : fc.array(nodeArb(depth - 1), { maxLength: 3 });

  return fc.record({
    id: fc.constant("x"),
    text: safeText,
    marks: marksArb,
    children: childrenArb,
    collapsed: fc.constant(false),
    continuation: fc.constant([] as string[]),
  });
}

const docArb: fc.Arbitrary<MindDoc> = fc.record({
  frontmatter: fc.constant(null),
  hasHeading: fc.constant(true),
  root: fc.record({
    id: fc.constant("n0"),
    text: safeText,
    marks: fc.constant({}),
    children: fc.array(nodeArb(3), { minLength: 1, maxLength: 4 }),
    collapsed: fc.constant(false),
    continuation: fc.constant([] as string[]),
  }),
  preamble: fc.constant(""),
  headingGap: fc.constant("\n"),
  tail: fc.constant(""),
});

describe("已知归一化", () => {
  it("松散列表（列表项之间的空行）被归一化为紧凑列表", () => {
    expect(serialize(parse("# t\n\n- a\n\n- b\n", "x.md"))).toBe(
      "# t\n\n- a\n- b\n",
    );
  });

  it("不以换行结尾的文件被补上尾换行", () => {
    expect(serialize(parse("# t\n\n- a", "x.md"))).toBe("# t\n\n- a\n");
  });
});

describe("parse(serialize(doc)) 结构等于 doc", () => {
  it("对随机文档成立", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const back = parse(serialize(doc), "我的导图.md");
        expect(stripIds(back.root)).toEqual(stripIds(doc.root));
        expect(back.frontmatter).toBe(doc.frontmatter);
        expect(back.hasHeading).toBe(doc.hasHeading);
        expect(back.preamble).toBe(doc.preamble);
        expect(back.headingGap).toBe(doc.headingGap);
        expect(back.tail).toBe(doc.tail);
      }),
      { numRuns: 300 },
    );
  });
});
```

- [ ] **Step 6: 运行往返测试**

Run: `npx vitest run tests/roundtrip.test.ts`
Expected: 全部 PASS。若属性测试报出反例，**修 parser/serializer，不要放宽生成器约束** —— 除非反例本身是生成器造出的非法 Markdown（例如节点文本以 `#` 开头），那时收紧 `safeText` 并在注释里写明原因。

- [ ] **Step 7: 全量验证**

Run: `npx vitest run && npx tsc --noEmit && node scripts/check-purity.mjs`
Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add src/model/serializer.ts tests/serializer.test.ts tests/roundtrip.test.ts
git commit -m "feat: Markdown 序列化与往返稳定性测试"
```

---
### Task 5: 折叠状态与 frontmatter 键管理

**Files:**
- Create: `src/model/collapse-state.ts`
- Test: `tests/collapse-state.test.ts`

**Interfaces:**
- Consumes: `MindNode` from `types.ts`
- Produces:
  - `encodeSegment(text: string): string` — `\` → `\\`，`/` → `\/`
  - `nodePaths(root: MindNode): Map<string, string>` — 节点 id → 路径（不含根节点文本）
  - `collectCollapsedPaths(root: MindNode): string[]` — 前序遍历收集已折叠节点的路径
  - `applyCollapsedPaths(root: MindNode, paths: readonly string[]): MindNode` — 返回新树；路径重复时只命中第一个匹配，匹配失败静默忽略
  - `readCollapsed(frontmatter: string | null): string[]`
  - `writeCollapsed(frontmatter: string | null, paths: readonly string[]): string | null` — 空数组时删除该键；其余键与顺序原样保留
  - `setMindmapFlag(frontmatter: string | null, value: boolean): string`

**YAML 处理范围**：只处理块序列形式，值一律以双引号 JSON 转义写出，因此路径中的 `:`、`#`、中文都安全。读取时兼容双引号形式与裸标量形式，以及空的流式 `[]`。不引入 YAML 库。

- [ ] **Step 1: 写失败测试 `tests/collapse-state.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  applyCollapsedPaths,
  collectCollapsedPaths,
  encodeSegment,
  nodePaths,
  readCollapsed,
  setMindmapFlag,
  writeCollapsed,
} from "../src/model/collapse-state";
import { parse } from "../src/model/parser";
import type { MindNode } from "../src/model/types";

function tree(): MindNode {
  return parse("# 工作内容\n\n- 呼叫中心\n  - 业务向\n    - 自测\n- WP\n", "x.md")
    .root;
}

describe("encodeSegment", () => {
  it("转义反斜杠与斜杠", () => {
    expect(encodeSegment("a/b")).toBe("a\\/b");
    expect(encodeSegment("a\\b")).toBe("a\\\\b");
    expect(encodeSegment("a\\/b")).toBe("a\\\\\\/b");
  });
});

describe("nodePaths", () => {
  it("路径不含根节点文本", () => {
    const paths = nodePaths(tree());
    expect([...paths.values()]).toEqual([
      "呼叫中心",
      "呼叫中心/业务向",
      "呼叫中心/业务向/自测",
      "WP",
    ]);
  });

  it("根节点自身不产生路径", () => {
    const root = tree();
    expect(nodePaths(root).has(root.id)).toBe(false);
  });
});

describe("applyCollapsedPaths / collectCollapsedPaths", () => {
  it("按路径设置折叠标记", () => {
    const next = applyCollapsedPaths(tree(), ["呼叫中心/业务向"]);
    expect(next.children[0].collapsed).toBe(false);
    expect(next.children[0].children[0].collapsed).toBe(true);
  });

  it("不修改原树", () => {
    const root = tree();
    applyCollapsedPaths(root, ["呼叫中心"]);
    expect(root.children[0].collapsed).toBe(false);
  });

  it("路径匹配失败时静默忽略", () => {
    const next = applyCollapsedPaths(tree(), ["不存在/的路径"]);
    expect(collectCollapsedPaths(next)).toEqual([]);
  });

  it("与 collectCollapsedPaths 往返一致", () => {
    const paths = ["呼叫中心/业务向", "WP"];
    const next = applyCollapsedPaths(tree(), paths);
    expect(collectCollapsedPaths(next).sort()).toEqual([...paths].sort());
  });
});

describe("readCollapsed", () => {
  it("读取双引号块序列", () => {
    const fm = 'title: x\nmindmap-collapsed:\n  - "呼叫中心/业务向"\n  - "WP"';
    expect(readCollapsed(fm)).toEqual(["呼叫中心/业务向", "WP"]);
  });

  it("兼容裸标量", () => {
    const fm = "mindmap-collapsed:\n  - WP";
    expect(readCollapsed(fm)).toEqual(["WP"]);
  });

  it("兼容空的流式写法", () => {
    expect(readCollapsed("mindmap-collapsed: []")).toEqual([]);
  });

  it("无该键或无 frontmatter 时返回空数组", () => {
    expect(readCollapsed("title: x")).toEqual([]);
    expect(readCollapsed(null)).toEqual([]);
  });

  it("不越界读到下一个键", () => {
    const fm = "mindmap-collapsed:\n  - WP\nmindmap: true";
    expect(readCollapsed(fm)).toEqual(["WP"]);
  });
});

describe("writeCollapsed", () => {
  it("在保留其他键与顺序的前提下新增该键", () => {
    expect(writeCollapsed("zzz: 1\naaa: 2", ["WP"])).toBe(
      'zzz: 1\naaa: 2\nmindmap-collapsed:\n  - "WP"',
    );
  });

  it("替换已有该键且不动其他键", () => {
    const fm = 'zzz: 1\nmindmap-collapsed:\n  - "旧"\nmindmap: true';
    expect(writeCollapsed(fm, ["新"])).toBe(
      'zzz: 1\nmindmap-collapsed:\n  - "新"\nmindmap: true',
    );
  });

  it("空数组时删除该键", () => {
    const fm = 'zzz: 1\nmindmap-collapsed:\n  - "旧"\nmindmap: true';
    expect(writeCollapsed(fm, [])).toBe("zzz: 1\nmindmap: true");
  });

  it("删到 frontmatter 为空时返回 null", () => {
    expect(writeCollapsed('mindmap-collapsed:\n  - "旧"', [])).toBeNull();
  });

  it("无 frontmatter 时新建", () => {
    expect(writeCollapsed(null, ["WP"])).toBe(
      'mindmap-collapsed:\n  - "WP"',
    );
  });

  it("路径中的特殊字符被 JSON 转义", () => {
    expect(writeCollapsed(null, ['含"引号', "含:冒号"])).toBe(
      'mindmap-collapsed:\n  - "含\\"引号"\n  - "含:冒号"',
    );
  });
});

describe("setMindmapFlag", () => {
  it("新增键", () => {
    expect(setMindmapFlag("title: x", true)).toBe("title: x\nmindmap: true");
  });

  it("已存在时替换", () => {
    expect(setMindmapFlag("mindmap: false\ntitle: x", true)).toBe(
      "mindmap: true\ntitle: x",
    );
  });

  it("无 frontmatter 时新建", () => {
    expect(setMindmapFlag(null, true)).toBe("mindmap: true");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/collapse-state.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../src/model/collapse-state"`

- [ ] **Step 3: 写实现 `src/model/collapse-state.ts`**

```ts
import type { MindNode } from "./types";

const COLLAPSED_KEY = "mindmap-collapsed";
const MINDMAP_KEY = "mindmap";

/** 路径分隔符 `/` 与转义符 `\` 需要转义。 */
export function encodeSegment(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\//g, "\\/");
}

/** 节点 id → 路径（从根的子节点算起，根节点自身不产生路径）。 */
export function nodePaths(root: MindNode): Map<string, string> {
  const result = new Map<string, string>();

  const walk = (nodes: readonly MindNode[], prefix: string): void => {
    for (const node of nodes) {
      const path = prefix === ""
        ? encodeSegment(node.text)
        : `${prefix}/${encodeSegment(node.text)}`;
      result.set(node.id, path);
      walk(node.children, path);
    }
  };

  walk(root.children, "");
  return result;
}

/** 前序遍历收集已折叠节点的路径。 */
export function collectCollapsedPaths(root: MindNode): string[] {
  const paths = nodePaths(root);
  const result: string[] = [];

  const walk = (nodes: readonly MindNode[]): void => {
    for (const node of nodes) {
      if (node.collapsed) {
        const path = paths.get(node.id);
        if (path !== undefined) result.push(path);
      }
      walk(node.children);
    }
  };

  walk(root.children);
  return result;
}

/** 按路径集合施加折叠标记，返回新树。路径重复只命中第一个，失配静默忽略。 */
export function applyCollapsedPaths(
  root: MindNode,
  paths: readonly string[],
): MindNode {
  const wanted = new Set(paths);
  const used = new Set<string>();

  const rebuild = (node: MindNode, prefix: string, isRoot: boolean): MindNode => {
    const path = isRoot
      ? ""
      : prefix === ""
        ? encodeSegment(node.text)
        : `${prefix}/${encodeSegment(node.text)}`;

    const collapsed = !isRoot && wanted.has(path) && !used.has(path);
    if (collapsed) used.add(path);

    return {
      ...node,
      collapsed,
      children: node.children.map((child) => rebuild(child, path, false)),
    };
  };

  return rebuild(root, "", true);
}

/** frontmatter 按行切分，返回 [行数组] 便于逐键操作。 */
function toLines(frontmatter: string | null): string[] {
  return frontmatter === null || frontmatter === ""
    ? []
    : frontmatter.split("\n");
}

function fromLines(lines: readonly string[]): string | null {
  return lines.length === 0 ? null : lines.join("\n");
}

const KEY_LINE_RE = /^([A-Za-z0-9_-]+):/;

/**
 * 定位某个顶层键覆盖的行区间 [start, end)；不存在时返回 null。
 *
 * 块的结束以「缩进」判定，而不是「下一个看起来像键的行」。用正则找下一个键会
 * 漏掉键名超出 [A-Za-z0-9_-] 的行（例如中文键 `名字:`、带点的 `my.key:`），把它们
 * 当成本键块的一部分从而在重写时静默删除；空行与列首注释也会被一并吞掉。
 * YAML 里顶层键的块 = 键行 + 其后所有缩进行，这条规则同时正确处理块序列、
 * 嵌套映射与块标量，并让空行 / 注释 / 任意键名都能正确终止块。
 */
function findKeyRange(
  lines: readonly string[],
  key: string,
): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const match = KEY_LINE_RE.exec(lines[i]);
    if (match === null || match[1] !== key) continue;

    let end = i + 1;
    while (end < lines.length) {
      if (/^[ \t]/.test(lines[end])) {
        end++;
        continue;
      }
      if (lines[end].trim() === "") {
        // 空行只有在其后仍有缩进行时才属于本块（YAML 块序列容许内部空行）；
        // 若空行之后是另一个顶层键，则空行属于键之间的间隔，必须保留。
        let j = end + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && /^[ \t]/.test(lines[j])) {
          end = j;
          continue;
        }
      }
      break;
    }
    return { start: i, end };
  }
  return null;
}

/** 读取折叠路径列表。兼容双引号块序列、裸标量块序列与空的流式 `[]`。 */
export function readCollapsed(frontmatter: string | null): string[] {
  const lines = toLines(frontmatter);
  const range = findKeyRange(lines, COLLAPSED_KEY);
  if (range === null) return [];

  const result: string[] = [];
  for (let i = range.start; i < range.end; i++) {
    const item = /^\s*-\s+(.*)$/.exec(lines[i]);
    if (item === null) continue;

    const raw = item[1].trim();
    if (raw.startsWith('"')) {
      try {
        result.push(JSON.parse(raw) as string);
      } catch {
        result.push(raw);
      }
    } else {
      result.push(raw);
    }
  }
  return result;
}

/** 用给定行块替换（或新增、删除）某个顶层键。 */
function replaceKey(
  frontmatter: string | null,
  key: string,
  block: readonly string[],
): string | null {
  const lines = toLines(frontmatter);
  const range = findKeyRange(lines, key);

  if (range === null) {
    return fromLines([...lines, ...block]);
  }
  return fromLines([
    ...lines.slice(0, range.start),
    ...block,
    ...lines.slice(range.end),
  ]);
}

/** 写入折叠路径列表；空列表时删除该键。 */
export function writeCollapsed(
  frontmatter: string | null,
  paths: readonly string[],
): string | null {
  const block = paths.length === 0
    ? []
    : [`${COLLAPSED_KEY}:`, ...paths.map((p) => `  - ${JSON.stringify(p)}`)];
  return replaceKey(frontmatter, COLLAPSED_KEY, block);
}

/** 写入 `mindmap: true|false`。结果一定非空，因此返回 string。 */
export function setMindmapFlag(
  frontmatter: string | null,
  value: boolean,
): string {
  const result = replaceKey(frontmatter, MINDMAP_KEY, [
    `${MINDMAP_KEY}: ${String(value)}`,
  ]);
  return result ?? `${MINDMAP_KEY}: ${String(value)}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run && npx tsc --noEmit && node scripts/check-purity.mjs`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/model/collapse-state.ts tests/collapse-state.test.ts
git commit -m "feat: 折叠状态与 frontmatter 键管理"
```

---
### Task 6: 树的不可变操作与键盘导航

**Files:**
- Create: `src/model/tree-ops.ts`
- Test: `tests/tree-ops.test.ts`

**Interfaces:**
- Consumes: `MindNode`、`Marks` from `types.ts`
- Produces（全部返回新树，不修改入参）：
  - `findNode(root: MindNode, id: string): MindNode | null`
  - `findParent(root: MindNode, id: string): MindNode | null`
  - `freshId(root: MindNode): string` — 取现有 `n<数字>` 的最大值 +1
  - `addChild(root: MindNode, parentId: string, text?: string): { root: MindNode; newId: string }` — 追加为末子；父节点若折叠则自动展开
  - `addSibling(root: MindNode, siblingId: string, text?: string): { root: MindNode; newId: string }` — 插在其后；对根节点调用时等价于 `addChild(root, root.id)`
  - `removeNode(root: MindNode, id: string): { root: MindNode; nextSelectionId: string }` — 连子树一起删；后继选中优先取下一个兄弟，否则上一个兄弟，否则父节点；对根节点调用时原样返回
  - `setText(root: MindNode, id: string, text: string): MindNode`
  - `setMarks(root: MindNode, id: string, marks: Marks): MindNode`
  - `toggleMark(root: MindNode, id: string, patch: Marks): MindNode` — patch 中的字段若与当前值相同则清除，否则设置
  - `moveNode(root: MindNode, id: string, newParentId: string, index: number): MindNode` — 目标是自身或自身后代时原样返回
  - `toggleCollapse(root: MindNode, id: string): MindNode` — 无子节点时原样返回
  - `visibleNodes(root: MindNode): MindNode[]` — 前序，跳过折叠节点的子树
  - `navigate(root: MindNode, id: string, dir: "up" | "down" | "left" | "right"): string | null`

**`navigate` 语义**：`up`/`down` 在同层兄弟间移动（到边界返回 null）；`left` 到父节点（父是根时也返回根 id）；`right` 到第一个子节点（折叠或无子节点时返回 null）。

- [ ] **Step 1: 写失败测试 `tests/tree-ops.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import {
  addChild,
  addSibling,
  findNode,
  findParent,
  freshId,
  moveNode,
  navigate,
  removeNode,
  setMarks,
  setText,
  toggleCollapse,
  toggleMark,
  visibleNodes,
} from "../src/model/tree-ops";
import type { MindNode } from "../src/model/types";

/** n0=根 / n1=A / n2=A1 / n3=A2 / n4=B */
function tree(): MindNode {
  return parse("# 根\n\n- A\n  - A1\n  - A2\n- B\n", "x.md").root;
}

describe("查找", () => {
  it("findNode 命中与失配", () => {
    expect(findNode(tree(), "n2")?.text).toBe("A1");
    expect(findNode(tree(), "nope")).toBeNull();
  });

  it("findParent 返回父节点，根节点无父", () => {
    expect(findParent(tree(), "n2")?.text).toBe("A");
    expect(findParent(tree(), "n0")).toBeNull();
  });
});

describe("freshId", () => {
  it("取最大编号 +1", () => {
    expect(freshId(tree())).toBe("n5");
  });
});

describe("addChild", () => {
  it("追加为末子并返回新 id", () => {
    const { root, newId } = addChild(tree(), "n1", "新节点");
    expect(newId).toBe("n5");
    expect(findNode(root, "n1")?.children.map((c) => c.text)).toEqual([
      "A1", "A2", "新节点",
    ]);
  });

  it("不修改原树", () => {
    const original = tree();
    addChild(original, "n1", "x");
    expect(findNode(original, "n1")?.children).toHaveLength(2);
  });

  it("父节点折叠时自动展开", () => {
    const collapsed = toggleCollapse(tree(), "n1");
    expect(findNode(collapsed, "n1")?.collapsed).toBe(true);
    const { root } = addChild(collapsed, "n1", "x");
    expect(findNode(root, "n1")?.collapsed).toBe(false);
  });

  it("默认文本为空串", () => {
    const { root, newId } = addChild(tree(), "n1");
    expect(findNode(root, newId)?.text).toBe("");
  });
});

describe("addSibling", () => {
  it("插在目标节点之后", () => {
    const { root } = addSibling(tree(), "n2", "新");
    expect(findNode(root, "n1")?.children.map((c) => c.text)).toEqual([
      "A1", "新", "A2",
    ]);
  });

  it("对根节点调用时等价于加子节点", () => {
    const { root } = addSibling(tree(), "n0", "新");
    expect(root.children.map((c) => c.text)).toEqual(["A", "B", "新"]);
  });
});

describe("removeNode", () => {
  it("删除节点及其子树", () => {
    const { root } = removeNode(tree(), "n1");
    expect(root.children.map((c) => c.text)).toEqual(["B"]);
  });

  it("后继选中取下一个兄弟", () => {
    expect(removeNode(tree(), "n2").nextSelectionId).toBe("n3");
  });

  it("无下一个兄弟时取上一个兄弟", () => {
    expect(removeNode(tree(), "n3").nextSelectionId).toBe("n2");
  });

  it("无兄弟时取父节点", () => {
    const { root } = removeNode(tree(), "n3");
    expect(removeNode(root, "n2").nextSelectionId).toBe("n1");
  });

  it("对根节点调用时原样返回", () => {
    const original = tree();
    const { root, nextSelectionId } = removeNode(original, "n0");
    expect(root).toBe(original);
    expect(nextSelectionId).toBe("n0");
  });
});

describe("setText / setMarks / toggleMark", () => {
  it("setText 改文本", () => {
    expect(findNode(setText(tree(), "n2", "改了"), "n2")?.text).toBe("改了");
  });

  it("setMarks 整体替换", () => {
    const root = setMarks(tree(), "n2", { priority: 3 });
    expect(findNode(root, "n2")?.marks).toEqual({ priority: 3 });
  });

  it("toggleMark 首次设置", () => {
    const root = toggleMark(tree(), "n2", { priority: 1 });
    expect(findNode(root, "n2")?.marks).toEqual({ priority: 1 });
  });

  it("toggleMark 同值再点即清除", () => {
    const once = toggleMark(tree(), "n2", { priority: 1 });
    const twice = toggleMark(once, "n2", { priority: 1 });
    expect(findNode(twice, "n2")?.marks).toEqual({});
  });

  it("toggleMark 异值则替换", () => {
    const once = toggleMark(tree(), "n2", { priority: 1 });
    const twice = toggleMark(once, "n2", { priority: 5 });
    expect(findNode(twice, "n2")?.marks).toEqual({ priority: 5 });
  });

  it("toggleMark 只影响 patch 里的字段", () => {
    const withBoth = setMarks(tree(), "n2", { priority: 1, progress: 50 });
    const toggled = toggleMark(withBoth, "n2", { priority: 1 });
    expect(findNode(toggled, "n2")?.marks).toEqual({ progress: 50 });
  });
});

describe("moveNode", () => {
  it("移动到另一个父节点的指定位置", () => {
    const root = moveNode(tree(), "n2", "n4", 0);
    expect(findNode(root, "n1")?.children.map((c) => c.text)).toEqual(["A2"]);
    expect(findNode(root, "n4")?.children.map((c) => c.text)).toEqual(["A1"]);
  });

  it("同父内重排", () => {
    const root = moveNode(tree(), "n3", "n1", 0);
    expect(findNode(root, "n1")?.children.map((c) => c.text)).toEqual([
      "A2", "A1",
    ]);
  });

  it("移到自身后代时原样返回", () => {
    const original = tree();
    expect(moveNode(original, "n1", "n2", 0)).toBe(original);
  });

  it("移到自身时原样返回", () => {
    const original = tree();
    expect(moveNode(original, "n1", "n1", 0)).toBe(original);
  });

  it("移动根节点时原样返回", () => {
    const original = tree();
    expect(moveNode(original, "n0", "n1", 0)).toBe(original);
  });
});

describe("toggleCollapse / visibleNodes", () => {
  it("折叠后其子树不可见", () => {
    const root = toggleCollapse(tree(), "n1");
    expect(visibleNodes(root).map((n) => n.text)).toEqual(["根", "A", "B"]);
  });

  it("默认全部可见", () => {
    expect(visibleNodes(tree()).map((n) => n.text)).toEqual([
      "根", "A", "A1", "A2", "B",
    ]);
  });

  it("叶子节点不可折叠", () => {
    const original = tree();
    expect(toggleCollapse(original, "n2")).toBe(original);
  });
});

describe("navigate", () => {
  it("up/down 在同层兄弟间移动", () => {
    expect(navigate(tree(), "n2", "down")).toBe("n3");
    expect(navigate(tree(), "n3", "up")).toBe("n2");
  });

  it("到边界返回 null", () => {
    expect(navigate(tree(), "n2", "up")).toBeNull();
    expect(navigate(tree(), "n3", "down")).toBeNull();
  });

  it("left 到父节点", () => {
    expect(navigate(tree(), "n2", "left")).toBe("n1");
    expect(navigate(tree(), "n1", "left")).toBe("n0");
  });

  it("right 到第一个子节点", () => {
    expect(navigate(tree(), "n1", "right")).toBe("n2");
  });

  it("折叠或无子节点时 right 返回 null", () => {
    expect(navigate(tree(), "n2", "right")).toBeNull();
    expect(navigate(toggleCollapse(tree(), "n1"), "n1", "right")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/tree-ops.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../src/model/tree-ops"`

- [ ] **Step 3: 写实现 `src/model/tree-ops.ts`**

```ts
import type { Marks, MindNode } from "./types";

export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found !== null) return found;
  }
  return null;
}

export function findParent(root: MindNode, id: string): MindNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found !== null) return found;
  }
  return null;
}

/** 收集所有 id，取 `n<数字>` 的最大值 +1。 */
export function freshId(root: MindNode): string {
  let max = -1;
  const walk = (node: MindNode): void => {
    const match = /^n(\d+)$/.exec(node.id);
    if (match !== null) max = Math.max(max, Number(match[1]));
    node.children.forEach(walk);
  };
  walk(root);
  return `n${max + 1}`;
}

function makeNode(id: string, text: string): MindNode {
  return { id, text, marks: {}, children: [], collapsed: false, continuation: [] };
}

/** 对树做一次映射式重建；`fn` 返回 null 表示该节点不变。 */
function mapTree(
  node: MindNode,
  fn: (node: MindNode) => MindNode | null,
): MindNode {
  const replaced = fn(node);
  const base = replaced ?? node;
  return { ...base, children: base.children.map((c) => mapTree(c, fn)) };
}

export function addChild(
  root: MindNode,
  parentId: string,
  text = "",
): { root: MindNode; newId: string } {
  const newId = freshId(root);
  const child = makeNode(newId, text);
  const next = mapTree(root, (node) =>
    node.id === parentId
      ? { ...node, collapsed: false, children: [...node.children, child] }
      : null,
  );
  return { root: next, newId };
}

export function addSibling(
  root: MindNode,
  siblingId: string,
  text = "",
): { root: MindNode; newId: string } {
  if (siblingId === root.id) return addChild(root, root.id, text);

  const newId = freshId(root);
  const sibling = makeNode(newId, text);
  const next = mapTree(root, (node) => {
    const index = node.children.findIndex((c) => c.id === siblingId);
    if (index < 0) return null;
    const children = [...node.children];
    children.splice(index + 1, 0, sibling);
    return { ...node, children };
  });
  return { root: next, newId };
}

export function removeNode(
  root: MindNode,
  id: string,
): { root: MindNode; nextSelectionId: string } {
  if (id === root.id) return { root, nextSelectionId: root.id };

  const parent = findParent(root, id);
  if (parent === null) return { root, nextSelectionId: root.id };

  const index = parent.children.findIndex((c) => c.id === id);
  const siblings = parent.children;
  const nextSelectionId =
    siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? parent.id;

  const next = mapTree(root, (node) =>
    node.id === parent.id
      ? { ...node, children: node.children.filter((c) => c.id !== id) }
      : null,
  );
  return { root: next, nextSelectionId };
}

export function setText(root: MindNode, id: string, text: string): MindNode {
  return mapTree(root, (node) => (node.id === id ? { ...node, text } : null));
}

export function setMarks(root: MindNode, id: string, marks: Marks): MindNode {
  return mapTree(root, (node) =>
    node.id === id ? { ...node, marks: { ...marks } } : null,
  );
}

/** patch 中的字段与当前值相同则清除，否则设置。只影响 patch 涉及的字段。 */
export function toggleMark(root: MindNode, id: string, patch: Marks): MindNode {
  return mapTree(root, (node) => {
    if (node.id !== id) return null;
    const marks: Marks = { ...node.marks };
    for (const key of Object.keys(patch) as (keyof Marks)[]) {
      if (marks[key] === patch[key]) {
        delete marks[key];
      } else {
        // 三类标记类型各不相同，按键逐个赋值以保持类型安全。
        if (key === "priority") marks.priority = patch.priority;
        if (key === "progress") marks.progress = patch.progress;
        if (key === "flag") marks.flag = patch.flag;
      }
    }
    return { ...node, marks };
  });
}

function isDescendant(root: MindNode, ancestorId: string, id: string): boolean {
  const ancestor = findNode(root, ancestorId);
  if (ancestor === null) return false;
  return findNode(ancestor, id) !== null && ancestorId !== id;
}

export function moveNode(
  root: MindNode,
  id: string,
  newParentId: string,
  index: number,
): MindNode {
  if (id === root.id) return root;
  if (id === newParentId) return root;
  if (isDescendant(root, id, newParentId)) return root;

  const moving = findNode(root, id);
  if (moving === null) return root;

  const detached = mapTree(root, (node) =>
    node.children.some((c) => c.id === id)
      ? { ...node, children: node.children.filter((c) => c.id !== id) }
      : null,
  );

  return mapTree(detached, (node) => {
    if (node.id !== newParentId) return null;
    const children = [...node.children];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, moving);
    return { ...node, collapsed: false, children };
  });
}

export function toggleCollapse(root: MindNode, id: string): MindNode {
  const target = findNode(root, id);
  if (target === null || target.children.length === 0) return root;
  return mapTree(root, (node) =>
    node.id === id ? { ...node, collapsed: !node.collapsed } : null,
  );
}

/** 前序遍历，跳过折叠节点的子树。 */
export function visibleNodes(root: MindNode): MindNode[] {
  const result: MindNode[] = [];
  const walk = (node: MindNode): void => {
    result.push(node);
    if (!node.collapsed) node.children.forEach(walk);
  };
  walk(root);
  return result;
}

export function navigate(
  root: MindNode,
  id: string,
  dir: "up" | "down" | "left" | "right",
): string | null {
  const node = findNode(root, id);
  if (node === null) return null;

  if (dir === "right") {
    if (node.collapsed || node.children.length === 0) return null;
    return node.children[0].id;
  }

  const parent = findParent(root, id);
  if (parent === null) return null;
  if (dir === "left") return parent.id;

  const index = parent.children.findIndex((c) => c.id === id);
  const sibling = parent.children[dir === "up" ? index - 1 : index + 1];
  return sibling?.id ?? null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run && npx tsc --noEmit && node scripts/check-purity.mjs`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/model/tree-ops.ts tests/tree-ops.test.ts
git commit -m "feat: 树的不可变操作与键盘导航"
```

---
### Task 7: 布局算法

**Files:**
- Create: `src/view/layout.ts`
- Test: `tests/layout.test.ts`

**Interfaces:**
- Consumes: `MindNode` from `../model/types`
- Produces:
  - `interface Size { width: number; height: number }`
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `interface Edge { fromId: string; toId: string; path: string; depth: number; branch: number }`
  - `interface LayoutOptions { hGap: number; vGap: number; padding: number }`
  - `interface LayoutResult { rects: Map<string, Rect>; edges: Edge[]; width: number; height: number }`
  - `layout(root: MindNode, sizes: Map<string, Size>, opts: LayoutOptions): LayoutResult`
  - `DEFAULT_LAYOUT_OPTIONS: LayoutOptions` = `{ hGap: 56, vGap: 14, padding: 48 }`

**算法**：两趟。先后序算每棵子树的垂直跨度 `span`（折叠或叶子取自身高度；否则取自身高度与子跨度之和的较大值）；再前序分配坐标（子节点 x = 父节点右边缘 + hGap；父节点垂直居中于自身 span，子节点整体居中于同一 span）。该规则保证任意两节点矩形不重叠。

**连线**：三次贝塞尔，起点为父节点右下角，终点为子节点左下角（对应截图中连到文字下划线的效果），控制点横坐标取两端中点。`branch` 为该边所属的根节点子分支序号（用于配色），`depth` 为子节点深度（用于线宽）。

- [ ] **Step 1: 写失败测试 `tests/layout.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parse } from "../src/model/parser";
import { toggleCollapse, visibleNodes } from "../src/model/tree-ops";
import {
  DEFAULT_LAYOUT_OPTIONS,
  layout,
  type Rect,
  type Size,
} from "../src/view/layout";
import type { MindNode } from "../src/model/types";

/** n0=根 / n1=A / n2=A1 / n3=A2 / n4=B */
function tree(): MindNode {
  return parse("# 根\n\n- A\n  - A1\n  - A2\n- B\n", "x.md").root;
}

/** 给每个节点一个固定尺寸，便于断言。 */
function sizes(root: MindNode, size: Size = { width: 100, height: 20 }) {
  const map = new Map<string, Size>();
  for (const node of visibleNodes(root)) map.set(node.id, { ...size });
  return map;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("layout", () => {
  it("为每个可见节点产出矩形", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect([...result.rects.keys()].sort()).toEqual([
      "n0", "n1", "n2", "n3", "n4",
    ]);
  });

  it("任意两个节点矩形不重叠", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    const rects = [...result.rects.values()];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j]), `${i} vs ${j}`).toBe(false);
      }
    }
  });

  it("子节点 x = 父节点右边缘 + hGap", () => {
    const root = tree();
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, hGap: 50 };
    const result = layout(root, sizes(root), opts);
    const parent = result.rects.get("n1")!;
    const child = result.rects.get("n2")!;
    expect(child.x).toBe(parent.x + parent.width + 50);
  });

  it("父节点垂直居中于其子节点跨度", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    const parent = result.rects.get("n1")!;
    const first = result.rects.get("n2")!;
    const last = result.rects.get("n3")!;
    const parentCenter = parent.y + parent.height / 2;
    const childrenCenter = (first.y + (last.y + last.height)) / 2;
    expect(parentCenter).toBeCloseTo(childrenCenter, 6);
  });

  it("兄弟节点之间的垂直间距等于 vGap", () => {
    const root = tree();
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, vGap: 10 };
    const result = layout(root, sizes(root), opts);
    const a1 = result.rects.get("n2")!;
    const a2 = result.rects.get("n3")!;
    expect(a2.y - (a1.y + a1.height)).toBe(10);
  });

  it("折叠节点的子树不参与布局也不占空间", () => {
    const root = toggleCollapse(tree(), "n1");
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(result.rects.has("n2")).toBe(false);
    const a = result.rects.get("n1")!;
    const b = result.rects.get("n4")!;
    expect(b.y - (a.y + a.height)).toBe(DEFAULT_LAYOUT_OPTIONS.vGap);
  });

  it("缺失尺寸的节点按 0 计并仍产出矩形", () => {
    const root = tree();
    const partial = sizes(root);
    partial.delete("n3");
    const result = layout(root, partial, DEFAULT_LAYOUT_OPTIONS);
    expect(result.rects.get("n3")).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      width: 0,
      height: 0,
    });
  });

  it("画布尺寸包含内边距", () => {
    const root = tree();
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, padding: 30 };
    const result = layout(root, sizes(root), opts);
    const maxRight = Math.max(
      ...[...result.rects.values()].map((r) => r.x + r.width),
    );
    expect(result.width).toBe(maxRight + 30);
  });

  it("所有节点坐标不小于内边距", () => {
    const root = tree();
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, padding: 30 };
    const result = layout(root, sizes(root), opts);
    for (const rect of result.rects.values()) {
      expect(rect.x).toBeGreaterThanOrEqual(30);
      expect(rect.y).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("layout 连线", () => {
  it("每条父子关系产出一条边", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(
      result.edges.map((e) => `${e.fromId}->${e.toId}`).sort(),
    ).toEqual(["n0->n1", "n0->n4", "n1->n2", "n1->n3"]);
  });

  it("路径从父节点右下角连到子节点左下角", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    const edge = result.edges.find((e) => e.toId === "n2")!;
    const parent = result.rects.get("n1")!;
    const child = result.rects.get("n2")!;
    const x0 = parent.x + parent.width;
    const y0 = parent.y + parent.height;
    const x1 = child.x;
    const y1 = child.y + child.height;
    const mx = (x0 + x1) / 2;
    expect(edge.path).toBe(`M ${x0} ${y0} C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`);
  });

  it("branch 为所属根分支序号，depth 为子节点深度", () => {
    const root = tree();
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(result.edges.find((e) => e.toId === "n1")).toMatchObject({
      branch: 0,
      depth: 1,
    });
    expect(result.edges.find((e) => e.toId === "n2")).toMatchObject({
      branch: 0,
      depth: 2,
    });
    expect(result.edges.find((e) => e.toId === "n4")).toMatchObject({
      branch: 1,
      depth: 1,
    });
  });

  it("折叠节点不产出其子树的边", () => {
    const root = toggleCollapse(tree(), "n1");
    const result = layout(root, sizes(root), DEFAULT_LAYOUT_OPTIONS);
    expect(result.edges.map((e) => e.toId).sort()).toEqual(["n1", "n4"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/layout.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../src/view/layout"`

- [ ] **Step 3: 写实现 `src/view/layout.ts`**

```ts
import type { MindNode } from "../model/types";

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Edge {
  fromId: string;
  toId: string;
  /** SVG path 的 d 属性 */
  path: string;
  /** 子节点深度，根的直接子节点为 1 */
  depth: number;
  /** 所属根分支序号，用于配色 */
  branch: number;
}

export interface LayoutOptions {
  hGap: number;
  vGap: number;
  padding: number;
}

export interface LayoutResult {
  rects: Map<string, Rect>;
  edges: Edge[];
  width: number;
  height: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  hGap: 56,
  vGap: 14,
  padding: 48,
};

const ZERO: Size = { width: 0, height: 0 };

function hasVisibleChildren(node: MindNode): boolean {
  return !node.collapsed && node.children.length > 0;
}

/** 后序计算每棵子树的垂直跨度。 */
function computeSpans(
  root: MindNode,
  sizes: Map<string, Size>,
  vGap: number,
): Map<string, number> {
  const spans = new Map<string, number>();

  const walk = (node: MindNode): number => {
    const own = (sizes.get(node.id) ?? ZERO).height;
    if (!hasVisibleChildren(node)) {
      spans.set(node.id, own);
      return own;
    }

    let childrenSpan = 0;
    node.children.forEach((child, i) => {
      childrenSpan += walk(child) + (i > 0 ? vGap : 0);
    });

    const span = Math.max(own, childrenSpan);
    spans.set(node.id, span);
    return span;
  };

  walk(root);
  return spans;
}

function bezier(from: Rect, to: Rect): string {
  const x0 = from.x + from.width;
  const y0 = from.y + from.height;
  const x1 = to.x;
  const y1 = to.y + to.height;
  const mx = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
}

/**
 * 把可见的思维导图树布局为坐标与连线。根节点在左，整树向右展开。
 * 缺失尺寸的节点按 0×0 处理，仍会产出矩形，避免测量竞态导致节点消失。
 */
export function layout(
  root: MindNode,
  sizes: Map<string, Size>,
  opts: LayoutOptions,
): LayoutResult {
  const spans = computeSpans(root, sizes, opts.vGap);
  const rects = new Map<string, Rect>();
  const edges: Edge[] = [];

  const place = (
    node: MindNode,
    x: number,
    top: number,
    depth: number,
    branch: number,
  ): void => {
    const size = sizes.get(node.id) ?? ZERO;
    const span = spans.get(node.id) ?? size.height;

    rects.set(node.id, {
      x,
      y: top + (span - size.height) / 2,
      width: size.width,
      height: size.height,
    });

    if (!hasVisibleChildren(node)) return;

    let childrenSpan = 0;
    node.children.forEach((child, i) => {
      childrenSpan += (spans.get(child.id) ?? 0) + (i > 0 ? opts.vGap : 0);
    });

    const childX = x + size.width + opts.hGap;
    let childTop = top + (span - childrenSpan) / 2;

    for (const [i, child] of node.children.entries()) {
      const childBranch = depth === 0 ? i : branch;
      place(child, childX, childTop, depth + 1, childBranch);
      childTop += (spans.get(child.id) ?? 0) + opts.vGap;
    }
  };

  place(root, opts.padding, opts.padding, 0, 0);

  // 连线需要两端矩形都已就位，因此单独遍历一次。
  const collectEdges = (node: MindNode, depth: number, branch: number): void => {
    if (!hasVisibleChildren(node)) return;
    const from = rects.get(node.id);
    if (from === undefined) return;

    node.children.forEach((child, i) => {
      const to = rects.get(child.id);
      if (to === undefined) return;
      const childBranch = depth === 0 ? i : branch;
      edges.push({
        fromId: node.id,
        toId: child.id,
        path: bezier(from, to),
        depth: depth + 1,
        branch: childBranch,
      });
      collectEdges(child, depth + 1, childBranch);
    });
  };

  collectEdges(root, 0, 0);

  let maxRight = 0;
  let maxBottom = 0;
  for (const rect of rects.values()) {
    maxRight = Math.max(maxRight, rect.x + rect.width);
    maxBottom = Math.max(maxBottom, rect.y + rect.height);
  }

  return {
    rects,
    edges,
    width: maxRight + opts.padding,
    height: maxBottom + opts.padding,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run && npx tsc --noEmit && node scripts/check-purity.mjs`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/view/layout.ts tests/layout.test.ts
git commit -m "feat: 思维导图布局算法"
```

---
### Task 8: 插件骨架、视图注册与文件读写闭环

**Files:**
- Create: `src/main.ts`, `src/settings.ts`, `src/view.ts`, `src/view/dom.ts`
- Test: 手工验证（见 Step 8）

**Interfaces:**
- Consumes: `parse` / `serialize` / `collapse-state` / `tree-ops`
- Produces:
  - `MINDMAP_VIEW_TYPE = "mindmap-view"`
  - `class MindmapView extends TextFileView`，暴露 `getDoc(): MindDoc | null`、`applyDoc(next: MindDoc): void`（更新内存文档、重绘、防抖保存）
  - `class MindmapSettingTab extends PluginSettingTab`
  - `interface MindmapSettings { autoOpen: boolean }`，`DEFAULT_SETTINGS`
  - `src/view/dom.ts`：`el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: HTMLElement): HTMLElementTagNameMap[K]`、`clear(node: Element): void`、`svgEl<K extends keyof SVGElementTagNameMap>(tag: K, className?: string, parent?: Element): SVGElementTagNameMap[K]`

**本任务的交付标准**：能把 `.md` 以思维导图视图打开，画布上以缩进文本列出解析出的树；能切回源码；在视图里触发一次 `applyDoc` 后文件被正确写回；外部修改文件后画布刷新。真实的节点/连线渲染在 Task 9。

- [ ] **Step 1: 写 DOM 小工具 `src/view/dom.ts`**

```ts
const SVG_NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (parent !== undefined) parent.appendChild(node);
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (className !== undefined) node.setAttribute("class", className);
  if (parent !== undefined) parent.appendChild(node);
  return node as SVGElementTagNameMap[K];
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}
```

- [ ] **Step 2: 写设置 `src/settings.ts`**

```ts
import { PluginSettingTab, Setting, type App } from "obsidian";
import type MindmapPlugin from "./main";

export interface MindmapSettings {
  /** 带 `mindmap: true` 的文件是否自动用思维导图视图打开 */
  autoOpen: boolean;
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  autoOpen: true,
};

export class MindmapSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MindmapPlugin) {
    super(app, plugin);
  }

  override display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("自动以思维导图打开")
      .setDesc("文件 frontmatter 含 mindmap: true 时，打开即进入思维导图视图。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOpen).onChange(async (value) => {
          this.plugin.settings.autoOpen = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
```

- [ ] **Step 3: 写视图 `src/view.ts`**

```ts
import { TextFileView, type WorkspaceLeaf } from "obsidian";
import {
  applyCollapsedPaths,
  collectCollapsedPaths,
  readCollapsed,
  writeCollapsed,
} from "./model/collapse-state";
import { parse } from "./model/parser";
import { serialize } from "./model/serializer";
import type { MindDoc } from "./model/types";
import { clear, el } from "./view/dom";

export const MINDMAP_VIEW_TYPE = "mindmap-view";

const SAVE_DEBOUNCE_MS = 400;

export class MindmapView extends TextFileView {
  private doc: MindDoc | null = null;
  private readonly root: HTMLElement;
  private saveTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.root = el("div", "mindmap-view", this.contentEl);
  }

  override getViewType(): string {
    return MINDMAP_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "思维导图";
  }

  override getIcon(): string {
    return "git-fork";
  }

  getDoc(): MindDoc | null {
    return this.doc;
  }

  /** Obsidian 读取文件内容后调用。 */
  override setViewData(data: string, _clear: boolean): void {
    const fileName = this.file?.name ?? "未命名.md";
    const parsed = parse(data, fileName);
    this.doc = {
      ...parsed,
      root: applyCollapsedPaths(parsed.root, readCollapsed(parsed.frontmatter)),
    };
    this.render();
  }

  /** Obsidian 保存时调用，必须返回当前完整文件内容。 */
  override getViewData(): string {
    if (this.doc === null) return this.data;
    return serialize(this.withCollapsedInFrontmatter(this.doc));
  }

  override clear(): void {
    this.doc = null;
    clear(this.root);
  }

  /** 更新内存文档、重绘、防抖写回文件。 */
  applyDoc(next: MindDoc): void {
    this.doc = next;
    this.render();
    this.scheduleSave();
  }

  /** 把当前折叠状态写进 frontmatter 的副本，不改动内存文档。 */
  private withCollapsedInFrontmatter(doc: MindDoc): MindDoc {
    return {
      ...doc,
      frontmatter: writeCollapsed(doc.frontmatter, collectCollapsedPaths(doc.root)),
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  override async onClose(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.save();
    }
  }

  /** Task 9 会用真实渲染替换这里的临时文本输出。 */
  private render(): void {
    clear(this.root);
    if (this.doc === null) return;

    const pre = el("pre", "mindmap-debug", this.root);
    const lines: string[] = [];
    const walk = (node: MindDoc["root"], depth: number): void => {
      lines.push(`${"  ".repeat(depth)}${node.id} ${node.text}`);
      if (!node.collapsed) node.children.forEach((c) => walk(c, depth + 1));
    };
    walk(this.doc.root, 0);
    pre.textContent = lines.join("\n");
  }
}
```

- [ ] **Step 4: 写入口 `src/main.ts`**

```ts
import { Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  MindmapSettingTab,
  type MindmapSettings,
} from "./settings";
import { MINDMAP_VIEW_TYPE, MindmapView } from "./view";

export default class MindmapPlugin extends Plugin {
  settings: MindmapSettings = { ...DEFAULT_SETTINGS };

  /** 正在切换视图的文件路径，避免 file-open 事件递归。 */
  private readonly flipping = new Set<string>();

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      MINDMAP_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MindmapView(leaf),
    );

    this.addSettingTab(new MindmapSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-mindmap-view",
      name: "切换思维导图 / 源码视图",
      checkCallback: (checking: boolean) => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const file = this.app.workspace.getActiveFile();
        if (leaf === null || file === null || file.extension !== "md") return false;
        if (checking) return true;
        void this.toggleView(leaf, file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle("以思维导图打开")
            .setIcon("git-fork")
            .onClick(() => {
              const leaf = this.app.workspace.getLeaf(false);
              void leaf.setViewState({
                type: MINDMAP_VIEW_TYPE,
                state: { file: file.path },
                active: true,
              });
            }),
        );
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!this.settings.autoOpen || file === null) return;
        if (file.extension !== "md" || this.flipping.has(file.path)) return;

        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf === null || leaf.view.getViewType() !== "markdown") return;

        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (frontmatter?.mindmap !== true) return;

        this.flipping.add(file.path);
        void leaf
          .setViewState({
            type: MINDMAP_VIEW_TYPE,
            state: { file: file.path },
            active: true,
          })
          .finally(() => this.flipping.delete(file.path));
      }),
    );
  }

  private async toggleView(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    const isMindmap = leaf.view.getViewType() === MINDMAP_VIEW_TYPE;
    this.flipping.add(file.path);
    try {
      await leaf.setViewState({
        type: isMindmap ? "markdown" : MINDMAP_VIEW_TYPE,
        state: isMindmap
          ? { file: file.path, mode: "source" }
          : { file: file.path },
        active: true,
      });
    } catch (error) {
      new Notice(`切换视图失败：${String(error)}`);
    } finally {
      this.flipping.delete(file.path);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 5: 给调试输出加样式（追加到 `styles.css`）**

```css
.mindmap-debug {
  margin: 0;
  padding: 16px;
  font-family: var(--font-monospace);
  font-size: 13px;
  color: var(--text-normal);
  white-space: pre;
}
```

- [ ] **Step 6: 构建并校验**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 全部通过，项目根目录生成 `main.js`

- [ ] **Step 7: 建测试 vault 与热重载软链**

```bash
mkdir -p test-vault/.obsidian/plugins/obsidian-mindmap
ln -sf "$PWD/main.js" test-vault/.obsidian/plugins/obsidian-mindmap/main.js
ln -sf "$PWD/manifest.json" test-vault/.obsidian/plugins/obsidian-mindmap/manifest.json
ln -sf "$PWD/styles.css" test-vault/.obsidian/plugins/obsidian-mindmap/styles.css
cat > test-vault/工作内容.md <<'MD'
---
mindmap: true
---

# 工作内容

- 呼叫中心
  - (p1) 管理向
    - 任务安排
    - OKR等问题思考
  - 业务向
    - (p1) 看系统的数据：报错，报警，监控
      - 适当减少精力，培养组员
      - 但是这是一个敏感度的事，需要时不时看看暴露问题
    - (p3 30%) 部分开发自测
    - (p2) 回答各类业务问题
- WP
  - (p1) 管理向
    - (p2) 任务安排
  - (flag:red) 理解业务流程
MD
echo 'test-vault/' >> .gitignore
```

把 `test-vault` 作为 vault 在 Obsidian 中打开，在社区插件里启用「思维导图」。

- [ ] **Step 8: 手工验证清单（逐项确认，不要跳过）**

1. 打开 `工作内容.md` → 自动进入思维导图视图，画布显示缩进文本树，层级与文件一致，标记文字已从节点文本中剥离。
2. 命令面板执行「切换思维导图 / 源码视图」→ 回到源码，内容与原文件完全一致（无多余空行、frontmatter 未变）。
3. 再次执行该命令 → 回到导图视图。
4. 在源码模式下改一个节点文字并保存 → 切回导图视图，文字已更新。
5. 关闭标签页再打开，无报错；开发者控制台无异常输出。
6. 关闭设置项「自动以思维导图打开」→ 重新打开文件应停留在源码模式；用文件右键菜单「以思维导图打开」仍可进入。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: 插件骨架、视图注册与文件读写闭环"
```

---
### Task 9: 节点与连线渲染

**Files:**
- Create: `src/view/node-el.ts`, `src/view/measure.ts`, `src/view/renderer.ts`
- Modify: `src/view.ts`（用真实渲染替换 Task 8 的调试文本）, `styles.css`（整体替换）
- Test: 手工验证（见 Step 7）

**Interfaces:**
- Consumes: `MindNode`、`Marks`、`FlagColor` from `../model/types`；`progressStage` from `../model/marks`；`layout`、`Size`、`LayoutResult`、`DEFAULT_LAYOUT_OPTIONS` from `./layout`；`visibleNodes` from `../model/tree-ops`
- Produces:
  - `src/view/node-el.ts`：`buildNodeEl(node: MindNode, depth: number, branch: number, isRoot: boolean): HTMLElement`
  - `src/view/measure.ts`：`measureAll(elements: Map<string, HTMLElement>, host: HTMLElement): Map<string, Size>` — 把元素临时挂到隐藏容器读尺寸，读完从隐藏容器移除并返回尺寸表
  - `src/view/renderer.ts`：
    - `interface RenderLayers { canvas: HTMLElement; edges: SVGSVGElement; nodes: HTMLElement; measureHost: HTMLElement }`
    - `createLayers(root: HTMLElement): RenderLayers`
    - `renderMindmap(layers: RenderLayers, root: MindNode, selectedId: string | null): LayoutResult`

**分支配色**：`branch` 取模 7 映射到 CSS 变量 `--mm-branch-1` … `--mm-branch-7`，通过类名 `mm-branch-<1..7>` 施加，TS 不出现颜色字面量。

- [ ] **Step 1: 写节点元素构造 `src/view/node-el.ts`**

```ts
import { progressStage } from "../model/marks";
import type { FlagColor, Marks, MindNode } from "../model/types";
import { el, svgEl } from "./dom";

/** branch 序号 → CSS 类名后缀（1–7 循环）。 */
export function branchClass(branch: number): string {
  return `mm-branch-${(((branch % 7) + 7) % 7) + 1}`;
}

/** 深度 → CSS 类名后缀，3 层以下统一。 */
function depthClass(depth: number): string {
  return `mm-depth-${Math.min(depth, 3)}`;
}

const PROGRESS_FRACTIONS: readonly number[] = [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1];

/** 以 12 点为起点、顺时针的扇形路径。 */
function piePath(fraction: number, cx: number, cy: number, r: number): string {
  const angle = fraction * Math.PI * 2;
  const x = cx + r * Math.sin(angle);
  const y = cy - r * Math.cos(angle);
  const largeArc = fraction > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y} Z`;
}

function buildProgress(progress: number, parent: HTMLElement): void {
  const stage = progressStage(progress);
  const wrap = el("span", "mm-mark mm-progress", parent);
  wrap.title = `进度 ${progress}%`;

  const svg = svgEl("svg", "mm-progress-svg", wrap);
  svg.setAttribute("viewBox", "0 0 16 16");

  const ring = svgEl("circle", "mm-progress-ring", svg);
  ring.setAttribute("cx", "8");
  ring.setAttribute("cy", "8");
  ring.setAttribute("r", "7");

  if (stage === 6) {
    const check = svgEl("path", "mm-progress-check", svg);
    check.setAttribute("d", "M 4.5 8.5 L 7 11 L 11.5 5.5");
    return;
  }
  if (stage === 0) {
    const hands = svgEl("path", "mm-progress-hands", svg);
    hands.setAttribute("d", "M 8 4.5 L 8 8 L 10.5 9.5");
    return;
  }
  const wedge = svgEl("path", "mm-progress-wedge", svg);
  wedge.setAttribute("d", piePath(PROGRESS_FRACTIONS[stage], 8, 8, 7));
}

function buildFlag(flag: FlagColor, parent: HTMLElement): void {
  const wrap = el("span", `mm-mark mm-flag mm-flag-${flag}`, parent);
  wrap.title = `旗帜 ${flag}`;
  const svg = svgEl("svg", "mm-flag-svg", wrap);
  svg.setAttribute("viewBox", "0 0 16 16");
  const path = svgEl("path", "mm-flag-glyph", svg);
  path.setAttribute("d", "M 5 3 L 5 13 M 5 3.5 L 12 3.5 L 10.5 6.5 L 12 9.5 L 5 9.5");
}

function buildMarks(marks: Marks, parent: HTMLElement): void {
  if (marks.priority === undefined && marks.progress === undefined && marks.flag === undefined) {
    return;
  }
  const wrap = el("span", "mm-marks", parent);

  if (marks.priority !== undefined) {
    const badge = el("span", `mm-mark mm-priority mm-priority-${marks.priority}`, wrap);
    badge.textContent = String(marks.priority);
    badge.title = `优先级 ${marks.priority}`;
  }
  if (marks.progress !== undefined) buildProgress(marks.progress, wrap);
  if (marks.flag !== undefined) buildFlag(marks.flag, wrap);
}

/**
 * 构造一个节点的 DOM。返回的元素尚未定位，由 renderer 负责摆放。
 * `data-id` 是交互层做事件委派的唯一依据。
 */
export function buildNodeEl(
  node: MindNode,
  depth: number,
  branch: number,
  isRoot: boolean,
): HTMLElement {
  const classes = ["mm-node", depthClass(depth), branchClass(branch)];
  if (isRoot) classes.push("mm-root");
  if (node.collapsed) classes.push("mm-collapsed");

  const element = el("div", classes.join(" "));
  element.dataset.id = node.id;

  buildMarks(node.marks, element);

  const text = el("span", "mm-text", element);
  text.textContent = node.text === "" ? " " : node.text;

  if (node.collapsed && node.children.length > 0) {
    const badge = el("span", "mm-collapse-badge", element);
    badge.textContent = String(node.children.length);
    badge.title = `已折叠 ${node.children.length} 个子节点`;
  }

  return element;
}
```

- [ ] **Step 2: 写尺寸测量 `src/view/measure.ts`**

```ts
import type { Size } from "./layout";

/**
 * 把节点元素临时挂到隐藏容器读取尺寸。
 * 读完即从隐藏容器摘下（元素本身保留，交给调用方正式摆放）。
 */
export function measureAll(
  elements: Map<string, HTMLElement>,
  host: HTMLElement,
): Map<string, Size> {
  for (const element of elements.values()) host.appendChild(element);

  const sizes = new Map<string, Size>();
  for (const [id, element] of elements) {
    // 用 getBoundingClientRect 而非 offsetWidth，保留亚像素精度避免布局抖动。
    const rect = element.getBoundingClientRect();
    sizes.set(id, { width: rect.width, height: rect.height });
  }

  for (const element of elements.values()) host.removeChild(element);
  return sizes;
}
```

- [ ] **Step 3: 写渲染器 `src/view/renderer.ts`**

```ts
import { visibleNodes } from "../model/tree-ops";
import type { MindNode } from "../model/types";
import { clear, el, svgEl } from "./dom";
import {
  DEFAULT_LAYOUT_OPTIONS,
  layout,
  type LayoutResult,
  type Size,
} from "./layout";
import { measureAll } from "./measure";
import { branchClass, buildNodeEl } from "./node-el";

export interface RenderLayers {
  measureHost: HTMLElement;
  edges: SVGSVGElement;
  nodes: HTMLElement;
  /** 承载 edges 与 nodes 的可变换容器 */
  canvas: HTMLElement;
}

export function createLayers(root: HTMLElement): RenderLayers {
  const canvas = el("div", "mindmap-canvas", root);
  const edges = svgEl("svg", "mindmap-edges", canvas);
  const nodes = el("div", "mindmap-nodes", canvas);
  const measureHost = el("div", "mindmap-measure", root);
  return { canvas, edges, nodes, measureHost };
}

/** 深度越深线越细。 */
function strokeWidth(depth: number): number {
  return Math.max(1.5, 3 - (depth - 1) * 0.5);
}

interface Placement {
  node: MindNode;
  depth: number;
  branch: number;
}

/** 前序收集可见节点及其深度与所属分支。 */
function collectPlacements(root: MindNode): Placement[] {
  const result: Placement[] = [{ node: root, depth: 0, branch: 0 }];

  const walk = (node: MindNode, depth: number, branch: number): void => {
    if (node.collapsed) return;
    node.children.forEach((child, i) => {
      const childBranch = depth === 0 ? i : branch;
      result.push({ node: child, depth: depth + 1, branch: childBranch });
      walk(child, depth + 1, childBranch);
    });
  };

  walk(root, 0, 0);
  return result;
}

/**
 * 测量 → 布局 → 绘制。返回布局结果供交互层做命中测试与视口自适应。
 */
export function renderMindmap(
  layers: RenderLayers,
  root: MindNode,
  selectedId: string | null,
): LayoutResult {
  const placements = collectPlacements(root);

  const elements = new Map<string, HTMLElement>();
  for (const { node, depth, branch } of placements) {
    elements.set(node.id, buildNodeEl(node, depth, branch, node === root));
  }

  const sizes: Map<string, Size> = measureAll(elements, layers.measureHost);
  const result = layout(root, sizes, DEFAULT_LAYOUT_OPTIONS);

  clear(layers.nodes);
  clear(layers.edges);

  for (const edge of result.edges) {
    const path = svgEl("path", `mm-edge ${branchClass(edge.branch)}`, layers.edges);
    path.setAttribute("d", edge.path);
    path.setAttribute("stroke-width", String(strokeWidth(edge.depth)));
    path.setAttribute("fill", "none");
  }

  for (const [id, element] of elements) {
    const rect = result.rects.get(id);
    if (rect === undefined) continue;
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    if (id === selectedId) element.classList.add("mm-selected");
    layers.nodes.appendChild(element);
  }

  layers.canvas.style.width = `${result.width}px`;
  layers.canvas.style.height = `${result.height}px`;
  layers.edges.setAttribute("width", String(result.width));
  layers.edges.setAttribute("height", String(result.height));
  layers.edges.setAttribute("viewBox", `0 0 ${result.width} ${result.height}`);

  return result;
}
```

- [ ] **Step 4: 在 `src/view.ts` 中接入真实渲染**

把 Task 8 里的临时 `render()` 与相关字段替换为：

```ts
// 顶部 import 追加：
import { createLayers, renderMindmap, type RenderLayers } from "./view/renderer";
import type { LayoutResult } from "./view/layout";
```

```ts
  // 字段：把 `private readonly root: HTMLElement;` 之后追加
  private layers: RenderLayers | null = null;
  private lastLayout: LayoutResult | null = null;
  private selectedId: string | null = null;
```

```ts
  /** 当前布局结果，供 Task 10 起的交互层使用。 */
  getLayout(): LayoutResult | null {
    return this.lastLayout;
  }

  private render(): void {
    if (this.doc === null) {
      if (this.layers !== null) clear(this.root);
      this.layers = null;
      return;
    }
    if (this.layers === null) {
      clear(this.root);
      this.layers = createLayers(this.root);
    }
    this.lastLayout = renderMindmap(this.layers, this.doc.root, this.selectedId);
  }
```

同时把 `clear()` 方法体改为：

```ts
  override clear(): void {
    this.doc = null;
    this.layers = null;
    this.lastLayout = null;
    this.selectedId = null;
    clear(this.root);
  }
```

- [ ] **Step 5: 整体替换 `styles.css`**

```css
/* ---------- 容器与图层 ---------- */

.mindmap-view {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: var(--background-primary);

  --mm-branch-1: #8b5cf6;
  --mm-branch-2: #3b82f6;
  --mm-branch-3: #06b6d4;
  --mm-branch-4: #10b981;
  --mm-branch-5: #f59e0b;
  --mm-branch-6: #ef4444;
  --mm-branch-7: #ec4899;

  --mm-p1: #ef4444;
  --mm-p2: #f97316;
  --mm-p3: #eab308;
  --mm-p-rest: #9ca3af;

  --mm-flag-red: #ef4444;
  --mm-flag-orange: #f97316;
  --mm-flag-yellow: #eab308;
  --mm-flag-green: #22c55e;
  --mm-flag-blue: #3b82f6;
  --mm-flag-purple: #a855f7;
  --mm-flag-gray: #9ca3af;
}

.mindmap-canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.mindmap-edges {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}

.mindmap-nodes {
  position: absolute;
  top: 0;
  left: 0;
}

/* 测量容器：脱离视觉但保留真实排版度量 */
.mindmap-measure {
  position: absolute;
  top: 0;
  left: -99999px;
  visibility: hidden;
  pointer-events: none;
}

/* ---------- 连线 ---------- */

.mm-edge {
  fill: none;
  stroke-linecap: round;
  opacity: 0.85;
}

.mm-edge.mm-branch-1 { stroke: var(--mm-branch-1); }
.mm-edge.mm-branch-2 { stroke: var(--mm-branch-2); }
.mm-edge.mm-branch-3 { stroke: var(--mm-branch-3); }
.mm-edge.mm-branch-4 { stroke: var(--mm-branch-4); }
.mm-edge.mm-branch-5 { stroke: var(--mm-branch-5); }
.mm-edge.mm-branch-6 { stroke: var(--mm-branch-6); }
.mm-edge.mm-branch-7 { stroke: var(--mm-branch-7); }

/* ---------- 节点 ---------- */

.mm-node {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  max-width: 360px;
  padding: 2px 4px 4px;
  color: var(--text-normal);
  font-size: 14px;
  line-height: 1.5;
  white-space: normal;
  overflow-wrap: break-word;
  cursor: default;
  border-radius: 4px;
  transition: background-color 120ms ease;
}

.mm-node:hover {
  background: var(--background-modifier-hover);
}

/* 非根节点的下划线，颜色随分支 */
.mm-node:not(.mm-root) {
  border-bottom: 2px solid var(--mm-line, var(--text-faint));
}

.mm-node.mm-branch-1 { --mm-line: var(--mm-branch-1); }
.mm-node.mm-branch-2 { --mm-line: var(--mm-branch-2); }
.mm-node.mm-branch-3 { --mm-line: var(--mm-branch-3); }
.mm-node.mm-branch-4 { --mm-line: var(--mm-branch-4); }
.mm-node.mm-branch-5 { --mm-line: var(--mm-branch-5); }
.mm-node.mm-branch-6 { --mm-line: var(--mm-branch-6); }
.mm-node.mm-branch-7 { --mm-line: var(--mm-branch-7); }

.mm-node.mm-depth-1 { font-size: 16px; font-weight: 600; }
.mm-node.mm-depth-2 { font-size: 15px; }
.mm-node.mm-depth-3 { font-size: 14px; }

.mm-node.mm-root {
  padding: 8px 14px;
  font-size: 18px;
  font-weight: 600;
  background: var(--background-modifier-hover);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
}

.mm-node.mm-selected {
  background: var(--background-modifier-hover);
  box-shadow: 0 0 0 2px var(--interactive-accent);
}

.mm-text {
  min-width: 1px;
}

.mm-collapse-badge {
  flex: 0 0 auto;
  min-width: 18px;
  padding: 0 5px;
  color: var(--text-on-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  background: var(--mm-line, var(--text-muted));
  border-radius: 9px;
}

/* ---------- 标记 ---------- */

.mm-marks {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
}

.mm-mark {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.mm-priority {
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  border-radius: 50%;
}

.mm-priority-1 { background: var(--mm-p1); }
.mm-priority-2 { background: var(--mm-p2); }
.mm-priority-3 { background: var(--mm-p3); }
.mm-priority-4,
.mm-priority-5,
.mm-priority-6,
.mm-priority-7 { background: var(--mm-p-rest); }

.mm-progress-svg,
.mm-flag-svg {
  width: 18px;
  height: 18px;
}

.mm-progress-ring {
  fill: none;
  stroke: #22c55e;
  stroke-width: 1.5;
}

.mm-progress-wedge {
  fill: #22c55e;
  stroke: none;
}

.mm-progress-check,
.mm-progress-hands {
  fill: none;
  stroke: #22c55e;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mm-flag-glyph {
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mm-flag-red   .mm-flag-glyph { stroke: var(--mm-flag-red); }
.mm-flag-orange .mm-flag-glyph { stroke: var(--mm-flag-orange); }
.mm-flag-yellow .mm-flag-glyph { stroke: var(--mm-flag-yellow); }
.mm-flag-green  .mm-flag-glyph { stroke: var(--mm-flag-green); }
.mm-flag-blue   .mm-flag-glyph { stroke: var(--mm-flag-blue); }
.mm-flag-purple .mm-flag-glyph { stroke: var(--mm-flag-purple); }
.mm-flag-gray   .mm-flag-glyph { stroke: var(--mm-flag-gray); }
```

- [ ] **Step 6: 构建**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 全部通过

- [ ] **Step 7: 手工验证清单**

1. 打开 `test-vault/工作内容.md` → 看到完整思维导图：根节点是圆角填充块，两条主分支分别为紫、蓝，连线为平滑 S 形曲线并连到文字下划线。
2. 优先级圆标：p1 红、p2 橙、p3 黄，数字居中不溢出。
3. 进度标记：`(p3 30%)` 显示为 2 档扇形；把文件改成 `0%` 显示时钟、`100%` 显示对勾，各档扇形角度递增。
4. 旗帜：`(flag:red)` 显示红色旗标。
5. 鼠标悬停节点有底色反馈；标记 tooltip 文案正确。
6. 切到 Obsidian 暗色主题 → 文字与背景对比正常，分支色仍清晰可辨。
7. 把某个节点文字改得很长（超过 360px）→ 文字换行，节点高度增加，同层兄弟不重叠。
8. 控制台无报错，无布局抖动（打开时不出现节点先堆叠再散开）。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: 节点与连线渲染"
```

---
### Task 10: 缩放、平移与画布控件

**Files:**
- Create: `src/view/camera.ts`, `src/view/controls.ts`
- Modify: `scripts/check-purity.mjs`（把 `src/view/camera.ts` 加入 `PURE_FILES`）, `src/view.ts`, `styles.css`
- Test: `tests/camera.test.ts` + 手工验证

**Interfaces:**
- Produces:
  - `src/view/camera.ts`（纯函数）：
    - `interface Camera { scale: number; x: number; y: number }`
    - `MIN_SCALE = 0.2`、`MAX_SCALE = 3`、`IDENTITY: Camera`
    - `clampScale(scale: number): number`
    - `zoomAt(camera: Camera, factor: number, px: number, py: number): Camera` — 以视口坐标 `(px, py)` 为不动点缩放
    - `panBy(camera: Camera, dx: number, dy: number): Camera`
    - `fit(content: { width: number; height: number }, viewport: { width: number; height: number }): Camera` — 等比缩放并居中，不放大超过 1
    - `cssTransform(camera: Camera): string`
  - `src/view/controls.ts`：`interface ControlsHandlers { onZoomIn(): void; onZoomOut(): void; onFit(): void }`、`createControls(host: HTMLElement, handlers: ControlsHandlers): { setScale(scale: number): void }`

- [ ] **Step 1: 把 camera 加入纯函数层校验**

在 `scripts/check-purity.mjs` 中把

```js
const PURE_FILES = ["src/view/layout.ts"];
```

改为

```js
const PURE_FILES = ["src/view/layout.ts", "src/view/camera.ts"];
```

- [ ] **Step 2: 写失败测试 `tests/camera.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  clampScale,
  cssTransform,
  fit,
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  zoomAt,
} from "../src/view/camera";

describe("clampScale", () => {
  it("限制在上下界之间", () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
});

describe("zoomAt", () => {
  it("缩放后不动点在视口中的位置不变", () => {
    const before = { scale: 1, x: 30, y: 40 };
    const px = 200;
    const py = 150;
    const worldBefore = { x: (px - before.x) / before.scale, y: (py - before.y) / before.scale };

    const after = zoomAt(before, 2, px, py);
    const screenAfter = {
      x: worldBefore.x * after.scale + after.x,
      y: worldBefore.y * after.scale + after.y,
    };

    expect(screenAfter.x).toBeCloseTo(px, 6);
    expect(screenAfter.y).toBeCloseTo(py, 6);
  });

  it("缩放倍数被限制在上下界内", () => {
    expect(zoomAt(IDENTITY, 100, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt(IDENTITY, 0.001, 0, 0).scale).toBe(MIN_SCALE);
  });

  it("已在上界时再放大不改变位移", () => {
    const at = { scale: MAX_SCALE, x: 10, y: 20 };
    expect(zoomAt(at, 2, 100, 100)).toEqual(at);
  });
});

describe("panBy", () => {
  it("按像素平移，不改变缩放", () => {
    expect(panBy({ scale: 1.5, x: 10, y: 20 }, 5, -7)).toEqual({
      scale: 1.5,
      x: 15,
      y: 13,
    });
  });
});

describe("fit", () => {
  it("内容大于视口时等比缩小并居中", () => {
    const camera = fit({ width: 800, height: 400 }, { width: 400, height: 400 });
    expect(camera.scale).toBeCloseTo(0.5, 6);
    expect(camera.x).toBeCloseTo(0, 6);
    expect(camera.y).toBeCloseTo(100, 6);
  });

  it("内容小于视口时不放大，仅居中", () => {
    const camera = fit({ width: 200, height: 100 }, { width: 400, height: 400 });
    expect(camera.scale).toBe(1);
    expect(camera.x).toBeCloseTo(100, 6);
    expect(camera.y).toBeCloseTo(150, 6);
  });

  it("视口尺寸为 0 时返回单位相机，不产生 NaN", () => {
    expect(fit({ width: 800, height: 400 }, { width: 0, height: 0 })).toEqual(
      IDENTITY,
    );
  });

  it("内容尺寸为 0 时返回单位相机", () => {
    expect(fit({ width: 0, height: 0 }, { width: 400, height: 400 })).toEqual(
      IDENTITY,
    );
  });
});

describe("cssTransform", () => {
  it("输出 translate + scale", () => {
    expect(cssTransform({ scale: 1.25, x: 10, y: -5 })).toBe(
      "translate(10px, -5px) scale(1.25)",
    );
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/camera.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../src/view/camera"`

- [ ] **Step 4: 写实现 `src/view/camera.ts`**

```ts
export interface Camera {
  scale: number;
  /** 画布在视口中的横向位移（像素） */
  x: number;
  /** 画布在视口中的纵向位移（像素） */
  y: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 3;
export const IDENTITY: Camera = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** 以视口坐标 (px, py) 为不动点缩放。 */
export function zoomAt(
  camera: Camera,
  factor: number,
  px: number,
  py: number,
): Camera {
  const scale = clampScale(camera.scale * factor);
  if (scale === camera.scale) return camera;

  const ratio = scale / camera.scale;
  return {
    scale,
    x: px - (px - camera.x) * ratio,
    y: py - (py - camera.y) * ratio,
  };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { scale: camera.scale, x: camera.x + dx, y: camera.y + dy };
}

/** 等比缩放使内容完整可见并居中；内容小于视口时不放大。 */
export function fit(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
): Camera {
  if (
    content.width <= 0 || content.height <= 0 ||
    viewport.width <= 0 || viewport.height <= 0
  ) {
    return IDENTITY;
  }

  const scale = clampScale(
    Math.min(1, viewport.width / content.width, viewport.height / content.height),
  );

  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}

export function cssTransform(camera: Camera): string {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run && npx tsc --noEmit && node scripts/check-purity.mjs`
Expected: 全部 PASS，纯函数层校验覆盖 2 个 view 文件

- [ ] **Step 6: 写控件 `src/view/controls.ts`**

```ts
import { setIcon } from "obsidian";
import { el } from "./dom";

export interface ControlsHandlers {
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
}

function iconButton(
  host: HTMLElement,
  icon: string,
  label: string,
  onClick: () => void,
): void {
  const button = el("button", "mm-control-btn", host);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  setIcon(button, icon);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
}

/** 画布右上角的缩放控件。 */
export function createControls(
  host: HTMLElement,
  handlers: ControlsHandlers,
): { setScale(scale: number): void } {
  const bar = el("div", "mm-controls", host);

  iconButton(bar, "maximize", "适应窗口", handlers.onFit);
  iconButton(bar, "minus", "缩小", handlers.onZoomOut);

  const readout = el("span", "mm-control-scale", bar);
  readout.textContent = "100%";

  iconButton(bar, "plus", "放大", handlers.onZoomIn);

  return {
    setScale(scale: number): void {
      readout.textContent = `${Math.round(scale * 100)}%`;
    },
  };
}
```

- [ ] **Step 7: 在 `src/view.ts` 中接入相机与控件**

顶部 import 追加：

```ts
import {
  cssTransform,
  fit,
  IDENTITY,
  panBy,
  zoomAt,
  type Camera,
} from "./view/camera";
import { createControls } from "./view/controls";
```

字段追加：

```ts
  private camera: Camera = IDENTITY;
  private controls: { setScale(scale: number): void } | null = null;
  private panOrigin: { x: number; y: number } | null = null;
```

在 `render()` 中创建图层之后（`this.layers = createLayers(this.root)` 那一行下面）追加：

```ts
      this.controls = createControls(this.root, {
        onZoomIn: () => this.zoom(1.2),
        onZoomOut: () => this.zoom(1 / 1.2),
        onFit: () => this.fitToView(),
      });
      this.attachCameraEvents();
```

并在 `render()` 末尾追加 `this.applyCamera();`。新增方法：

```ts
  private applyCamera(): void {
    if (this.layers === null) return;
    this.layers.canvas.style.transform = cssTransform(this.camera);
    this.controls?.setScale(this.camera.scale);
  }

  private zoom(factor: number): void {
    const rect = this.root.getBoundingClientRect();
    this.camera = zoomAt(this.camera, factor, rect.width / 2, rect.height / 2);
    this.applyCamera();
  }

  /** 让整图适应当前视口。 */
  fitToView(): void {
    if (this.lastLayout === null) return;
    const rect = this.root.getBoundingClientRect();
    this.camera = fit(
      { width: this.lastLayout.width, height: this.lastLayout.height },
      { width: rect.width, height: rect.height },
    );
    this.applyCamera();
  }

  private attachCameraEvents(): void {
    // 滚轮：按住修饰键缩放，否则平移。
    this.registerDomEvent(this.root, "wheel", (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = this.root.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY / 300);
        this.camera = zoomAt(
          this.camera,
          factor,
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      } else {
        this.camera = panBy(this.camera, -event.deltaX, -event.deltaY);
      }
      this.applyCamera();
    });

    // 空白处按下拖拽平移。
    this.registerDomEvent(this.root, "pointerdown", (event: PointerEvent) => {
      const onNode = (event.target as HTMLElement).closest(".mm-node") !== null;
      const onControls = (event.target as HTMLElement).closest(".mm-controls") !== null;
      if (onNode || onControls || event.button !== 0) return;

      this.panOrigin = { x: event.clientX, y: event.clientY };
      this.root.setPointerCapture(event.pointerId);
      this.root.addClass("mm-panning");
    });

    this.registerDomEvent(this.root, "pointermove", (event: PointerEvent) => {
      if (this.panOrigin === null) return;
      this.camera = panBy(
        this.camera,
        event.clientX - this.panOrigin.x,
        event.clientY - this.panOrigin.y,
      );
      this.panOrigin = { x: event.clientX, y: event.clientY };
      this.applyCamera();
    });

    this.registerDomEvent(this.root, "pointerup", (event: PointerEvent) => {
      if (this.panOrigin === null) return;
      this.panOrigin = null;
      this.root.releasePointerCapture(event.pointerId);
      this.root.removeClass("mm-panning");
    });
  }
```

另外：首次渲染后自动适应窗口。在 `setViewData` 的 `this.render()` 之后追加 `this.fitToView();`。

- [ ] **Step 8: 控件样式（追加到 `styles.css`）**

```css
.mindmap-view.mm-panning {
  cursor: grabbing;
}

.mm-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}

.mm-control-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  box-shadow: none;
}

.mm-control-btn:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}

.mm-control-scale {
  min-width: 44px;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
```

- [ ] **Step 9: 构建**

Run: `npx tsc --noEmit && npx vitest run && node scripts/check-purity.mjs && npm run build`
Expected: 全部通过

- [ ] **Step 10: 手工验证清单**

1. 打开文件 → 整图自动适应窗口，右上角显示对应百分比。
2. `Cmd/Ctrl + 滚轮` 在鼠标位置缩放，光标下的节点不漂移。
3. 普通滚轮上下/左右平移画布。
4. 在空白处按住拖拽平移，光标变为抓手；在节点上按下不触发平移。
5. 点 `+` / `-` 以画布中心缩放；百分比读数同步更新。
6. 点「适应窗口」→ 整图重新居中铺满。
7. 缩放到最小/最大时停住，不出现空白或倒转。
8. 拖拽平移过程中松开鼠标移出窗口再回来，不会出现「粘住」继续平移。

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: 缩放、平移与画布控件"
```

---
### Task 11: 选择、键盘编辑与就地改文字

**Files:**
- Create: `src/view/interaction.ts`
- Modify: `src/view.ts`, `styles.css`
- Test: 手工验证

**Interfaces:**
- Consumes: `MindNode` from `../model/types`
- Produces:
  - `type Intent` 联合类型：
    ```ts
    | { kind: "select"; id: string | null }
    | { kind: "beginEdit"; id: string }
    | { kind: "commitText"; id: string; text: string }
    | { kind: "cancelEdit" }
    | { kind: "addChild"; id: string }
    | { kind: "addSibling"; id: string }
    | { kind: "remove"; id: string }
    | { kind: "toggleCollapse"; id: string }
    | { kind: "navigate"; id: string; dir: "up" | "down" | "left" | "right" }
    ```
  - `interface InteractionHost { root: HTMLElement; on<K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void): void; dispatch(intent: Intent): void; selectedId(): string | null; isEditing(): boolean }`
  - `attachInteractions(host: InteractionHost): void`
  - `startInlineEdit(nodeEl: HTMLElement, initial: string, onCommit: (text: string) => void, onCancel: () => void): void`

**就地编辑**：把节点内的 `.mm-text` 设为 `contenteditable`，聚焦并全选。`Enter` 或失焦提交，`Esc` 取消。提交时对输入文本跑一遍 `parseMarks`，识别出的标记合并进节点标记 —— 这样在画布里手打 `(p1) 任务` 与 AI 在文件里写 `(p1) 任务` 行为一致。

- [ ] **Step 1: 写交互层 `src/view/interaction.ts`**

```ts
export type Intent =
  | { kind: "select"; id: string | null }
  | { kind: "beginEdit"; id: string }
  | { kind: "commitText"; id: string; text: string }
  | { kind: "cancelEdit" }
  | { kind: "addChild"; id: string }
  | { kind: "addSibling"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "toggleCollapse"; id: string }
  | { kind: "navigate"; id: string; dir: "up" | "down" | "left" | "right" };

export interface InteractionHost {
  root: HTMLElement;
  on<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void;
  dispatch(intent: Intent): void;
  selectedId(): string | null;
  isEditing(): boolean;
}

function nodeIdFrom(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>(".mm-node")?.dataset.id ?? null;
}

const ARROW_DIRS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** 绑定选择与键盘操作。就地编辑期间除 Esc 外不拦截按键。 */
export function attachInteractions(host: InteractionHost): void {
  host.root.tabIndex = 0;

  host.on("pointerdown", (event: PointerEvent) => {
    if (host.isEditing()) return;
    const id = nodeIdFrom(event.target);
    host.dispatch({ kind: "select", id });
    // 让键盘事件回到画布，否则焦点留在按钮上。
    if (id !== null) host.root.focus({ preventScroll: true });
  });

  host.on("dblclick", (event: MouseEvent) => {
    const id = nodeIdFrom(event.target);
    if (id === null) return;
    event.preventDefault();
    host.dispatch({ kind: "beginEdit", id });
  });

  host.on("keydown", (event: KeyboardEvent) => {
    if (host.isEditing()) return;

    const id = host.selectedId();
    if (id === null) return;

    // 让 Obsidian 自己的快捷键继续工作。
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case "Tab":
        event.preventDefault();
        host.dispatch({ kind: "addChild", id });
        return;
      case "Enter":
        event.preventDefault();
        host.dispatch({ kind: "addSibling", id });
        return;
      case "F2":
        event.preventDefault();
        host.dispatch({ kind: "beginEdit", id });
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        host.dispatch({ kind: "remove", id });
        return;
      case " ":
        event.preventDefault();
        host.dispatch({ kind: "toggleCollapse", id });
        return;
      case "Escape":
        event.preventDefault();
        host.dispatch({ kind: "select", id: null });
        return;
      default:
        break;
    }

    const dir = ARROW_DIRS[event.key];
    if (dir !== undefined) {
      event.preventDefault();
      host.dispatch({ kind: "navigate", id, dir });
    }
  });
}

/**
 * 在节点内就地编辑文字。
 * 提交与取消都只调用一次，之后解绑，避免失焦与按键重复触发。
 */
export function startInlineEdit(
  nodeEl: HTMLElement,
  initial: string,
  onCommit: (text: string) => void,
  onCancel: () => void,
): void {
  const textEl = nodeEl.querySelector<HTMLElement>(".mm-text");
  if (textEl === null) {
    onCancel();
    return;
  }

  let settled = false;
  textEl.textContent = initial;
  textEl.contentEditable = "true";
  textEl.addClass("mm-editing");

  const finish = (commit: boolean): void => {
    if (settled) return;
    settled = true;

    const text = (textEl.textContent ?? "").replace(/\s+/g, " ").trim();
    textEl.contentEditable = "false";
    textEl.removeClass("mm-editing");
    textEl.removeEventListener("keydown", onKeyDown);
    textEl.removeEventListener("blur", onBlur);

    if (commit) {
      onCommit(text);
    } else {
      onCancel();
    }
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  }

  function onBlur(): void {
    finish(true);
  }

  textEl.addEventListener("keydown", onKeyDown);
  textEl.addEventListener("blur", onBlur);

  textEl.focus();
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
```

- [ ] **Step 2: 在 `src/view.ts` 中接入意图处理**

顶部 import 追加：

```ts
import { parseMarks } from "./model/marks";
import {
  addChild,
  addSibling,
  findNode,
  navigate,
  removeNode,
  setMarks,
  setText,
  toggleCollapse,
} from "./model/tree-ops";
import {
  attachInteractions,
  startInlineEdit,
  type Intent,
} from "./view/interaction";
```

字段追加：

```ts
  private editingId: string | null = null;
  /** 新增节点后自动进入编辑的目标 */
  private pendingEditId: string | null = null;
```

在 `attachCameraEvents()` 调用之后追加 `this.attachInteractionLayer();`，并新增：

```ts
  private attachInteractionLayer(): void {
    attachInteractions({
      root: this.root,
      on: (type, handler) => this.registerDomEvent(this.root, type, handler),
      dispatch: (intent) => this.handleIntent(intent),
      selectedId: () => this.selectedId,
      isEditing: () => this.editingId !== null,
    });
  }

  private handleIntent(intent: Intent): void {
    if (this.doc === null) return;
    const doc = this.doc;

    switch (intent.kind) {
      case "select":
        this.setSelection(intent.id);
        return;

      case "beginEdit":
        this.beginEdit(intent.id);
        return;

      case "cancelEdit":
        this.editingId = null;
        this.render();
        return;

      case "commitText": {
        this.editingId = null;
        const { marks, rest } = parseMarks(intent.text);
        const target = findNode(doc.root, intent.id);
        const merged = { ...(target?.marks ?? {}), ...marks };
        let root = setText(doc.root, intent.id, rest);
        root = setMarks(root, intent.id, merged);
        this.applyDoc({ ...doc, root });
        return;
      }

      case "addChild": {
        const { root, newId } = addChild(doc.root, intent.id);
        this.selectedId = newId;
        this.pendingEditId = newId;
        this.applyDoc({ ...doc, root });
        return;
      }

      case "addSibling": {
        const { root, newId } = addSibling(doc.root, intent.id);
        this.selectedId = newId;
        this.pendingEditId = newId;
        this.applyDoc({ ...doc, root });
        return;
      }

      case "remove": {
        const { root, nextSelectionId } = removeNode(doc.root, intent.id);
        this.selectedId = nextSelectionId;
        this.applyDoc({ ...doc, root });
        return;
      }

      case "toggleCollapse":
        this.applyDoc({ ...doc, root: toggleCollapse(doc.root, intent.id) });
        return;

      case "navigate": {
        const next = navigate(doc.root, intent.id, intent.dir);
        if (next !== null) this.setSelection(next);
        return;
      }
    }
  }

  private setSelection(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.refreshSelectionClasses();
  }

  /** 只切类名，避免为选中变化做整图重排。 */
  private refreshSelectionClasses(): void {
    if (this.layers === null) return;
    for (const element of Array.from(
      this.layers.nodes.querySelectorAll<HTMLElement>(".mm-node"),
    )) {
      element.toggleClass("mm-selected", element.dataset.id === this.selectedId);
    }
  }

  private beginEdit(id: string): void {
    if (this.doc === null || this.layers === null) return;
    const node = findNode(this.doc.root, id);
    const element = this.layers.nodes.querySelector<HTMLElement>(
      `.mm-node[data-id="${id}"]`,
    );
    if (node === null || element === null) return;

    this.editingId = id;
    startInlineEdit(
      element,
      node.text,
      (text) => this.handleIntent({ kind: "commitText", id, text }),
      () => this.handleIntent({ kind: "cancelEdit" }),
    );
  }
```

在 `render()` 末尾（`this.applyCamera();` 之后）追加：

```ts
    this.refreshSelectionClasses();
    if (this.pendingEditId !== null) {
      const id = this.pendingEditId;
      this.pendingEditId = null;
      this.beginEdit(id);
    }
```

在 `applyDoc()` 中，编辑期间不重绘（防止 contenteditable 被销毁）；把 `applyDoc` 改为：

```ts
  applyDoc(next: MindDoc): void {
    this.doc = next;
    if (this.editingId === null) this.render();
    this.scheduleSave();
  }
```

- [ ] **Step 3: 编辑态样式（追加到 `styles.css`）**

```css
.mindmap-view:focus,
.mindmap-view:focus-visible {
  outline: none;
}

.mm-text.mm-editing {
  min-width: 2ch;
  padding: 0 2px;
  background: var(--background-primary);
  border-radius: 3px;
  outline: 2px solid var(--interactive-accent);
  cursor: text;
}
```

- [ ] **Step 4: 构建**

Run: `npx tsc --noEmit && npx vitest run && node scripts/check-purity.mjs && npm run build`
Expected: 全部通过

- [ ] **Step 5: 手工验证清单**

1. 单击节点 → 出现强调色描边；单击空白 → 取消选中。
2. 选中节点按 `Tab` → 生成子节点并直接进入编辑，输入文字后按 `Enter` 提交。
3. 按 `Enter`（未编辑态）→ 在同层生成兄弟节点并进入编辑。
4. 双击节点 / 按 `F2` → 进入编辑，文字全选；`Esc` 取消，文字回到原值。
5. 编辑时输入 `(p1) 新任务` 并提交 → 节点显示红色 1 圆标，文字为「新任务」；切到源码模式确认写成 `- (p1) 新任务`。
6. 按 `Delete` 删除节点 → 子树一并消失，选中落到下一个兄弟。
7. 方向键在树中移动选中：上下换兄弟、左到父、右到首个子节点。
8. 按 `Space` 折叠/展开，折叠节点右侧显示子节点数量角标。
9. 折叠一个节点后切到源码 → frontmatter 出现 `mindmap-collapsed` 且路径正确；再切回导图，折叠状态保持。
10. 所有编辑操作后约 0.4 秒文件被保存（在源码模式确认内容），且 frontmatter 其他键未被改动。
11. 编辑中拖拽画布或滚轮缩放不会把编辑框弄丢。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 选择、键盘编辑与就地改文字"
```

---
### Task 12: 拖拽移动节点

**Files:**
- Create: `src/view/drag.ts`
- Modify: `src/view.ts`, `styles.css`
- Test: `tests/drop-target.test.ts` + 手工验证

**Interfaces:**
- Produces:
  - `src/view/drag.ts`：
    - `type DropZone = "before" | "after" | "child"`
    - `interface DropTarget { targetId: string; zone: DropZone }`
    - `zoneFromOffset(offsetY: number, height: number): DropZone` — 纯函数，上 30% → `before`，下 30% → `after`，中间 → `child`
    - `interface DragHost { root: HTMLElement; on<K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void): void; isEditing(): boolean; onDrop(sourceId: string, target: DropTarget): void }`
    - `attachDrag(host: DragHost): void`
  - 拖拽阈值 4px，未超过阈值时按点击处理（由 Task 11 的 `select` 负责）

**落点解析**：以指针下的 `.mm-node` 为目标节点，按指针在该节点内的纵向比例决定 `before` / `after` / `child`。目标为源节点自身或其后代时视为无效落点（`moveNode` 也会兜底原样返回）。

- [ ] **Step 1: 写失败测试 `tests/drop-target.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { zoneFromOffset } from "../src/view/drag";

describe("zoneFromOffset", () => {
  it("上 30% 为 before", () => {
    expect(zoneFromOffset(0, 100)).toBe("before");
    expect(zoneFromOffset(29, 100)).toBe("before");
  });

  it("下 30% 为 after", () => {
    expect(zoneFromOffset(71, 100)).toBe("after");
    expect(zoneFromOffset(100, 100)).toBe("after");
  });

  it("中间为 child", () => {
    expect(zoneFromOffset(30, 100)).toBe("child");
    expect(zoneFromOffset(50, 100)).toBe("child");
    expect(zoneFromOffset(70, 100)).toBe("child");
  });

  it("高度为 0 时退化为 child，不产生除零", () => {
    expect(zoneFromOffset(0, 0)).toBe("child");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/drop-target.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../src/view/drag"`

- [ ] **Step 3: 写实现 `src/view/drag.ts`**

```ts
export type DropZone = "before" | "after" | "child";

export interface DropTarget {
  targetId: string;
  zone: DropZone;
}

export interface DragHost {
  root: HTMLElement;
  on<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void;
  isEditing(): boolean;
  onDrop(sourceId: string, target: DropTarget): void;
}

const DRAG_THRESHOLD_PX = 4;
const EDGE_RATIO = 0.3;

/** 指针在目标节点内的纵向比例决定落点区域。 */
export function zoneFromOffset(offsetY: number, height: number): DropZone {
  if (height <= 0) return "child";
  const ratio = offsetY / height;
  if (ratio < EDGE_RATIO) return "before";
  if (ratio > 1 - EDGE_RATIO) return "after";
  return "child";
}

function nodeElAt(x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint(x, y);
  if (!(hit instanceof HTMLElement)) return null;
  return hit.closest<HTMLElement>(".mm-node");
}

interface DragState {
  sourceId: string;
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLElement | null;
  indicator: HTMLElement | null;
  target: DropTarget | null;
}

/** 绑定节点拖拽。超过阈值才开始拖，否则交给点击逻辑。 */
export function attachDrag(host: DragHost): void {
  let state: DragState | null = null;

  const teardown = (): void => {
    state?.ghost?.remove();
    state?.indicator?.remove();
    host.root.removeClass("mm-dragging");
    state = null;
  };

  host.on("pointerdown", (event: PointerEvent) => {
    if (host.isEditing() || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const nodeEl = target.closest<HTMLElement>(".mm-node");
    const id = nodeEl?.dataset.id;
    // 根节点不可拖动。
    if (nodeEl === null || id === undefined || nodeEl.hasClass("mm-root")) return;

    state = {
      sourceId: id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      ghost: null,
      indicator: null,
      target: null,
    };
  });

  host.on("pointermove", (event: PointerEvent) => {
    if (state === null) return;

    if (!state.active) {
      const moved =
        Math.abs(event.clientX - state.startX) +
        Math.abs(event.clientY - state.startY);
      if (moved < DRAG_THRESHOLD_PX) return;

      state.active = true;
      host.root.addClass("mm-dragging");

      const ghost = document.createElement("div");
      ghost.className = "mm-drag-ghost";
      host.root.appendChild(ghost);
      state.ghost = ghost;

      const indicator = document.createElement("div");
      indicator.className = "mm-drop-indicator";
      host.root.appendChild(indicator);
      state.indicator = indicator;
    }

    const rootRect = host.root.getBoundingClientRect();
    if (state.ghost !== null) {
      state.ghost.style.left = `${event.clientX - rootRect.left}px`;
      state.ghost.style.top = `${event.clientY - rootRect.top}px`;
    }

    // 隐藏浮层再做命中测试，否则总是命中自己。
    const ghostDisplay = state.ghost?.style.display ?? "";
    if (state.ghost !== null) state.ghost.style.display = "none";
    if (state.indicator !== null) state.indicator.style.display = "none";
    const hit = nodeElAt(event.clientX, event.clientY);
    if (state.ghost !== null) state.ghost.style.display = ghostDisplay;
    if (state.indicator !== null) state.indicator.style.display = "";

    const hitId = hit?.dataset.id;
    if (hit === null || hitId === undefined || hitId === state.sourceId) {
      state.target = null;
      if (state.indicator !== null) state.indicator.style.display = "none";
      return;
    }

    const hitRect = hit.getBoundingClientRect();
    const zone = zoneFromOffset(event.clientY - hitRect.top, hitRect.height);
    state.target = { targetId: hitId, zone };

    if (state.indicator !== null) {
      const indicator = state.indicator;
      indicator.dataset.zone = zone;
      indicator.style.left = `${hitRect.left - rootRect.left}px`;
      indicator.style.width = `${hitRect.width}px`;
      indicator.style.top = `${
        (zone === "before" ? hitRect.top : hitRect.bottom) - rootRect.top
      }px`;
      indicator.style.height = zone === "child" ? `${hitRect.height}px` : "2px";
      if (zone === "child") {
        indicator.style.top = `${hitRect.top - rootRect.top}px`;
      }
    }
  });

  host.on("pointerup", () => {
    if (state === null) return;
    const { active, sourceId, target } = state;
    teardown();
    if (active && target !== null) host.onDrop(sourceId, target);
  });

  host.on("pointercancel", teardown);
}
```

- [ ] **Step 4: 在 `src/view.ts` 中接入**

顶部 import 追加：

```ts
import { attachDrag, type DropTarget } from "./view/drag";
import { findParent, moveNode } from "./model/tree-ops";
```

（`findParent` / `moveNode` 若已在 Task 11 的 import 里，合并即可。）

在 `attachInteractionLayer()` 调用之后追加 `this.attachDragLayer();`，并新增：

```ts
  private attachDragLayer(): void {
    attachDrag({
      root: this.root,
      on: (type, handler) => this.registerDomEvent(this.root, type, handler),
      isEditing: () => this.editingId !== null,
      onDrop: (sourceId, target) => this.handleDrop(sourceId, target),
    });
  }

  private handleDrop(sourceId: string, target: DropTarget): void {
    if (this.doc === null) return;
    const doc = this.doc;

    if (target.zone === "child") {
      const node = findNode(doc.root, target.targetId);
      if (node === null) return;
      this.applyDoc({
        ...doc,
        root: moveNode(doc.root, sourceId, target.targetId, node.children.length),
      });
      return;
    }

    const parent = findParent(doc.root, target.targetId);
    if (parent === null) return;
    const index = parent.children.findIndex((c) => c.id === target.targetId);
    // 同父内向下移动时，源节点先被摘除，插入下标要相应前移。
    const sourceIndex = parent.children.findIndex((c) => c.id === sourceId);
    const shift = sourceIndex >= 0 && sourceIndex < index ? -1 : 0;
    const insertAt = index + (target.zone === "after" ? 1 : 0) + shift;

    this.applyDoc({
      ...doc,
      root: moveNode(doc.root, sourceId, parent.id, insertAt),
    });
  }
```

- [ ] **Step 5: 拖拽样式（追加到 `styles.css`）**

```css
.mindmap-view.mm-dragging {
  cursor: grabbing;
}

.mindmap-view.mm-dragging .mm-node {
  pointer-events: auto;
}

.mm-drag-ghost {
  position: absolute;
  z-index: 20;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  background: var(--interactive-accent);
  border-radius: 50%;
  pointer-events: none;
  opacity: 0.9;
}

.mm-drop-indicator {
  position: absolute;
  z-index: 19;
  box-sizing: border-box;
  background: var(--interactive-accent);
  border-radius: 2px;
  pointer-events: none;
}

.mm-drop-indicator[data-zone="child"] {
  background: transparent;
  border: 2px dashed var(--interactive-accent);
  border-radius: 6px;
}
```

- [ ] **Step 6: 构建**

Run: `npx tsc --noEmit && npx vitest run && node scripts/check-purity.mjs && npm run build`
Expected: 全部通过

- [ ] **Step 7: 手工验证清单**

1. 小幅移动（< 4px）后松开 → 只是选中，节点位置不变。
2. 拖到另一节点中部 → 显示虚线框，松开后成为该节点的末子。
3. 拖到另一节点上缘 → 显示上方横线，松开后插到该节点之前。
4. 拖到另一节点下缘 → 显示下方横线，松开后插到该节点之后。
5. 同一父节点内自上往下重排一位 → 落点与指示线一致，不会多跳一格。
6. 拖到自己的子节点上 → 松开后结构不变，不报错。
7. 根节点不可拖动。
8. 拖拽过程中指示线跟随准确（在缩放到 50% 与 200% 时各验证一次）。
9. 拖完约 0.4 秒后文件写回，源码中的缩进层级与画布一致。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: 拖拽移动节点"
```

---
### Task 13: 标记面板（优先级 / 进度 / 旗帜）

**Files:**
- Create: `src/view/popover.ts`, `src/view/marks-panel.ts`
- Modify: `src/view/node-el.ts`（导出三个徽标构造函数以复用）, `styles.css`
- Test: 手工验证

**Interfaces:**
- Produces:
  - `src/view/popover.ts`：`placeNear(panel: HTMLElement, anchor: DOMRect, hostRect: DOMRect, gap?: number): void` — 优先放在锚点下方，超出下边界则改到上方；左右夹紧在宿主范围内
  - `src/view/node-el.ts` 新增导出：`buildPriorityBadge(priority: number, parent: HTMLElement): HTMLElement`、`buildProgressBadge(progress: number, parent: HTMLElement): HTMLElement`、`buildFlagBadge(flag: FlagColor, parent: HTMLElement): HTMLElement`（原内部函数改造为返回元素并导出，`buildMarks` 改为调用它们）
  - `src/view/marks-panel.ts`：`interface MarksPanelHandlers { onToggle(patch: Marks): void; onClose(): void }`、`openMarksPanel(host: HTMLElement, anchor: DOMRect, current: Marks, handlers: MarksPanelHandlers): { close(): void }`

**面板内容**（与参考截图一致）：三段式 —— 「优先级」1–7 彩色数字圆标；「进度」7 档饼图（0% 时钟 → 100% 对勾）；「旗帜」7 色旗标。当前已生效的项高亮；点选已生效项即取消该标记（走 `toggleMark`）。

- [ ] **Step 1: 改造 `src/view/node-el.ts` 导出徽标构造函数**

把原来的 `buildProgress` / `buildFlag` 以及优先级徽标那段内联代码，改造成三个导出函数（签名见上），`buildMarks` 改为：

```ts
function buildMarks(marks: Marks, parent: HTMLElement): void {
  if (
    marks.priority === undefined &&
    marks.progress === undefined &&
    marks.flag === undefined
  ) {
    return;
  }
  const wrap = el("span", "mm-marks", parent);
  if (marks.priority !== undefined) buildPriorityBadge(marks.priority, wrap);
  if (marks.progress !== undefined) buildProgressBadge(marks.progress, wrap);
  if (marks.flag !== undefined) buildFlagBadge(marks.flag, wrap);
}
```

三个函数的实现与 Task 9 中的内联版本相同，仅改为 `export function ...(..., parent: HTMLElement): HTMLElement`，末尾 `return wrap;`。优先级版本：

```ts
export function buildPriorityBadge(
  priority: number,
  parent: HTMLElement,
): HTMLElement {
  const badge = el("span", `mm-mark mm-priority mm-priority-${priority}`, parent);
  badge.textContent = String(priority);
  badge.title = `优先级 ${priority}`;
  return badge;
}
```

- [ ] **Step 2: 写浮层定位 `src/view/popover.ts`**

```ts
/**
 * 把浮层摆在锚点附近。优先放下方，空间不足时改到上方；
 * 左右夹紧在宿主范围内，保证浮层始终完整可见。
 * 坐标相对宿主元素（宿主需 position: relative）。
 */
export function placeNear(
  panel: HTMLElement,
  anchor: DOMRect,
  hostRect: DOMRect,
  gap = 8,
): void {
  const panelRect = panel.getBoundingClientRect();

  const belowTop = anchor.bottom - hostRect.top + gap;
  const aboveTop = anchor.top - hostRect.top - panelRect.height - gap;
  const fitsBelow = belowTop + panelRect.height <= hostRect.height;
  const top = fitsBelow ? belowTop : Math.max(0, aboveTop);

  const desiredLeft = anchor.left - hostRect.left;
  const maxLeft = Math.max(0, hostRect.width - panelRect.width);
  const left = Math.min(Math.max(0, desiredLeft), maxLeft);

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}
```

- [ ] **Step 3: 写标记面板 `src/view/marks-panel.ts`**

```ts
import { PROGRESS_STAGE_VALUES } from "../model/marks";
import { FLAG_COLORS, type Marks } from "../model/types";
import { el } from "./dom";
import {
  buildFlagBadge,
  buildPriorityBadge,
  buildProgressBadge,
} from "./node-el";
import { placeNear } from "./popover";

export interface MarksPanelHandlers {
  onToggle(patch: Marks): void;
  onClose(): void;
}

const PRIORITIES: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

function section(parent: HTMLElement, title: string): HTMLElement {
  const wrap = el("div", "mm-panel-section", parent);
  const label = el("div", "mm-panel-title", wrap);
  label.textContent = title;
  return el("div", "mm-panel-row", wrap);
}

function optionButton(
  row: HTMLElement,
  active: boolean,
  label: string,
  onClick: () => void,
  fill: (parent: HTMLElement) => void,
): void {
  const button = el("button", "mm-panel-option", row);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.toggleClass("mm-active", active);
  fill(button);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
}

/**
 * 打开标记面板。点选已生效项即取消该标记（由调用方的 toggleMark 语义保证）。
 * 面板外点击或按 Esc 关闭。
 */
export function openMarksPanel(
  host: HTMLElement,
  anchor: DOMRect,
  current: Marks,
  handlers: MarksPanelHandlers,
): { close(): void } {
  const panel = el("div", "mm-panel", host);

  const priorityRow = section(panel, "优先级");
  for (const priority of PRIORITIES) {
    optionButton(
      priorityRow,
      current.priority === priority,
      `优先级 ${priority}`,
      () => handlers.onToggle({ priority }),
      (parent) => void buildPriorityBadge(priority, parent),
    );
  }

  const progressRow = section(panel, "进度");
  for (const progress of PROGRESS_STAGE_VALUES) {
    optionButton(
      progressRow,
      current.progress === progress,
      `进度 ${progress}%`,
      () => handlers.onToggle({ progress }),
      (parent) => void buildProgressBadge(progress, parent),
    );
  }

  const flagRow = section(panel, "旗帜");
  for (const flag of FLAG_COLORS) {
    optionButton(
      flagRow,
      current.flag === flag,
      `旗帜 ${flag}`,
      () => handlers.onToggle({ flag }),
      (parent) => void buildFlagBadge(flag, parent),
    );
  }

  placeNear(panel, anchor, host.getBoundingClientRect());

  const onDocPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && panel.contains(event.target)) return;
    close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    panel.remove();
    handlers.onClose();
  }

  // 捕获阶段监听，确保先于画布的 pointerdown 生效。
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  return { close };
}
```

- [ ] **Step 4: 面板样式（追加到 `styles.css`）**

```css
.mm-panel {
  position: absolute;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
}

.mm-panel-title {
  margin-bottom: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.mm-panel-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.mm-panel-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: none;
}

.mm-panel-option:hover {
  background: var(--background-modifier-hover);
}

.mm-panel-option.mm-active {
  border-color: var(--interactive-accent);
}
```

- [ ] **Step 5: 构建**

Run: `npx tsc --noEmit && npx vitest run && node scripts/check-purity.mjs && npm run build`
Expected: 全部通过。本任务尚未有入口调用面板 —— Task 14 的工具栏接上后一起验证；此处仅确认编译与既有测试不回归。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 标记面板与浮层定位"
```

---
### Task 14: 悬浮工具栏

**Files:**
- Create: `src/view/toolbar.ts`, `src/view/input-popover.ts`
- Modify: `src/view/popover.ts`（`placeNear` 增加 `prefer` 参数）, `src/view.ts`, `styles.css`
- Test: 手工验证

**Interfaces:**
- Produces:
  - `src/view/popover.ts`：签名改为 `placeNear(panel: HTMLElement, anchor: DOMRect, hostRect: DOMRect, options?: { gap?: number; prefer?: "above" | "below" }): void`；`prefer` 默认 `"below"`，为 `"above"` 时先试上方、不够再放下方。Task 13 的调用点无需改动（默认值保持原行为）。
  - `src/view/input-popover.ts`：`openInputPopover(host: HTMLElement, anchor: DOMRect, options: { placeholder: string; initial?: string; onSubmit(value: string): void }): { close(): void }`
  - `src/view/toolbar.ts`：
    - `interface ToolbarHandlers { onAddChild(): void; onAddSibling(): void; onRemove(): void; onWrap(marker: "**" | "*" | "~~"): void; onMarks(anchor: DOMRect): void; onLink(anchor: DOMRect): void; onToggleCollapse(): void }`
    - `createToolbar(host: HTMLElement, handlers: ToolbarHandlers): { showFor(nodeEl: HTMLElement, canCollapse: boolean, isRoot: boolean): void; hide(): void; contains(node: Node): boolean }`

**按钮（左到右，均带 tooltip）**：添加子节点 · 添加兄弟节点 · 删除节点 · 文字样式（展开加粗/斜体/删除线）· 标记 · 插入链接 · 折叠子树。选中根节点时「添加兄弟节点」与「删除节点」禁用；无子节点时「折叠子树」禁用。

**文字样式语义**：对整个节点文本做包裹标记的开关 —— 已被该标记包裹则去掉，否则加上。不做选区级富文本，保持原始 Markdown 简单可读。

- [ ] **Step 1: 给 `placeNear` 增加 `prefer` 参数**

把 `src/view/popover.ts` 整体替换为：

```ts
export interface PlaceOptions {
  gap?: number;
  prefer?: "above" | "below";
}

/**
 * 把浮层摆在锚点附近。按 `prefer` 先试一侧，空间不足时翻到另一侧；
 * 左右夹紧在宿主范围内，保证浮层始终完整可见。
 * 坐标相对宿主元素（宿主需 position: relative）。
 */
export function placeNear(
  panel: HTMLElement,
  anchor: DOMRect,
  hostRect: DOMRect,
  options: PlaceOptions = {},
): void {
  const gap = options.gap ?? 8;
  const prefer = options.prefer ?? "below";
  const panelRect = panel.getBoundingClientRect();

  const belowTop = anchor.bottom - hostRect.top + gap;
  const aboveTop = anchor.top - hostRect.top - panelRect.height - gap;
  const fitsBelow = belowTop + panelRect.height <= hostRect.height;
  const fitsAbove = aboveTop >= 0;

  let top: number;
  if (prefer === "below") {
    top = fitsBelow ? belowTop : fitsAbove ? aboveTop : Math.max(0, belowTop);
  } else {
    top = fitsAbove ? aboveTop : fitsBelow ? belowTop : Math.max(0, aboveTop);
  }

  const desiredLeft = anchor.left - hostRect.left;
  const maxLeft = Math.max(0, hostRect.width - panelRect.width);
  const left = Math.min(Math.max(0, desiredLeft), maxLeft);

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}
```

- [ ] **Step 2: 写输入浮层 `src/view/input-popover.ts`**

```ts
import { el } from "./dom";
import { placeNear } from "./popover";

/** 一个只有单行输入框的小浮层，用于「插入链接」这类需要少量输入的操作。 */
export function openInputPopover(
  host: HTMLElement,
  anchor: DOMRect,
  options: { placeholder: string; initial?: string; onSubmit(value: string): void },
): { close(): void } {
  const wrap = el("div", "mm-input-popover", host);
  const input = el("input", "mm-input", wrap);
  input.type = "text";
  input.placeholder = options.placeholder;
  input.value = options.initial ?? "";

  placeNear(wrap, anchor, host.getBoundingClientRect());

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    wrap.remove();
  }

  function onDocPointerDown(event: PointerEvent): void {
    if (event.target instanceof Node && wrap.contains(event.target)) return;
    close();
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const value = input.value.trim();
      close();
      if (value !== "") options.onSubmit(value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  document.addEventListener("pointerdown", onDocPointerDown, true);
  input.focus();
  input.select();

  return { close };
}
```

- [ ] **Step 3: 写工具栏 `src/view/toolbar.ts`**

```ts
import { setIcon } from "obsidian";
import { el } from "./dom";
import { placeNear } from "./popover";

export interface ToolbarHandlers {
  onAddChild(): void;
  onAddSibling(): void;
  onRemove(): void;
  onWrap(marker: "**" | "*" | "~~"): void;
  onMarks(anchor: DOMRect): void;
  onLink(anchor: DOMRect): void;
  onToggleCollapse(): void;
}

interface ButtonSpec {
  icon: string;
  label: string;
  action: (button: HTMLButtonElement) => void;
  /** 返回 true 表示在当前选中状态下禁用 */
  disabled?: (canCollapse: boolean, isRoot: boolean) => boolean;
}

const STYLE_MARKERS: readonly { marker: "**" | "*" | "~~"; label: string }[] = [
  { marker: "**", label: "加粗" },
  { marker: "*", label: "斜体" },
  { marker: "~~", label: "删除线" },
];

/** 选中节点时贴在节点上方出现的工具栏。 */
export function createToolbar(
  host: HTMLElement,
  handlers: ToolbarHandlers,
): {
  showFor(nodeEl: HTMLElement, canCollapse: boolean, isRoot: boolean): void;
  hide(): void;
  contains(node: Node): boolean;
} {
  const bar = el("div", "mm-toolbar", host);
  bar.hide();

  let styleMenu: HTMLElement | null = null;

  const closeStyleMenu = (): void => {
    styleMenu?.remove();
    styleMenu = null;
  };

  const specs: ButtonSpec[] = [
    { icon: "corner-down-right", label: "添加子节点", action: () => handlers.onAddChild() },
    {
      icon: "plus",
      label: "添加兄弟节点",
      action: () => handlers.onAddSibling(),
      disabled: (_canCollapse, isRoot) => isRoot,
    },
    {
      icon: "trash-2",
      label: "删除节点",
      action: () => handlers.onRemove(),
      disabled: (_canCollapse, isRoot) => isRoot,
    },
    {
      icon: "type",
      label: "文字样式",
      action: (button) => {
        if (styleMenu !== null) {
          closeStyleMenu();
          return;
        }
        const menu = el("div", "mm-style-menu", host);
        for (const { marker, label } of STYLE_MARKERS) {
          const item = el("button", "mm-style-item", menu);
          item.type = "button";
          item.textContent = label;
          item.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeStyleMenu();
            handlers.onWrap(marker);
          });
        }
        styleMenu = menu;
        placeNear(menu, button.getBoundingClientRect(), host.getBoundingClientRect());
      },
    },
    {
      icon: "circle-check-big",
      label: "添加标记",
      action: (button) => handlers.onMarks(button.getBoundingClientRect()),
    },
    {
      icon: "link",
      label: "插入链接",
      action: (button) => handlers.onLink(button.getBoundingClientRect()),
    },
    {
      icon: "fold-vertical",
      label: "折叠子树",
      action: () => handlers.onToggleCollapse(),
      disabled: (canCollapse) => !canCollapse,
    },
  ];

  const buttons = specs.map((spec) => {
    const button = el("button", "mm-toolbar-btn", bar);
    button.type = "button";
    button.title = spec.label;
    button.setAttribute("aria-label", spec.label);
    setIcon(button, spec.icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      spec.action(button);
    });
    return { spec, button };
  });

  return {
    showFor(nodeEl: HTMLElement, canCollapse: boolean, isRoot: boolean): void {
      closeStyleMenu();
      for (const { spec, button } of buttons) {
        button.disabled = spec.disabled?.(canCollapse, isRoot) ?? false;
      }
      bar.show();
      placeNear(bar, nodeEl.getBoundingClientRect(), host.getBoundingClientRect(), {
        prefer: "above",
      });
    },
    hide(): void {
      closeStyleMenu();
      bar.hide();
    },
    contains(node: Node): boolean {
      return bar.contains(node) || (styleMenu?.contains(node) ?? false);
    },
  };
}
```

- [ ] **Step 4: 在 `src/view.ts` 中接入工具栏**

顶部 import 追加：

```ts
import { openMarksPanel } from "./view/marks-panel";
import { openInputPopover } from "./view/input-popover";
import { createToolbar } from "./view/toolbar";
import { toggleMark } from "./model/tree-ops";
import type { Marks } from "./model/types";
```

字段追加：

```ts
  private toolbar: ReturnType<typeof createToolbar> | null = null;
  private marksPanel: { close(): void } | null = null;
```

在 `attachDragLayer()` 之后（仍在 `render()` 首次创建图层的分支内）追加 `this.toolbar = this.createToolbarForView();`，并新增：

```ts
  private createToolbarForView(): ReturnType<typeof createToolbar> {
    return createToolbar(this.root, {
      onAddChild: () => this.withSelection((id) => this.handleIntent({ kind: "addChild", id })),
      onAddSibling: () => this.withSelection((id) => this.handleIntent({ kind: "addSibling", id })),
      onRemove: () => this.withSelection((id) => this.handleIntent({ kind: "remove", id })),
      onToggleCollapse: () =>
        this.withSelection((id) => this.handleIntent({ kind: "toggleCollapse", id })),
      onWrap: (marker) => this.withSelection((id) => this.wrapText(id, marker)),
      onMarks: (anchor) => this.withSelection((id) => this.openMarks(id, anchor)),
      onLink: (anchor) => this.withSelection((id) => this.insertLink(id, anchor)),
    });
  }

  private withSelection(fn: (id: string) => void): void {
    if (this.selectedId !== null) fn(this.selectedId);
  }

  /** 对整个节点文本做包裹标记的开关。 */
  private wrapText(id: string, marker: "**" | "*" | "~~"): void {
    if (this.doc === null) return;
    const node = findNode(this.doc.root, id);
    if (node === null) return;

    const wrapped =
      node.text.startsWith(marker) &&
      node.text.endsWith(marker) &&
      node.text.length > marker.length * 2;

    const text = wrapped
      ? node.text.slice(marker.length, node.text.length - marker.length)
      : `${marker}${node.text}${marker}`;

    this.applyDoc({ ...this.doc, root: setText(this.doc.root, id, text) });
  }

  private openMarks(id: string, anchor: DOMRect): void {
    if (this.doc === null) return;
    const node = findNode(this.doc.root, id);
    if (node === null) return;

    this.marksPanel?.close();
    this.marksPanel = openMarksPanel(this.root, anchor, node.marks, {
      onToggle: (patch: Marks) => {
        if (this.doc === null) return;
        this.applyDoc({ ...this.doc, root: toggleMark(this.doc.root, id, patch) });
      },
      onClose: () => {
        this.marksPanel = null;
      },
    });
  }

  private insertLink(id: string, anchor: DOMRect): void {
    openInputPopover(this.root, anchor, {
      placeholder: "链接目标（笔记名）",
      onSubmit: (value) => {
        if (this.doc === null) return;
        const node = findNode(this.doc.root, id);
        if (node === null) return;
        const text = node.text === "" ? `[[${value}]]` : `${node.text} [[${value}]]`;
        this.applyDoc({ ...this.doc, root: setText(this.doc.root, id, text) });
      },
    });
  }

  /** 选中变化或重绘后同步工具栏位置与按钮可用性。 */
  private syncToolbar(): void {
    if (this.toolbar === null || this.layers === null || this.doc === null) return;

    if (this.selectedId === null || this.editingId !== null) {
      this.toolbar.hide();
      return;
    }

    const element = this.layers.nodes.querySelector<HTMLElement>(
      `.mm-node[data-id="${this.selectedId}"]`,
    );
    const node = findNode(this.doc.root, this.selectedId);
    if (element === null || node === null) {
      this.toolbar.hide();
      return;
    }

    this.toolbar.showFor(
      element,
      node.children.length > 0,
      node.id === this.doc.root.id,
    );
  }
```

把 `setSelection` 与 `render()` 的收尾都接上工具栏同步：

```ts
  private setSelection(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.refreshSelectionClasses();
    this.syncToolbar();
  }
```

在 `render()` 末尾 `this.refreshSelectionClasses();` 之后追加 `this.syncToolbar();`；在 `applyCamera()` 末尾也追加 `this.syncToolbar();`（缩放平移后工具栏需跟随节点）。

在 `attachCameraEvents()` 里判断「空白处按下」时，把工具栏与面板也算作非空白区域 —— 把 `onControls` 那一行改为：

```ts
      const target = event.target as HTMLElement;
      const onNode = target.closest(".mm-node") !== null;
      const onChrome =
        target.closest(".mm-controls, .mm-toolbar, .mm-panel, .mm-style-menu, .mm-input-popover") !==
        null;
      if (onNode || onChrome || event.button !== 0) return;
```

同样，`src/view/interaction.ts` 的 `pointerdown` 里也要跳过这些浮层，否则点工具栏会先清空选中。把该处理器开头改为：

```ts
  host.on("pointerdown", (event: PointerEvent) => {
    if (host.isEditing()) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(".mm-controls, .mm-toolbar, .mm-panel, .mm-style-menu, .mm-input-popover") !==
        null
    ) {
      return;
    }
    const id = nodeIdFrom(target);
    host.dispatch({ kind: "select", id });
    if (id !== null) host.root.focus({ preventScroll: true });
  });
```

`src/view/drag.ts` 的 `pointerdown` 同理，在取 `nodeEl` 之前加同一段跳过逻辑。

- [ ] **Step 5: 工具栏样式（追加到 `styles.css`）**

```css
.mm-toolbar {
  position: absolute;
  z-index: 25;
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 16%);
}

.mm-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  box-shadow: none;
}

.mm-toolbar-btn:hover:not(:disabled) {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}

.mm-toolbar-btn:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.mm-style-menu {
  position: absolute;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 96px;
  padding: 4px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 16%);
}

.mm-style-item {
  padding: 6px 10px;
  color: var(--text-normal);
  font-size: 13px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  box-shadow: none;
}

.mm-style-item:hover {
  background: var(--background-modifier-hover);
}

.mm-input-popover {
  position: absolute;
  z-index: 30;
  padding: 6px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 16%);
}

.mm-input-popover .mm-input {
  width: 200px;
}
```

- [ ] **Step 6: 构建**

Run: `npx tsc --noEmit && npx vitest run && node scripts/check-purity.mjs && npm run build`
Expected: 全部通过

- [ ] **Step 7: 手工验证清单**

1. 选中节点 → 工具栏贴在节点上方出现；取消选中 → 消失。
2. 选中最顶部的节点（上方空间不足）→ 工具栏翻到节点下方，完整可见。
3. 依次点「添加子节点」「添加兄弟节点」「删除节点」→ 行为与键盘一致。
4. 选中根节点 → 「添加兄弟节点」「删除节点」变灰不可点。
5. 选中叶子节点 → 「折叠子树」变灰。
6. 点「文字样式」→ 弹出加粗/斜体/删除线；点加粗后节点文字变粗，源码为 `- **文字**`；再点一次还原。
7. 点「标记」→ 弹出三段式面板；点 p1 → 节点出现红色 1 圆标；再点 p1 → 取消。
8. 面板里依次点进度各档与各色旗帜，画布与源码同步正确。
9. 点面板外部或按 `Esc` → 面板关闭且不会清空选中。
10. 点「插入链接」→ 输入笔记名回车 → 节点文字追加 `[[笔记名]]`；切到源码确认；在导图里该链接文本正常显示。
11. 缩放/平移画布 → 工具栏跟随选中节点移动，不脱节。
12. 点击工具栏按钮不会导致选中被清空、也不会触发画布平移。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: 悬浮工具栏、文字样式与插入链接"
```

---
### Task 15: 外部变更同步、错误处理与文档

**Files:**
- Modify: `src/view.ts`, `src/main.ts`, `styles.css`
- Create: `README.md`
- Test: 手工验证（含 AI 协同场景）

**Interfaces:**
- Produces:
  - `MindmapView` 新增 `private parseError: string | null`、`private lastWritten: string | null`
  - `main.ts` 新增命令 `mark-as-mindmap`：「标记为思维导图（写入 frontmatter）」

**外部变更同步（AI 协同的关键路径）**：注册 `vault.on("modify")`。当变更文件是当前文件且内容与本视图最近一次写出的内容不同，即认定为外部修改，重新解析并重绘，**保留当前相机与选中**。若此时本地尚有未落盘的防抖保存，取消它并以文件为准，同时用 `Notice` 告知用户。

**错误处理**（对应 spec §8）：`parse` 抛异常时记录 `parseError`，画布改为显示错误提示与「切换到源码模式」按钮；此时 `doc` 为 `null`，`getViewData()` 返回原始 `this.data`，因此文件不会被改写。

- [ ] **Step 1: 在 `src/view.ts` 中加入错误态与外部变更同步**

顶部 import 追加：

```ts
import { Notice, TFile } from "obsidian";
```

字段追加：

```ts
  private parseError: string | null = null;
  /** 本视图最近一次写出的文件内容，用于区分自己的写入与外部修改 */
  private lastWritten: string | null = null;
```

`setViewData` 改为：

```ts
  override setViewData(data: string, _clear: boolean): void {
    const fileName = this.file?.name ?? "未命名.md";
    try {
      const parsed = parse(data, fileName);
      this.doc = {
        ...parsed,
        root: applyCollapsedPaths(parsed.root, readCollapsed(parsed.frontmatter)),
      };
      this.parseError = null;
    } catch (error) {
      this.doc = null;
      this.parseError = String(error);
    }
    this.layers = null;
    this.render();
    if (this.parseError === null) this.fitToView();
  }
```

`getViewData` 改为记录写出内容：

```ts
  override getViewData(): string {
    if (this.doc === null) return this.data;
    const output = serialize(this.withCollapsedInFrontmatter(this.doc));
    this.lastWritten = output;
    return output;
  }
```

`render()` 开头加入错误分支：

```ts
  private render(): void {
    if (this.parseError !== null) {
      clear(this.root);
      this.toolbar = null;
      this.controls = null;
      this.renderError(this.parseError);
      return;
    }
    // ……原有逻辑
  }

  private renderError(message: string): void {
    const wrap = el("div", "mm-error", this.root);
    const title = el("div", "mm-error-title", wrap);
    title.textContent = "无法解析为思维导图";
    const detail = el("div", "mm-error-detail", wrap);
    detail.textContent = message;
    const hint = el("div", "mm-error-detail", wrap);
    hint.textContent = "文件未被修改。可切到源码模式检查内容。";

    const button = el("button", "mm-error-btn", wrap);
    button.type = "button";
    button.textContent = "切换到源码模式";
    button.addEventListener("click", () => {
      const path = this.file?.path;
      if (path === undefined) return;
      void this.leaf.setViewState({
        type: "markdown",
        state: { file: path, mode: "source" },
        active: true,
      });
    });
  }
```

新增 `onload`（注册外部变更监听）：

```ts
  override async onload(): Promise<void> {
    await super.onload();

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.path !== this.file?.path) return;
        void this.reloadFromDisk(file);
      }),
    );
  }

  /** 外部（例如 AI 直接改文件）修改后重新解析，保留相机与选中。 */
  private async reloadFromDisk(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    if (content === this.lastWritten) return;

    const hadPendingSave = this.saveTimer !== null;
    if (hadPendingSave) {
      window.clearTimeout(this.saveTimer as number);
      this.saveTimer = null;
      new Notice("文件已在外部修改，以磁盘内容为准。");
    }

    const camera = this.camera;
    const selectedId = this.selectedId;

    this.data = content;
    this.setViewData(content, false);

    this.camera = camera;
    this.selectedId = selectedId;
    this.applyCamera();
    this.refreshSelectionClasses();
    this.syncToolbar();
  }
```

注意：`reloadFromDisk` 在末尾恢复相机，所以 `setViewData` 里那次 `fitToView()` 的结果会被覆盖 —— 这是期望行为（外部改文件时视口不应跳动）。首次打开文件时没有旧相机，`fitToView()` 生效。

- [ ] **Step 2: 在 `src/main.ts` 中加入「标记为思维导图」命令**

顶部 import 追加：

```ts
import { setMindmapFlag } from "./model/collapse-state";
```

在 `onload()` 中追加：

```ts
    this.addCommand({
      id: "mark-as-mindmap",
      name: "标记为思维导图（写入 frontmatter）",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file === null || file.extension !== "md") return false;
        if (checking) return true;
        void this.markAsMindmap(file);
        return true;
      },
    });
```

新增方法：

```ts
  private async markAsMindmap(file: TFile): Promise<void> {
    await this.app.vault.process(file, (content) => {
      const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
      if (match === null) {
        return `---\n${setMindmapFlag(null, true)}\n---\n\n${content}`;
      }
      const updated = setMindmapFlag(match[1], true);
      return `---\n${updated}\n---\n${content.slice(match[0].length)}`;
    });
    new Notice("已标记为思维导图。");
  }
```

- [ ] **Step 3: 错误态样式（追加到 `styles.css`）**

```css
.mm-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  max-width: 560px;
  margin: 48px auto;
  padding: 20px 24px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 10px;
}

.mm-error-title {
  color: var(--text-error);
  font-size: 15px;
  font-weight: 600;
}

.mm-error-detail {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.mm-error-btn {
  margin-top: 4px;
}
```

- [ ] **Step 4: 写 `README.md`**

````markdown
# Obsidian 思维导图

把 Markdown 的缩进列表渲染成可编辑的思维导图。原始数据始终是普通 `.md` 文件 —— 你和 AI 读写的是同一份、结构清晰的 Markdown。

## 数据格式

一级标题是根节点，之后第一段连续的无序列表就是导图树：

```markdown
---
mindmap: true
---

# 工作内容

- 呼叫中心
  - (p1) 管理向
    - 任务安排
  - 业务向
    - (p3 30%) 部分开发自测
- WP
  - (flag:red) 理解业务流程
```

### 行内标记

节点文字最前面的一个括号组，当组内每个 token 都是已知标记时才生效：

| 写法 | 含义 |
|---|---|
| `p1` … `p7` | 优先级（p1 红、p2 橙、p3 黄、p4+ 灰） |
| `0%` … `100%` | 进度（映射到 7 档饼图，原值保留不被改写） |
| `flag:red` `flag:orange` `flag:yellow` `flag:green` `flag:blue` `flag:purple` `flag:gray` | 旗帜 |

组合写在一起：`- (p1 60% flag:blue) 节点文字`

括号里出现未知 token 时整组按普通文字处理，例如 `- (备注) 说明` 不会被当成标记。

### 与 AI 协同

插件不内置 AI 调用。让任意 AI 直接编辑这个 `.md` 文件即可 —— 新增节点只需写一行普通列表项，不涉及 id、坐标或 JSON。文件变化后画布自动刷新，视口与选中保持不动。

列表块之外的内容（frontmatter 其他键、前言、代码块、尾部段落）永不被插件改写。

## 快捷键

| 按键 | 行为 |
|---|---|
| `Tab` | 添加子节点 |
| `Enter` | 添加兄弟节点 |
| `F2` / 双击 | 编辑文字 |
| `Delete` | 删除节点及子树 |
| 方向键 | 在树中移动选中 |
| `Space` | 折叠 / 展开 |
| `Cmd/Ctrl + 滚轮` | 缩放 |
| 空白处拖拽 | 平移 |

拖拽节点可改变父节点与同层顺序。

## 命令

- **切换思维导图 / 源码视图**
- **标记为思维导图（写入 frontmatter）** —— 写入 `mindmap: true`，之后打开该文件自动进入导图视图（可在设置中关闭）

## 开发

```bash
npm install
npm run dev        # esbuild watch
npm test           # vitest
npm run typecheck
npm run check:purity
```

`src/model/` 与 `src/view/layout.ts`、`src/view/camera.ts` 是纯函数层，不依赖 Obsidian API 与 DOM，由 `npm run check:purity` 强制校验，全部有单元测试覆盖。
````

- [ ] **Step 5: 全量构建与测试**

Run: `npx tsc --noEmit && npx vitest run && node scripts/check-purity.mjs && npm run build`
Expected: 全部通过

- [ ] **Step 6: 手工验证清单**

1. **AI 协同**：在 Obsidian 里打开导图视图，同时用编辑器（或命令行 `cat >>`）给 `test-vault/工作内容.md` 追加一行 `  - (p2 50%) 新增的节点` → 画布自动出现该节点，**视口不跳动、选中不丢失**。
2. 在外部把整个文件替换成另一棵树 → 画布完整刷新，无残留节点。
3. 先在画布里改一个节点文字（不等保存），立刻在外部改同一文件 → 出现「以磁盘内容为准」提示，画布显示磁盘内容。
4. **错误态**：把文件 frontmatter 写成非法内容或构造一个能让 `parse` 抛错的输入 → 画布显示错误提示卡片；点「切换到源码模式」可回到源码；确认文件内容未被改写。
5. 执行命令「标记为思维导图（写入 frontmatter）」→ 文件出现 `mindmap: true`，其余 frontmatter 键与顺序未变；重新打开该文件自动进入导图视图。
6. 对一个**没有** frontmatter 的文件执行该命令 → 正确新建 frontmatter 块，正文未受影响。
7. 亮色与暗色主题各完整走一遍 Task 9–14 的验证清单，确认无对比度问题。
8. 关闭插件再启用，无残留 DOM、控制台无报错。
9. 用一个约 200 个节点的文件测试：打开、缩放、拖拽仍流畅，无明显卡顿。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: 外部变更同步、错误处理与项目文档"
```

---

## 完成标准

全部 15 个 Task 完成后，以下每一项都应成立：

- `npx tsc --noEmit`、`npx vitest run`、`node scripts/check-purity.mjs`、`npm run build` 四条命令全绿。
- 纯函数层（`src/model/**`、`src/view/layout.ts`、`src/view/camera.ts`）有单元测试覆盖，含 Markdown 往返属性测试。
- 在测试 vault 中完成 Task 8–15 的全部手工验证清单，亮/暗主题各一遍。
- 任意合法 Markdown 经「打开导图 → 不做修改 → 切回源码」后内容逐字节不变（唯一例外：不以换行结尾的文件会被补上尾换行）。
- AI 在外部编辑 `.md` 文件后，画布自动刷新且视口与选中保持不动。
