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
