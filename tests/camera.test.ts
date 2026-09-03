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
