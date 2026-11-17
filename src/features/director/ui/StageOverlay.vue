<script setup lang="ts">
import { computed } from "vue";
import type { ComicPage, Rect } from "../../../shared/document";
import { pageSafeArea } from "../../../shared/migrate";
import type { Director } from "../model/director";

const props = defineProps<{
  page: ComicPage;
  director: Director;
  camera: Rect | null;
}>();
const safe = computed(() => pageSafeArea(props.page));
const engine = computed(() => props.director.engine);
const activeId = computed(() => engine.value.activePanelId.value);
const blockedId = computed(() => engine.value.blocked.value);
const tl = computed(() => engine.value.timeline.value);
const pct = (r: Rect) => ({
  left: `${(r.x / props.page.width) * 100}%`,
  top: `${(r.y / props.page.height) * 100}%`,
  width: `${(r.width / props.page.width) * 100}%`,
  height: `${(r.height / props.page.height) * 100}%`,
});
const activeIndex = computed(() =>
  props.page.panels.findIndex((p) => p.id === activeId.value),
);
const routePoints = computed<Rect[]>(() => {
  if (activeIndex.value < 0) return [];
  const key = `${activeIndex.value}->${activeIndex.value + 1}`;
  const route = tl.value?.routes[key];
  if (!route || route.id === "cut") return [];
  // 规划器输出的完整路径已通过安全区与未揭示区校验
  return route.points.map((r) => ({ ...r }));
});
const polyline = computed(() =>
  routePoints.value
    .map((r) => {
      const cx = ((r.x + r.width / 2) / props.page.width) * 100;
      const cy = ((r.y + r.height / 2) / props.page.height) * 100;
      return `${cx},${cy}`;
    })
    .join(" "),
);
</script>

<template>
  <div class="director-overlay">
    <div class="safe-outline" :style="pct(safe)">
      <span>安全可见区</span>
    </div>
    <div
      v-for="(panel, i) in page.panels"
      :key="panel.id"
      class="overlay-panel"
      :class="{
        active: panel.id === activeId,
        stale: panel.shot?.stale,
        blocked: panel.id === blockedId,
        unrevealed: i > activeIndex && activeIndex >= 0,
      }"
      :style="pct(panel.rect)"
    >
      <small>{{ String(i + 1).padStart(2, "0") }}</small>
    </div>
    <svg
      v-if="polyline"
      class="route-svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <polyline
        :points="polyline"
        vector-effect="non-scaling-stroke"
        class="route-line"
      />
    </svg>
    <div v-if="camera" class="camera-frame" :style="pct(camera)">
      <i class="corner tl"></i><i class="corner tr"></i
      ><i class="corner bl"></i><i class="corner br"></i>
    </div>
  </div>
</template>
