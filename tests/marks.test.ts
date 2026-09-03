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
