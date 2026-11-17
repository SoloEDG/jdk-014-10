import { computed, ref, type ComputedRef, type Ref } from "vue";
import type {
  ComicPage,
  Panel,
  PanelShot,
  Rect,
  ShotKeyframe,
} from "../../../shared/document";
import { clampFrame, pageSafeArea } from "../../../shared/migrate";
import { usePreviewEngine, type PreviewCueEvent } from "./preview";
import { planPage, planTransition, type PathCandidate } from "../lib/planner";
import {
  markLayoutChanged,
  removePanel as removePanelOp,
  addPanelAfter as addPanelOp,
  reviseShot as reviseShotOp,
  updateSafeArea as updateSafeAreaOp,
} from "../lib/revision";

export function useDirector(
  page: ComputedRef<ComicPage | undefined>,
  location: Ref<{ panelId: string }>,
  hooks: {
    onSoundCue: (panel: Panel) => void;
    onPanelEnter: (panelId: string) => void;
  },
) {
  const showOverlay = ref(true);
  const routeChoices = ref<Record<string, string>>({});
  const lastCue = ref<PreviewCueEvent | null>(null);
  const selectedPanelId = computed({
    get: () => location.value.panelId,
    set: (id: string) => {
      hooks.onPanelEnter(id);
    },
  });

  function panelById(id: string) {
    return page.value?.panels.find((p) => p.id === id);
  }
  function handleCue(event: PreviewCueEvent) {
    lastCue.value = event;
    const panel = panelById(event.cue.panelId);
    if (!panel) return;
    // 只有声音是边缘触发；对白由时间线位置确定性推导，避免拖动后状态错乱
    if (event.cue.kind === "sound") hooks.onSoundCue(panel);
  }
  const engine = usePreviewEngine(page, handleCue, (from, to) =>
    routeChoices.value[`${from}->${to}`],
  );

  const selectedPanel = computed<Panel | undefined>(() =>
    page.value?.panels.find((p) => p.id === selectedPanelId.value),
  );
  const plan = computed(() =>
    page.value
      ? planPage(page.value)
      : {
          transitions: [],
          hasConflict: false,
          staleCount: 0,
          framingLeakPanelIds: [],
        },
  );
  const conflicts = computed(() => {
    const rows = plan.value.transitions
      .map((t, i) => ({ index: i, text: t.conflict }))
      .filter((c) => c.text !== "");
    for (const id of plan.value.framingLeakPanelIds) {
      const index = page.value?.panels.findIndex((p) => p.id === id) ?? -1;
      rows.push({
        index,
        text: `第 ${index + 1} 格自身取景覆盖了尚未揭示的对白核心区，请收紧取景或改为切镜`,
      });
    }
    return rows;
  });

  function updateShot(panelId: string, patch: Partial<PanelShot>) {
    const target = page.value?.panels.find((p) => p.id === panelId);
    if (!target?.shot) return;
    Object.assign(target.shot, patch);
  }
  function updateKeyframe(
    panelId: string,
    which: "start" | "end",
    patch: Partial<ShotKeyframe>,
  ) {
    const target = page.value?.panels.find((p) => p.id === panelId);
    if (!target?.shot || !page.value) return;
    const next = { ...target.shot[which], ...patch };
    target.shot[which] = {
      ...clampFrame(next, pageSafeArea(page.value)),
    } as ShotKeyframe;
    markLayoutChanged(page.value, panelId);
  }
  function setTransition(panelId: string, transition: PanelShot["transition"]) {
    updateShot(panelId, { transition });
  }
  function chooseRoute(transitionKey: string, candidateId: string) {
    routeChoices.value[transitionKey] = candidateId;
  }
  function chosenRoute(transitionKey: string): PathCandidate | undefined {
    const index = Number(transitionKey.split("->")[0]);
    const t = plan.value.transitions.find((x) => x.fromIndex === index);
    if (!t) return undefined;
    const choiceId = routeChoices.value[transitionKey];
    return (
      t.candidates.find((c) => c.id === choiceId) ?? t.recommended
    );
  }
  function markLayout(panelId: string) {
    if (page.value) markLayoutChanged(page.value, panelId);
  }
  function removePanel(panelId: string) {
    if (!page.value) return;
    removePanelOp(page.value, panelId);
    if (selectedPanelId.value === panelId)
      selectedPanelId.value = page.value.panels[0]?.id ?? "";
  }
  function addPanel() {
    if (!page.value || !selectedPanel.value) return;
    const anchor = selectedPanel.value;
    const rect: Rect = {
      x: anchor.rect.x,
      y: anchor.rect.y,
      width: anchor.rect.width,
      height: Math.max(80, anchor.rect.height * 0.6),
    };
    const created = addPanelOp(page.value, anchor.id, rect);
    selectedPanelId.value = created.id;
  }
  function reviseShot(panelId: string) {
    if (!page.value) return;
    reviseShotOp(page.value, panelId);
    engine.boundaryNotice.value = "";
  }
  function setSafeArea(safe: Rect) {
    if (page.value) updateSafeAreaOp(page.value, safe);
  }
  function resetSafeArea() {
    if (!page.value) return;
    updateSafeAreaOp(page.value, {
      x: 0,
      y: 0,
      width: page.value.width,
      height: page.value.height,
    });
  }
  function transitionKey(fromIndex: number) {
    return `${fromIndex}->${fromIndex + 1}`;
  }
  function planFor(panelIndex: number) {
    if (!page.value || panelIndex >= page.value.panels.length - 1) return null;
    return planTransition(page.value, panelIndex, panelIndex + 1);
  }
  return {
    engine,
    showOverlay,
    selectedPanel,
    plan,
    conflicts,
    lastCue,
    updateShot,
    updateKeyframe,
    setTransition,
    chooseRoute,
    chosenRoute,
    markLayout,
    removePanel,
    addPanel,
    reviseShot,
    setSafeArea,
    resetSafeArea,
    transitionKey,
    planFor,
    onPanelEnter: hooks.onPanelEnter,
  };
}
export type Director = ReturnType<typeof useDirector>;
