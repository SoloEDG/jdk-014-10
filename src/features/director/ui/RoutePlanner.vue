<script setup lang="ts">
import { computed } from "vue";
import { Route } from "lucide-vue-next";
import type { ComicPage } from "../../../shared/document";
import type { Director } from "../model/director";

const props = defineProps<{
  page: ComicPage;
  panelIndex: number;
  director: Director;
}>();
const plan = computed(() => props.director.planFor(props.panelIndex));
const key = computed(() => props.director.transitionKey(props.panelIndex));
const current = computed(() => props.director.chosenRoute(key.value));
</script>

<template>
  <div v-if="plan" class="route-planner">
    <p class="route-title"><Route :size="12" /> 替代路径预览（速度与揭示顺序冲突时）</p>
    <button
      v-for="candidate in plan.candidates"
      :key="candidate.id"
      class="route-option"
      :class="{
        selected: candidate.id === current?.id,
        blocked: !candidate.feasible,
      }"
      @click="director.chooseRoute(key, candidate.id)"
    >
      <span>{{ candidate.label }}</span>
      <small>
        {{
          candidate.id === "cut"
            ? "无移动"
            : `${Math.round(candidate.distance)}px · ${candidate.feasible ? "安全" : `${candidate.violations.length} 处风险`}`
        }}
      </small>
    </button>
  </div>
</template>
