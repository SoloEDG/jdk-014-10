import type {
  ComicDocument,
  ComicPage,
  Panel,
  PanelShot,
  Rect,
  ShotKeyframe,
  ShotTransition,
} from "./document";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
export function rectsIntersect(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
export function rectContainsRect(outer: Rect, inner: Rect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
/** 把取景框收缩/平移进安全区；无法容纳时按安全区比例裁剪 */
export function clampFrame(frame: Rect, safe: Rect): Rect {
  const width = Math.min(frame.width, safe.width);
  const height = Math.min(frame.height, safe.height);
  const x = clamp(
    frame.x,
    safe.x,
    Math.max(safe.x, safe.x + safe.width - width),
  );
  const y = clamp(
    frame.y,
    safe.y,
    Math.max(safe.y, safe.y + safe.height - height),
  );
  return { x, y, width, height };
}
export function interpolateFrame(a: Rect, b: Rect, t: number): Rect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}
export function easingValue(
  easing: PanelShot["easing"],
  t: number,
): number {
  if (easing === "linear" || easing === "hold") return t;
  if (easing === "easeInOut")
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return 1 - Math.pow(1 - t, 3);
}
/** 默认镜头：取分镜整体，带轻微推进；末格默认切镜，其余连续平移 */
export function defaultShot(panel: Panel, index: number, total: number): PanelShot {
  const frame: ShotKeyframe = {
    x: panel.rect.x,
    y: panel.rect.y,
    width: panel.rect.width,
    height: panel.rect.height,
  };
  const inset = Math.min(panel.rect.width, panel.rect.height) * 0.08;
  const end: ShotKeyframe = {
    x: frame.x + inset,
    y: frame.y + inset,
    width: frame.width - inset * 2,
    height: frame.height - inset * 2,
  };
  const transition: ShotTransition = index === total - 1 ? "cut" : "pan";
  return {
    start: frame,
    end,
    holdIn: Math.min(1.2, panel.duration * 0.25),
    holdOut: Math.min(1, panel.duration * 0.2),
    transition,
    easing: "easeInOut",
    motionScale: 1,
    safePadding: 8,
    alternatePath: [],
    dialogueAt: 0.15,
    soundAt: 0.05,
  };
}
export function pageSafeArea(page: ComicPage): Rect {
  return page.safeArea ?? { x: 0, y: 0, width: page.width, height: page.height };
}
/** 迁移旧文档：补齐安全区与每格镜头，不改动既有字段 */
export function migrateDocument(doc: ComicDocument): ComicDocument {
  for (const chapter of doc.chapters ?? []) {
    for (const page of chapter.pages ?? []) {
      if (!page.safeArea)
        page.safeArea = { x: 0, y: 0, width: page.width, height: page.height };
      page.panels.forEach((panel, i) => {
        if (!panel.shot) panel.shot = defaultShot(panel, i, page.panels.length);
      });
    }
  }
  return doc;
}
