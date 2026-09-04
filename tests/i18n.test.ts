import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCALES,
  MESSAGES,
  resolveLocale,
  setLocale,
  t,
  type MessageKey,
} from "../src/i18n";
import { findChineseLiterals, stripComments } from "../scripts/check-i18n.mjs";

describe("resolveLocale", () => {
  it("显式取值直接生效，忽略 Obsidian 的语言", () => {
    expect(resolveLocale("zh", "en")).toBe("zh");
    expect(resolveLocale("en", "zh")).toBe("en");
  });

  it("auto 跟随 Obsidian：zh 前缀归中文", () => {
    expect(resolveLocale("auto", "zh")).toBe("zh");
    expect(resolveLocale("auto", "zh-TW")).toBe("zh");
    expect(resolveLocale("auto", "zh-HK")).toBe("zh");
  });

  it("auto 跟随 Obsidian：其余一律英文", () => {
    expect(resolveLocale("auto", "en")).toBe("en");
    expect(resolveLocale("auto", "ja")).toBe("en");
    expect(resolveLocale("auto", "")).toBe("en");
  });
});

describe("字典完整性", () => {
  it("两表 key 集合完全相同", () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.zh).sort());
  });

  it("没有空串值——类型系统挡不住空字符串", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        expect(value, `${locale}.${key} 为空`).not.toBe("");
      }
    }
  });

  it("两表的插值占位符集合一致，漏一个参数就是漏一段文案", () => {
    const holders = (s: string): string[] =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(MESSAGES.zh) as MessageKey[]) {
      expect(holders(MESSAGES.en[key]), `key ${key} 的占位符不一致`).toEqual(
        holders(MESSAGES.zh[key]),
      );
    }
  });
});

describe("t", () => {
  beforeEach(() => setLocale("zh"));

  it("按当前语言取值", () => {
    expect(t("toolbar.addChild")).toBe("添加子节点");
    setLocale("en");
    expect(t("toolbar.addChild")).toBe("Add child node");
  });

  it("插值替换 {name}", () => {
    expect(t("notice.createFailed", { error: "EACCES" })).toBe(
      "新建思维导图失败：EACCES",
    );
  });

  it("插值接受数字", () => {
    expect(t("badge.priority", { priority: 3 })).toBe("优先级 3");
  });

  it("英文表的插值同样生效", () => {
    setLocale("en");
    expect(t("badge.progress", { progress: 60 })).toBe("Progress 60%");
  });

  it("参数缺失时保留 {name} 字面量，不抛异常", () => {
    // 面向用户的文案出问题不该让渲染管线崩掉
    expect(t("notice.createFailed")).toBe("新建思维导图失败：{error}");
  });

  it("多余的参数被忽略", () => {
    expect(t("toolbar.addChild", { unused: "x" })).toBe("添加子节点");
  });

  it("语言名在两种语言下都用它自己的语言写", () => {
    setLocale("zh");
    expect(t("settings.language.zh")).toBe("简体中文");
    expect(t("settings.language.en")).toBe("English");
    setLocale("en");
    expect(t("settings.language.zh")).toBe("简体中文");
    expect(t("settings.language.en")).toBe("English");
  });
});

describe("check-i18n 的注释剥离", () => {
  it("去掉行注释", () => {
    expect(stripComments("const a = 1; // 这是中文注释\n")).toBe("const a = 1; \n");
  });

  it("去掉块注释，含跨行（保留换行以维持行号）", () => {
    expect(stripComments("/* 中文\n多行 */const a = 1;")).toBe("\nconst a = 1;");
  });

  it("不误删字符串里的 // —— 朴素实现会把 URL 截断", () => {
    const src = 'const u = "https://example.com/中文";';
    expect(stripComments(src)).toContain("https://example.com/中文");
  });

  it("不被注释里的引号带偏", () => {
    const src = '// 注释里有一个 " 引号\nconst a = "干净";';
    expect(stripComments(src)).toContain('"干净"');
  });
});

describe("check-i18n 的中文字面量检测", () => {
  it("命中双引号里的中文", () => {
    expect(findChineseLiterals('const a = "中文";')).toEqual([
      { line: 1, literal: '"中文"' },
    ]);
  });

  it("命中反引号里的中文 —— 漏掉反引号就会整个漏掉 node-el.ts", () => {
    expect(findChineseLiterals("const a = `优先级 ${n}`;")).toHaveLength(1);
  });

  it("不命中注释里的中文", () => {
    expect(findChineseLiterals("// 中文注释\nconst a = 1;")).toEqual([]);
  });

  it("不命中纯英文字面量", () => {
    expect(findChineseLiterals('const a = "ok";')).toEqual([]);
  });

  it("行号是剥离注释后仍然正确的原始行号", () => {
    const src = "// 注释\n// 注释\nconst a = \"中文\";";
    expect(findChineseLiterals(src)[0].line).toBe(3);
  });
});
