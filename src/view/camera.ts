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
