import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import type { ComicPage, Rect } from "../../../shared/document";
import {
  buildTimeline,
  cueState,
  frameAt,
  segmentAt,
  type PageTimeline,
  type RouteResolver,
  type TimelineCue,
} from "../lib/timeline";

export interface PreviewCueEvent {
  cue: TimelineCue;
  pageId: string;
}
export function usePreviewEngine(
  page: ComputedRef<ComicPage | undefined>,
  onCue: (event: PreviewCueEvent) => void,
  resolveRoute?: RouteResolver,
) {
  const playing = ref(false);
  const time = ref(0);
  const fired = shallowRef<Set<string>>(new Set());
  const boundaryNotice = ref("");
  const cutPulse = ref(0);
  const timeline = computed<PageTimeline | null>(() =>
    page.value ? buildTimeline(page.value, resolveRoute) : null,
  );
  const duration = computed(() => timeline.value?.duration ?? 0);
  const clampedTime = computed(() =>
    Math.min(time.value, timeline.value?.boundaryTime ?? 0),
  );
  const frame = computed<Rect | null>(() =>
    timeline.value ? frameAt(timeline.value, clampedTime.value) : null,
  );
  const activeSegment = computed(() =>
    timeline.value ? segmentAt(timeline.value, clampedTime.value) : null,
  );
  const activePanelId = computed(() => activeSegment.value?.panelId ?? null);
  const blocked = computed(() => timeline.value?.blockedPanelId ?? null);
  /**
   * 当前时刻应显示的对白：由时间线位置确定性推导，
   * 与一次性触发集合无关——向回拖动也能正确显示当时已揭示的对白
   */
  const activeDialogue = computed(() => {
    const tl = timeline.value;
    if (!tl) return null;
    return (
      tl.cues
        .filter((c) => c.kind === "dialogue" && c.at <= clampedTime.value)
        .at(-1) ?? null
    );
  });

  let raf = 0;
  let lastStamp = 0;
  function clearRaf() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastStamp = 0;
  }
  function tick(stamp: number) {
    const tl = timeline.value;
    if (!tl || !playing.value) return;
    if (!lastStamp) lastStamp = stamp;
    const delta = Math.min(0.1, (stamp - lastStamp) / 1000);
    lastStamp = stamp;
    const before = time.value;
    time.value = Math.min(time.value + delta, tl.boundaryTime);
    const next = cueState(tl, time.value, fired.value);
    if (next.due.length) {
      const set = new Set(fired.value);
      for (const cue of next.due) {
        set.add(cue.id);
        onCue({ cue, pageId: tl.pageId });
      }
      fired.value = set;
    }
    const segment = segmentAt(tl, time.value);
    if (segment?.kind === "cut") {
      const entered =
        time.value - segment.start >= 0 && before - segment.start < 0;
      if (entered) cutPulse.value++;
    }
    // 待修订边界：明确停靠，绝不把失效段计入阅读进度
    if (time.value >= tl.boundaryTime) {
      playing.value = false;
      boundaryNotice.value = tl.blockedPanelId
        ? "预演已停在待修订镜头边界：修订后才能继续计入阅读进度"
        : "本页预演已结束";
      clearRaf();
      return;
    }
    raf = requestAnimationFrame(tick);
  }
  function play() {
    const tl = timeline.value;
    if (!tl) return;
    if (time.value >= tl.boundaryTime - 0.001) {
      if (tl.blockedPanelId) {
        boundaryNotice.value = "存在待修订镜头，请先修订再从头预演";
        return;
      }
      time.value = 0;
      fired.value = new Set();
    }
    boundaryNotice.value = "";
    playing.value = true;
    clearRaf();
    raf = requestAnimationFrame(tick);
  }
  function pause() {
    playing.value = false;
    clearRaf();
  }
  function toggle() {
    if (playing.value) pause();
    else play();
  }
  /** 拖动预演位置：只更新画面，已结束的触发不重播 */
  function seek(value: number) {
    const tl = timeline.value;
    if (!tl) return;
    const target = Math.max(0, Math.min(value, tl.boundaryTime));
    time.value = target;
    const due = cueState(tl, target, fired.value);
    if (due.due.length) {
      const set = new Set(fired.value);
      // 拖过的触发一次性静默标记，不产生声音/对白重播
      due.due.forEach((cue) => set.add(cue.id));
      fired.value = set;
    }
    if (target >= tl.boundaryTime - 0.001 && tl.blockedPanelId)
      boundaryNotice.value = "已拖到待修订镜头边界，失效段不会计入阅读进度";
  }
  function seekPanel(panelId: string) {
    const tl = timeline.value;
    if (!tl) return;
    const segment = tl.segments.find((s) => s.panelId === panelId);
    const panel = page.value?.panels.find((p) => p.id === panelId);
    // 待修订格及其后的格不在有效时间线内：明确停在边界，绝不跨入失效段
    if (!segment || panel?.shot?.stale) {
      boundaryNotice.value = "该镜头位于待修订边界之后，预演不能跨入失效段";
      seek(tl.boundaryTime);
      return;
    }
    seek(segment.start);
  }
  function reset() {
    pause();
    time.value = 0;
    fired.value = new Set();
    boundaryNotice.value = "";
  }
  // 切换页面或布局改动导致时间线重建：回到起点，保留失效边界提示
  watch(
    () => page.value?.id,
    () => reset(),
  );
  watch(timeline, (tl) => {
    if (tl && time.value > tl.boundaryTime) time.value = tl.boundaryTime;
    if (tl?.blockedPanelId)
      boundaryNotice.value = "本页存在待修订镜头，预演将停在明确边界";
  });
  onBeforeUnmount(clearRaf);
  return {
    timeline,
    playing,
    time: clampedTime,
    rawTime: time,
    duration,
    frame,
    activeSegment,
    activePanelId,
    activeDialogue,
    blocked,
    boundaryNotice,
    cutPulse,
    play,
    pause,
    toggle,
    seek,
    seekPanel,
    reset,
  };
}
export type PreviewEngine = ReturnType<typeof usePreviewEngine>;
