import type { ComicPage, PanelShot, Rect, ShotKeyframe } from "../../../shared/document";
import {
  clampFrame,
  easingValue,
  interpolateFrame,
  pageSafeArea,
  rectContainsRect,
  rectsIntersect,
} from "../../../shared/migrate";

export interface PathViolation {
  kind: "safe-area" | "unrevealed-dialogue";
  /** 采样进度 0..1 处发生 */
  at: number;
  message: string;
}
export interface PathCandidate {
  id: string;
  label: string;
  /** 路径中间点（不含起终点），均为页面坐标系取景框 */
  waypoints: Rect[];
  /** 经过安全区约束的完整路径（含起终点），时间线渲染必须使用它 */
  points: Rect[];
  feasible: boolean;
  violations: PathViolation[];
  /** 取景框中心移动总距离（像素），用于速度估算与择优 */
  distance: number;
}
export interface TransitionPlan {
  fromIndex: number;
  toIndex: number;
  candidates: PathCandidate[];
  recommended: PathCandidate;
  /** 当前选定路径在不泄露对白前提下所需的最少秒数 */
  minDuration: number;
  /** 作者在镜头设置里预留的移动窗口秒数 */
  scheduledDuration: number;
  /** 速度与揭示顺序冲突时的可读说明 */
  conflict: string;
}
const SAMPLES = 24;
const BASE_SPEED = 420;

function centerOf(r: Rect) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
function distance(a: Rect, b: Rect) {
  const ca = centerOf(a),
    cb = centerOf(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}
function routeDistance(points: Rect[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  return total;
}
/**
 * 尚未揭示的对白区域：
 * - 目标格之后的分镜：整格都是禁区，镜头完全不能扫过；
 * - 目标格自身：仅对白核心区（内缩 12%）在抵达前保密，允许贴近其边缘移动，
 *   终点取景框落在目标格上的时刻即正式揭示。
 */
export function unrevealedObstacles(page: ComicPage, toIndex: number): Rect[] {
  const target = page.panels[toIndex]?.rect;
  const later = page.panels.slice(toIndex + 1).map((p) => p.rect);
  if (!target) return later;
  const insetX = target.width * 0.12,
    insetY = target.height * 0.12;
  const core: Rect = {
    x: target.x + insetX,
    y: target.y + insetY,
    width: Math.max(1, target.width - insetX * 2),
    height: Math.max(1, target.height - insetY * 2),
  };
  return [core, ...later];
}
function allowedRegion(page: ComicPage, shot: PanelShot): Rect {
  const safe = pageSafeArea(page);
  const pad = Math.max(0, shot.safePadding);
  return {
    x: safe.x + pad,
    y: safe.y + pad,
    width: Math.max(1, safe.width - pad * 2),
    height: Math.max(1, safe.height - pad * 2),
  };
}
/** 沿若干路径点逐段采样，找出越过安全区或扫过未揭示对白的采样点 */
function sampleRoute(
  points: Rect[],
  allowed: Rect,
  obstacles: Rect[],
): PathViolation[] {
  const violations: PathViolation[] = [];
  const segments = points.length - 1;
  const targetRect = obstacles[0];
  for (let s = 0; s < segments; s++) {
    const a = points[s]!,
      b = points[s + 1]!;
    for (let i = 0; i <= SAMPLES; i++) {
      const local = i / SAMPLES,
        global = (s + local) / segments,
        frame = interpolateFrame(a, b, local);
      const isFinalPoint = s === segments - 1 && i === SAMPLES;
      if (!rectContainsRect(allowed, frame))
        violations.push({
          kind: "safe-area",
          at: global,
          message: "取景框越过了作者设定的安全可见区域",
        });
      for (const obstacle of obstacles) {
        // 终点恰好落在目标格上：此刻目标格正式揭示，不算泄露
        if (isFinalPoint && obstacle === targetRect) continue;
        if (rectsIntersect(frame, obstacle))
          violations.push({
            kind: "unrevealed-dialogue",
            at: global,
            message: "镜头扫过了尚未揭示的对白区域，存在提前剧透",
          });
      }
    }
  }
  return violations;
}
function makeCandidate(
  id: string,
  label: string,
  points: Rect[],
  allowed: Rect,
  obstacles: Rect[],
): PathCandidate {
  const violations = sampleRoute(points, allowed, obstacles);
  return {
    id,
    label,
    waypoints: points.slice(1, -1),
    points: points.map((p) => ({ ...p })),
    feasible: violations.length === 0,
    violations,
    distance: routeDistance(points),
  };
}
function shiftedKeyframe(base: Rect, dx: number, dy: number, allowed: Rect): Rect {
  return clampFrame(
    { ...base, x: base.x + dx, y: base.y + dy },
    allowed,
  );
}
/** 为单段衔接生成候选路径：直线、作者替代路径、正交绕行、侧向避让、切镜兜底 */
export function planTransition(
  page: ComicPage,
  fromIndex: number,
  toIndex: number,
): TransitionPlan {
  const from = page.panels[fromIndex],
    to = page.panels[toIndex];
  const fromShot = from?.shot,
    toShot = to?.shot;
  if (!from || !to || !fromShot || !toShot)
    throw new Error("镜头数据缺失，请先修订该页分镜");
  const start: Rect = fromShot.end,
    end: Rect = toShot.start;
  const padding = Math.max(fromShot.safePadding, toShot.safePadding);
  const allowed = allowedRegion(page, { ...fromShot, safePadding: padding });
  const safeStart = clampFrame(start, allowed),
    safeEnd = clampFrame(end, allowed);
  const obstacles = unrevealedObstacles(page, toIndex);
  const candidates: PathCandidate[] = [];
  candidates.push(
    makeCandidate(
      "straight",
      "最短直线路径",
      [safeStart, safeEnd],
      allowed,
      obstacles,
    ),
  );
  if (fromShot.alternatePath.length) {
    const points = [
      safeStart,
      ...fromShot.alternatePath.map((k) =>
        clampFrame({ ...k }, allowed),
      ),
      safeEnd,
    ];
    candidates.push(
      makeCandidate("author", "作者替代路径", points, allowed, obstacles),
    );
  }
  const deltaX = safeEnd.x - safeStart.x,
    deltaY = safeEnd.y - safeStart.y;
  const mid = interpolateFrame(safeStart, safeEnd, 0.5);
  const clearance = Math.max(safeEnd.width, safeEnd.height) * 0.9;
  const bypasses: Array<[string, string, number, number]> = [
    ["bypass-up", "上方绕行", 0, -clearance],
    ["bypass-down", "下方绕行", 0, clearance],
    ["bypass-left", "左侧绕行", -clearance, 0],
    ["bypass-right", "右侧绕行", clearance, 0],
  ];
  for (const [id, label, dx, dy] of bypasses) {
    const waypoint = shiftedKeyframe(mid, dx, dy, allowed);
    candidates.push(
      makeCandidate(
        id,
        label,
        [safeStart, waypoint, safeEnd],
        allowed,
        obstacles,
      ),
    );
  }
  // 贴边绕行：分镜占满页面时，沿安全区边缘寻找不扫过障碍的通道
  const edgeW = Math.min(safeEnd.width, allowed.width * 0.3),
    edgeH = Math.min(safeEnd.height, allowed.height * 0.3);
  const edgeWaypoints: Array<[string, string, Rect]> = [
    [
      "edge-left",
      "贴左边缘绕行",
      clampFrame({ ...mid, x: allowed.x, width: edgeW }, allowed),
    ],
    [
      "edge-right",
      "贴右边缘绕行",
      clampFrame(
        { ...mid, x: allowed.x + allowed.width - edgeW, width: edgeW },
        allowed,
      ),
    ],
    [
      "edge-top",
      "贴上边缘绕行",
      clampFrame({ ...mid, y: allowed.y, height: edgeH }, allowed),
    ],
    [
      "edge-bottom",
      "贴下边缘绕行",
      clampFrame(
        { ...mid, y: allowed.y + allowed.height - edgeH, height: edgeH },
        allowed,
      ),
    ],
  ];
  for (const [id, label, waypoint] of edgeWaypoints) {
    candidates.push(
      makeCandidate(
        id,
        label,
        [safeStart, waypoint, safeEnd],
        allowed,
        obstacles,
      ),
    );
  }
  if (Math.abs(deltaX) > 1 && Math.abs(deltaY) > 1) {
    candidates.push(
      makeCandidate(
        "orthogonal-x",
        "正交绕行 · 先横后纵",
        [
          safeStart,
          clampFrame({ ...safeStart, x: safeEnd.x }, allowed),
          safeEnd,
        ],
        allowed,
        obstacles,
      ),
    );
    candidates.push(
      makeCandidate(
        "orthogonal-y",
        "正交绕行 · 先纵后横",
        [
          safeStart,
          clampFrame({ ...safeStart, y: safeEnd.y }, allowed),
          safeEnd,
        ],
        allowed,
        obstacles,
      ),
    );
  }
  candidates.push({
    id: "cut",
    label: "完全切镜（不连续移动）",
    waypoints: [],
    points: [safeStart, safeEnd],
    feasible: true,
    violations: [],
    distance: 0,
  });
  const feasible = candidates
    .filter((c) => c.feasible && c.id !== "cut")
    .sort((a, b) => a.distance - b.distance);
  const straight = candidates[0]!;
  const recommended =
    straight.feasible || feasible.length === 0
      ? (straight.feasible ? straight : candidates.find((c) => c.id === "cut")!)
      : feasible[0]!;
  const moveScale = Math.max(0.1, fromShot.motionScale);
  const minDuration = recommended.distance / (BASE_SPEED * moveScale);
  const scheduledDuration = Math.max(
    0,
    to.duration - toShot.holdIn - toShot.holdOut,
  );
  let conflict = "";
  if (!straight.feasible && recommended.id !== "cut")
    conflict = `直线路径会提前泄露内容，已改推荐「${recommended.label}」，行程增加 ${Math.round(
      recommended.distance - straight.distance,
    )}px`;
  else if (!straight.feasible)
    conflict = "不存在安全的连续移动路径，建议改为切镜衔接";
  if (recommended.id !== "cut" && minDuration > scheduledDuration)
    conflict +=
      (conflict ? "；" : "") +
      `当前速度至少需要 ${minDuration.toFixed(1)}s，超过预留窗口 ${scheduledDuration.toFixed(
        1,
      )}s：可调高速度系数、缩短停留或改用切镜`;
  return {
    fromIndex,
    toIndex,
    candidates,
    recommended,
    minDuration,
    scheduledDuration,
    conflict,
  };
}
export interface PagePlan {
  transitions: TransitionPlan[];
  hasConflict: boolean;
  staleCount: number;
  /** 格内取景（停留/推进）本身扫到未揭示对白区的分镜 id */
  framingLeakPanelIds: string[];
}
/** 检查某格自身的起止取景框与格内推进是否扫到尚未揭示的对白区 */
export function framingLeaks(
  page: ComicPage,
  panelIndex: number,
): PathViolation[] {
  const panel = page.panels[panelIndex];
  const shot = panel?.shot;
  if (!panel || !shot) return [];
  // 格内取景只可能扫到「之后」的格，本格自身是已揭示内容
  const obstacles = page.panels.slice(panelIndex + 1).map((p) => p.rect);
  if (!obstacles.length) return [];
  const violations: PathViolation[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const frame = interpolateFrame(
      keyframeToRect(shot.start),
      keyframeToRect(shot.end),
      i / SAMPLES,
    );
    const hit = obstacles.find((o) => rectsIntersect(frame, o));
    if (hit)
      violations.push({
        kind: "unrevealed-dialogue",
        at: i / SAMPLES,
        message: `第 ${panelIndex + 1} 格的取景框覆盖了尚未揭示的对白区域`,
      });
  }
  return violations;
}
export function planPage(page: ComicPage): PagePlan {
  const transitions: TransitionPlan[] = [];
  for (let i = 0; i < page.panels.length - 1; i++)
    transitions.push(planTransition(page, i, i + 1));
  const framingLeakPanelIds = page.panels
    .map((p, i) => ({ id: p.id, leaks: framingLeaks(page, i) }))
    .filter((x) => x.leaks.length > 0)
    .map((x) => x.id);
  return {
    transitions,
    hasConflict:
      transitions.some((t) => t.conflict !== "") ||
      framingLeakPanelIds.length > 0,
    staleCount: page.panels.filter((p) => p.shot?.stale).length,
    framingLeakPanelIds,
  };
}
/** 按时间线的路径点与缓动求某进度下的实际取景框 */
export function frameAlongRoute(
  points: Rect[],
  easing: PanelShot["easing"],
  t: number,
): Rect {
  if (points.length === 1) return points[0]!;
  const segments = points.length - 1;
  const eased = easingValue(easing, t);
  const scaled = eased * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const local = scaled - index;
  return interpolateFrame(points[index]!, points[index + 1]!, local);
}
export function keyframeToRect(k: ShotKeyframe): Rect {
  return { x: k.x, y: k.y, width: k.width, height: k.height };
}
