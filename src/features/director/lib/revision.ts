import type {
  ComicDocument,
  ComicPage,
  Panel,
  PanelShot,
  Rect,
} from "../../../shared/document";
import {
  clampFrame,
  defaultShot,
  pageSafeArea,
  rectContainsRect,
} from "../../../shared/migrate";

function allowed(page: ComicPage, shot: PanelShot): Rect {
  const safe = pageSafeArea(page);
  const pad = Math.max(0, shot.safePadding);
  return {
    x: safe.x + pad,
    y: safe.y + pad,
    width: Math.max(1, safe.width - pad * 2),
    height: Math.max(1, safe.height - pad * 2),
  };
}
function shotFits(page: ComicPage, panel: Panel): boolean {
  const shot = panel.shot;
  if (!shot) return false;
  const region = allowed(page, shot);
  return (
    rectContainsRect(region, { ...shot.start }) &&
    rectContainsRect(region, { ...shot.end }) &&
    shot.alternatePath.every((k) =>
      rectContainsRect(region, { x: k.x, y: k.y, width: k.width, height: k.height }),
    )
  );
}
function mark(panel: Panel | undefined) {
  if (panel?.shot) panel.shot.stale = true;
}
/** 布局（分镜矩形）变更：只令本格及与它保持连续移动的相邻格待修订 */
export function markLayoutChanged(page: ComicPage, panelId: string) {
  const index = page.panels.findIndex((p) => p.id === panelId);
  if (index < 0) return;
  mark(page.panels[index]);
  const prev = page.panels[index - 1],
    next = page.panels[index + 1];
  if (prev?.shot?.transition === "pan") mark(prev);
  if (page.panels[index]?.shot?.transition === "pan") mark(next);
  page.panels.forEach((p) => {
    if (p.shot && !shotFits(page, p)) p.shot.stale = true;
  });
}
/** 删除中间格：只让原本与它连续移动的衔接方待修订，其余镜头不动 */
export function markPanelRemoved(
  page: ComicPage,
  removedIndex: number,
  removedTransition: PanelShot["transition"] | undefined,
) {
  const prev = page.panels[removedIndex - 1],
    next = page.panels[removedIndex];
  // 上一格原来用连续移动指向被删格，衔接目标已经失效
  if (prev?.shot?.transition === "pan") mark(prev);
  // 被删格原本用连续移动指向现在的下一格，该格的入场路径来源失效
  if (next && removedTransition === "pan") mark(next);
  page.panels.forEach((p) => {
    if (p.shot && !shotFits(page, p)) p.shot.stale = true;
  });
}
export function removePanel(page: ComicPage, panelId: string): boolean {
  if (page.panels.length <= 1) return false;
  const index = page.panels.findIndex((p) => p.id === panelId);
  if (index < 0) return false;
  const removedTransition = page.panels[index]!.shot?.transition;
  page.panels.splice(index, 1);
  markPanelRemoved(page, index, removedTransition);
  return true;
}
export function addPanelAfter(page: ComicPage, panelId: string, rect: Rect): Panel {
  const index = page.panels.findIndex((p) => p.id === panelId);
  const panel: Panel = {
    id: `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    rect,
    dialogue: "新分镜：等待编写对白。",
    speaker: "旁白",
    sound: "wind",
    duration: 5,
  };
  panel.shot = { ...defaultShot(panel, 0, 1), stale: true };
  page.panels.splice(index + 1, 0, panel);
  // 原下一格的入场衔接来源发生变化，需要重新确认
  const following = page.panels[index + 2];
  if (following) mark(following);
  if (page.panels[index]?.shot?.transition === "pan")
    mark(page.panels[index]);
  return panel;
}
/** 安全可见区收紧：只把不再落在区域内的镜头标为待修订 */
export function updateSafeArea(page: ComicPage, safe: Rect) {
  page.safeArea = { ...safe };
  page.panels.forEach((panel) => {
    if (panel.shot && !shotFits(page, panel)) panel.shot.stale = true;
  });
}
/** 修订单格：重新生成默认镜头并把取景框约束回安全区，清除待修订标记 */
export function reviseShot(page: ComicPage, panelId: string) {
  const index = page.panels.findIndex((p) => p.id === panelId);
  const panel = page.panels[index];
  if (!panel) return;
  const regenerated = defaultShot(panel, index, page.panels.length);
  const safe = pageSafeArea(page);
  regenerated.start = {
    ...clampFrame({ ...regenerated.start }, safe),
  } as PanelShot["start"];
  regenerated.end = {
    ...clampFrame({ ...regenerated.end }, safe),
  } as PanelShot["end"];
  regenerated.alternatePath = [];
  panel.shot = regenerated;
}
export function reviseAllStale(doc: ComicDocument) {
  for (const chapter of doc.chapters)
    for (const page of chapter.pages)
      for (const panel of page.panels)
        if (panel.shot?.stale) reviseShot(page, panel.id);
}
export function staleSummary(doc: ComicDocument) {
  let pages = 0,
    panels = 0;
  for (const chapter of doc.chapters)
    for (const page of chapter.pages) {
      const n = page.panels.filter((p) => p.shot?.stale).length;
      if (n) {
        pages++;
        panels += n;
      }
    }
  return { pages, panels };
}
