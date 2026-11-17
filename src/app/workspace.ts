import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { demoDocument, useLibrary } from "../features/library";
import { useChapters } from "../features/chapters";
import { useReader } from "../features/reader";
import { useAudio } from "../features/audio";
import { useProgress, readSession } from "../features/progress";
import { useDirector } from "../features/director";
import { migrateDocument } from "../shared/migrate";

export function useWorkspace() {
  const saved = readSession();
  if (saved) migrateDocument(saved.document);
  const doc = ref(saved?.document ?? migrateDocument(demoDocument())),
    reader = useReader(doc);
  if (saved) reader.dispatch({ type: "restore", location: saved.location });
  const progress = useProgress(doc, reader.location, saved),
    library = useLibrary(doc, (id) => {
      reader.dispatch({ type: "chapter", id });
      progress.reconcile();
    }),
    chapters = useChapters(doc, () => {
      reader.reconcile();
      progress.reconcile();
    }),
    panel = computed(() => reader.current.value.panel),
    audio = useAudio(panel);

  const currentPage = computed(() => reader.current.value.page);
  const director = useDirector(
    currentPage,
    reader.location,
    {
      onSoundCue: (p) => audio.soundCue(p.sound, p.id),
      onPanelEnter: (panelId) => {
        if (reader.location.value.panelId !== panelId)
          reader.dispatch({ type: "panel", id: panelId });
      },
    },
  );

  // 预演推进时同步阅读位置（进入新格才更新，避免写入风暴）
  watch(
    () => director.engine.activePanelId.value,
    (id) => {
      if (id && reader.mode.value === "director")
        reader.dispatch({ type: "panel", id });
    },
  );
  watch(
    () => reader.mode.value,
    (mode) => {
      if (mode !== "director") director.engine.pause();
      else director.engine.reset();
    },
  );

  function keydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.closest("input,textarea,button,select"))
      return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      reader.dispatch({ type: "move", delta: e.key === "ArrowRight" ? 1 : -1 });
    }
    if (e.key === " ") {
      e.preventDefault();
      if (reader.mode.value === "director") director.engine.toggle();
      else audio.toggle();
    }
    if (e.key === "Escape") reader.setMode("page");
  }
  onMounted(() => window.addEventListener("keydown", keydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", keydown));
  return { doc, reader, progress, library, chapters, audio, director };
}
