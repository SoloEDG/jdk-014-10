import type { ComicPage, PanelShot, Rect } from "../../../shared/document";
import {
  frameAlongRoute,
  keyframeToRect,
  planTransition,
  type PathCandidate,
} from "./planner";

export type SegmentKind = "hold" | "move" | "transition-pan" | "cut";
export interface TimelineSegment {
  id: string;
  panelId: string;
  panelIndex: number;
  kind: SegmentKind;
  start: number;
  end: number;
  frames: Rect[];
  easing: PanelShot["easing"];
}
export interface TimelineCue {
  id: string;
  panelId: string;
  kind: "sound" | "dialogue";
  /** 页面时间线中的绝对触发秒数 */
  at: number;
}
export interface PageTimeline {
  pageId: string;
  duration: number;
  segments: TimelineSegment[];
  cues: TimelineCue[];
  /** 待修订格：预演只能停在它之前的明确边界 */
  blockedPanelId: string | null;
  boundaryTime: number;
  routes: Record<string, PathCandidate>;
}
const CUT_DURATION = 0.12;

export type RouteResolver = (
  fromIndex: number,
  toIndex: number,
) => string | undefined;

export function buildTimeline(
  page: ComicPage,
  resolveRoute?: RouteResolver,
): PageTimeline {
  const segments: TimelineSegment[] = [];
  const cues: TimelineCue[] = [];
  const routes: Record<string, PathCandidate> = {};
  let cursor = 0;
  let blockedPanelId: string | null = null;

  for (let i = 0; i < page.panels.length; i++) {
    const panel = page.panels[i]!;
    const shot = panel.shot;
    if (!shot || shot.stale) {
      blockedPanelId = panel.id;
      break;
    }
    const startFrame = keyframeToRect(shot.start),
      endFrame = keyframeToRect(shot.end);
    const moveDuration = Math.max(
      0,
      panel.duration - shot.holdIn - shot.holdOut,
    );
    const ownStart = cursor;
    if (shot.holdIn > 0) {
      segments.push({
        id: `${panel.id}:hold-in`,
        panelId: panel.id,
        panelIndex: i,
        kind: "hold",
        start: cursor,
        end: cursor + shot.holdIn,
        frames: [startFrame],
        easing: "hold",
      });
      cursor += shot.holdIn;
    }
    if (moveDuration > 0) {
      segments.push({
        id: `${panel.id}:move`,
        panelId: panel.id,
        panelIndex: i,
        kind: "move",
        start: cursor,
        end: cursor + moveDuration,
        frames: [startFrame, endFrame],
        easing: shot.easing,
      });
      cursor += moveDuration;
    }
    if (shot.holdOut > 0) {
      segments.push({
        id: `${panel.id}:hold-out`,
        panelId: panel.id,
        panelIndex: i,
        kind: "hold",
        start: cursor,
        end: cursor + shot.holdOut,
        frames: [endFrame],
        easing: "hold",
      });
      cursor += shot.holdOut;
    }
    const ownDuration = Math.max(0.001, cursor - ownStart);
    cues.push({
      id: `${panel.id}:sound`,
      panelId: panel.id,
      kind: "sound",
      at: ownStart + shot.soundAt * ownDuration,
    });
    cues.push({
      id: `${panel.id}:dialogue`,
      panelId: panel.id,
      kind: "dialogue",
      at: ownStart + shot.dialogueAt * ownDuration,
    });
    if (i < page.panels.length - 1) {
      const plan = planTransition(page, i, i + 1);
      const preferred = resolveRoute?.(i, i + 1);
      const cutCandidate = plan.candidates.find((c) => c.id === "cut")!;
      let chosen: PathCandidate;
      if (shot.transition === "cut") {
        chosen = cutCandidate;
      } else {
        const picked =
          plan.candidates.find((c) => c.id === preferred && c.feasible) ??
          plan.recommended;
        chosen = picked.feasible && picked.id !== "cut" ? picked : plan.recommended;
      }
      routes[`${i}->${i + 1}`] = chosen;
      if (chosen.id === "cut") {
        segments.push({
          id: `${panel.id}:cut`,
          panelId: panel.id,
          panelIndex: i,
          kind: "cut",
          start: cursor,
          end: cursor + CUT_DURATION,
          frames: [endFrame],
          easing: "hold",
        });
        cursor += CUT_DURATION;
      } else {
        // 直接复用规划器验证过的完整路径，保证渲染帧与安全性判定完全一致
        const points = chosen.points.map((p) => ({ ...p }));
        segments.push({
          id: `${panel.id}:transition`,
          panelId: panel.id,
          panelIndex: i,
          kind: "transition-pan",
          start: cursor,
          end:
            cursor +
            Math.max(
              (chosen.distance /
                Math.max(0.1, shot.motionScale) /
                420),
              0.2,
            ),
          frames: points,
          easing: shot.easing,
        });
        cursor += Math.max(
          chosen.distance / Math.max(0.1, shot.motionScale) / 420,
          0.2,
        );
      }
    }
  }
  return {
    pageId: page.id,
    duration: cursor,
    segments,
    cues: cues.sort((a, b) => a.at - b.at),
    blockedPanelId,
    boundaryTime: cursor,
    routes,
  };
}

export function segmentAt(
  timeline: PageTimeline,
  time: number,
): TimelineSegment | null {
  const t = Math.max(0, Math.min(time, timeline.duration));
  return (
    timeline.segments.find((s) => t >= s.start && t < s.end) ??
    timeline.segments[timeline.segments.length - 1] ??
    null
  );
}

export function frameAt(timeline: PageTimeline, time: number): Rect | null {
  const segment = segmentAt(timeline, time);
  if (!segment) return null;
  if (segment.kind === "hold" || segment.kind === "cut")
    return segment.frames[0]!;
  const u =
    (time - segment.start) / Math.max(0.001, segment.end - segment.start);
  return frameAlongRoute(segment.frames, segment.easing, u);
}

/** 每格在时间线上的起始时刻，供点击缩略图跳转 */
export function panelStartTime(timeline: PageTimeline, panelId: string) {
  return timeline.segments.find((s) => s.panelId === panelId)?.start ?? 0;
}

export function cueState(
  timeline: PageTimeline,
  time: number,
  fired: ReadonlySet<string>,
) {
  return {
    due: timeline.cues.filter((c) => !fired.has(c.id) && c.at <= time),
    activeDialogue: timeline.cues
      .filter((c) => c.kind === "dialogue" && c.at <= time)
      .at(-1),
  };
}
