import { ref, computed, watch, onBeforeUnmount, type ComputedRef } from "vue";
import type { Panel } from "../../../shared/document";
import { AmbientSynth } from "../lib/synth";
import { cueFor } from "../lib/cues";

export function useAudio(panel: ComputedRef<Panel | undefined>) {
  const enabled = ref(false),
    volume = ref(0.35),
    dialogue = ref(true),
    error = ref(""),
    cue = computed(() => cueFor(panel.value));
  const activeCuePanelId = ref<string | null>(null);
  const synth = new AmbientSynth();
  let generation = 0;

  async function startKind(kind: Panel["sound"]) {
    const own = ++generation;
    try {
      await synth.start(kind, volume.value);
      if (own !== generation && !enabled.value) synth.stop();
    } catch {
      enabled.value = false;
      error.value = "浏览器未能启动声音，请再次点击播放";
    }
  }
  async function play() {
    await startKind(panel.value?.sound ?? "rain");
  }
  function toggle() {
    enabled.value = !enabled.value;
    if (enabled.value) void play();
    else {
      generation++;
      synth.stop();
    }
  }
  /**
   * 预演声音 cue：同一段声景不重播，种类变化才切换；
   * 暂停后继续或拖动位置都不会重播已经结束的触发
   */
  function soundCue(kind: Panel["sound"], panelId: string) {
    if (!enabled.value || activeCuePanelId.value === panelId) return;
    activeCuePanelId.value = panelId;
    void startKind(kind);
  }
  function resetPreviewCues() {
    activeCuePanelId.value = null;
  }
  watch(
    () => panel.value?.id,
    (id, old) => {
      if (id !== old) resetPreviewCues();
      if (enabled.value) void play();
    },
  );
  watch(volume, (v) => synth.volume(v));
  onBeforeUnmount(() => synth.dispose());
  return {
    enabled,
    volume,
    dialogue,
    error,
    cue,
    toggle,
    soundCue,
    resetPreviewCues,
  };
}
