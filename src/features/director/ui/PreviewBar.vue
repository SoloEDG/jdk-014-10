<script setup lang="ts">
import { computed } from "vue";
import { Play, Pause, RotateCcw, OctagonAlert, Film } from "lucide-vue-next";
import type { Director } from "../model/director";

const props = defineProps<{ director: Director }>();
const engine = computed(() => props.director.engine);
const tl = computed(() => engine.value.timeline.value);
const time = computed(() => engine.value.time.value);
const duration = computed(() => engine.value.duration.value);
const playing = computed(() => engine.value.playing.value);
const blocked = computed(() => engine.value.blocked.value);
const notice = computed(() => engine.value.boundaryNotice.value);
const progress = computed(() =>
  duration.value ? (time.value / duration.value) * 100 : 0,
);
function scrub(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  engine.value.seek((value / 100) * duration.value);
}
function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
</script>

<template>
  <section class="preview-bar">
    <div class="preview-transport">
      <button
        class="play-preview"
        :aria-label="playing ? '暂停预演' : '播放预演'"
        @click="engine.toggle()"
      >
        <Pause v-if="playing" :size="15" /><Play v-else :size="15" />
      </button>
      <button aria-label="回到开头" @click="engine.reset()">
        <RotateCcw :size="14" />
      </button>
      <div class="scrub-wrap">
        <input
          class="scrubber"
          type="range"
          min="0"
          max="100"
          step="0.1"
          :value="progress"
          :aria-valuetext="fmt(time)"
          @input="scrub"
        />
        <div class="cue-ticks">
          <i
            v-for="cue in tl?.cues ?? []"
            :key="cue.id"
            :class="cue.kind"
            :style="{ left: `${duration ? (cue.at / duration) * 100 : 0}%` }"
          ></i>
          <i
            v-if="blocked"
            class="boundary"
            :style="{ left: `${duration ? (tl!.boundaryTime / duration) * 100 : 100}%` }"
          ></i>
        </div>
      </div>
      <span class="timecode"
        ><Film :size="12" /> {{ fmt(time) }} / {{ fmt(duration) }}</span
      >
    </div>
    <p v-if="notice" class="boundary-notice" :class="{ blocked }">
      <OctagonAlert :size="12" /> {{ notice }}
    </p>
  </section>
</template>
