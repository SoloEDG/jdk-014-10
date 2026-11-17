<script setup lang="ts">
import { computed } from "vue";
import {
  Clapperboard,
  Gauge,
  Map,
  Route,
  ShieldAlert,
  Timer,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
} from "lucide-vue-next";
import type { ComicPage, Panel, PanelShot, Rect } from "../../../shared/document";
import { pageSafeArea } from "../../../shared/migrate";
import type { Director } from "../model/director";
import RoutePlanner from "./RoutePlanner.vue";

const props = defineProps<{
  page: ComicPage;
  director: Director;
}>();
const selected = computed(() => props.director.selectedPanel.value);
const shot = computed<PanelShot | undefined>(() => selected.value?.shot);
const safe = computed(() => pageSafeArea(props.page));
const plan = computed(() => props.director.plan.value);
const conflicts = computed(() => props.director.conflicts.value);
const selectedIndex = computed(() =>
  props.page.panels.findIndex((p) => p.id === selected.value?.id),
);

function num(event: Event) {
  return Number((event.target as HTMLInputElement).value);
}
function patch(p: Partial<PanelShot>) {
  if (selected.value) props.director.updateShot(selected.value.id, p);
}
function safePatch(p: Partial<Rect>) {
  props.director.setSafeArea({ ...safe.value, ...p });
}
const safeMax = computed(() => ({
  x: Math.max(0, props.page.width - safe.value.width),
  y: Math.max(0, props.page.height - safe.value.height),
}));
</script>

<template>
  <section class="director-panel">
    <div class="section-heading">
      <span><Clapperboard :size="15" /> 镜头导演台</span>
      <label class="overlay-switch">
        <input
          type="checkbox"
          :checked="director.showOverlay.value"
          @change="director.showOverlay.value = ($event.target as HTMLInputElement).checked"
        />
        <small>取景叠层</small>
      </label>
    </div>

    <div v-if="plan.staleCount" class="director-banner warn">
      <ShieldAlert :size="15" />
      <div>
        <strong>{{ plan.staleCount }} 个镜头待修订</strong>
        <p>布局变更后，预演会停在明确边界，失效段不计入阅读进度。</p>
      </div>
    </div>
    <div v-else class="director-banner ok">
      <CheckCircle2 :size="15" />
      <div><strong>镜头时序完整</strong><p>所有分镜均可连续预演。</p></div>
    </div>

    <div v-if="conflicts.length" class="conflict-list">
      <p v-for="c in conflicts" :key="c.index" class="conflict-row">
        <AlertTriangle :size="12" />
        <span>第 {{ c.index + 1 }} → {{ c.index + 2 }} 格：{{ c.text }}</span>
      </p>
    </div>

    <template v-if="selected && shot">
      <div class="shot-head">
        <span>镜头 {{ selectedIndex + 1 }}</span>
        <button class="mini" @click="director.reviseShot(selected.id)">
          <Wand2 :size="12" /> 修订单格
        </button>
      </div>

      <div class="field-group">
        <label class="field">
          <span><Timer :size="12" /> 起点停留 (s)</span>
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            :value="shot.holdIn"
            @input="patch({ holdIn: Math.max(0, num($event)) })"
          />
        </label>
        <label class="field">
          <span><Timer :size="12" /> 终点停留 (s)</span>
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            :value="shot.holdOut"
            @input="patch({ holdOut: Math.max(0, num($event)) })"
          />
        </label>
      </div>

      <div class="field">
        <span><Gauge :size="12" /> 移动速度 ×{{ shot.motionScale.toFixed(1) }}</span>
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          :value="shot.motionScale"
          @input="patch({ motionScale: num($event) })"
        />
      </div>

      <div class="field">
        <span>缓动节奏</span>
        <select
          :value="shot.easing"
          @change="patch({ easing: ($event.target as HTMLSelectElement).value as PanelShot['easing'] })"
        >
          <option value="easeInOut">缓入缓出</option>
          <option value="easeOut">缓出</option>
          <option value="linear">匀速</option>
          <option value="hold">定格</option>
        </select>
      </div>

      <div class="field">
        <span>与下一格衔接</span>
        <div class="seg-toggle">
          <button
            :class="{ on: shot.transition === 'pan' }"
            @click="director.setTransition(selected.id, 'pan')"
          >
            <Route :size="12" /> 连续移动
          </button>
          <button
            :class="{ on: shot.transition === 'cut' }"
            @click="director.setTransition(selected.id, 'cut')"
          >
            切镜
          </button>
        </div>
      </div>

      <div class="field-group">
        <label class="field">
          <span>对白揭示 {{ Math.round(shot.dialogueAt * 100) }}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="shot.dialogueAt"
            @input="patch({ dialogueAt: num($event) })"
          />
        </label>
        <label class="field">
          <span>声音触发 {{ Math.round(shot.soundAt * 100) }}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="shot.soundAt"
            @input="patch({ soundAt: num($event) })"
          />
        </label>
      </div>

      <div class="field">
        <span><ShieldAlert :size="12" /> 安全区内缩 {{ shot.safePadding }}px</span>
        <input
          type="range"
          min="0"
          max="60"
          step="2"
          :value="shot.safePadding"
          @input="patch({ safePadding: num($event) })"
        />
      </div>

      <RoutePlanner
        v-if="selectedIndex >= 0 && selectedIndex < page.panels.length - 1"
        :page="page"
        :panel-index="selectedIndex"
        :director="director"
      />

      <div class="panel-ops">
        <button class="mini" @click="director.addPanel()">
          <Plus :size="12" /> 在其后插入分镜
        </button>
        <button
          class="mini danger"
          :disabled="page.panels.length <= 1"
          @click="director.removePanel(selected.id)"
        >
          <Trash2 :size="12" /> 删除该格
        </button>
      </div>
    </template>

    <div class="safe-editor">
      <div class="safe-head">
        <span><Map :size="13" /> 安全可见区域</span>
        <button class="mini" @click="director.resetSafeArea()">整页</button>
      </div>
      <div class="field-group">
        <label class="field"><span>X</span>
          <input type="number" min="0" :max="safeMax.x" :value="Math.round(safe.x)"
            @input="safePatch({ x: Math.max(0, num($event)) })" /></label>
        <label class="field"><span>Y</span>
          <input type="number" min="0" :max="safeMax.y" :value="Math.round(safe.y)"
            @input="safePatch({ y: Math.max(0, num($event)) })" /></label>
      </div>
      <div class="field-group">
        <label class="field"><span>宽</span>
          <input type="number" min="40" :max="page.width" :value="Math.round(safe.width)"
            @input="safePatch({ width: Math.max(40, num($event)) })" /></label>
        <label class="field"><span>高</span>
          <input type="number" min="40" :max="page.height" :value="Math.round(safe.height)"
            @input="safePatch({ height: Math.max(40, num($event)) })" /></label>
      </div>
    </div>
  </section>
</template>
