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

/** 以视口坐标 (px, py) 为不动点，缩放到指定倍率。
 *
 *  与 `zoomAt` 的区别只在参数语义：这里给的是**目标倍率**而不是相乘的系数，
 *  所以「回到 100%」不需要算 `1 / camera.scale` 再乘回去——那样浮点误差会让
 *  倍率停在 0.9999…，读数显示 100% 但实际不是原始大小。 */
export function zoomTo(
  camera: Camera,
  target: number,
  px: number,
  py: number,
): Camera {
  const scale = clampScale(target);
  if (scale === camera.scale) return camera;

  const ratio = scale / camera.scale;
  return {
    scale,
    x: px - (px - camera.x) * ratio,
    y: py - (py - camera.y) * ratio,
  };
}

/** 以视口坐标 (px, py) 为不动点缩放。 */
export function zoomAt(
  camera: Camera,
  factor: number,
  px: number,
  py: number,
): Camera {
  return zoomTo(camera, camera.scale * factor, px, py);
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { scale: camera.scale, x: camera.x + dx, y: camera.y + dy };
}

interface Box {
  width: number;
  height: number;
}

/** 视口或内容尚未拿到真实尺寸。此时任何相机计算都只会产出 NaN 或无意义的偏移。 */
function degenerate(content: Box, viewport: Box): boolean {
  return (
    content.width <= 0 || content.height <= 0 ||
    viewport.width <= 0 || viewport.height <= 0
  );
}

/** 等比缩放使内容完整可见并居中；内容小于视口时不放大。 */
export function fit(content: Box, viewport: Box): Camera {
  if (degenerate(content, viewport)) return IDENTITY;

  const scale = clampScale(
    Math.min(1, viewport.width / content.width, viewport.height / content.height),
  );

  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}

/**
 * 100% 原始大小的初始相机（设置项「打开导图时的缩放」选 100% 时走这里）。
 *
 * 横向**不居中**：内容比视口宽时居中会把视口摆到导图中间的某几列上，根节点在
 * 屏幕外左侧——打开就迷路。内容框左边缘（`layout.ts` 的 padding 之内就是根
 * 节点）对齐到视口左边缘，比视口窄时才居中。
 *
 * 纵向照常居中：`layout.ts` 把父节点摆在子树的垂直中点，根节点因此位于整个
 * 内容框的垂直中点，居中即「根节点在视口左中位置」。
 */
export function actualSize(content: Box, viewport: Box): Camera {
  if (degenerate(content, viewport)) return IDENTITY;

  return {
    scale: 1,
    x: Math.max(0, (viewport.width - content.width) / 2),
    y: (viewport.height - content.height) / 2,
  };
}

export function cssTransform(camera: Camera): string {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
}
