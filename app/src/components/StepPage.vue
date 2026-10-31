<script setup lang="ts">
import { computed, inject } from "vue";
import { anchorKey, type Step } from "../lib/types";
import { TOUR } from "../lib/useTour";
import AnchorDiff from "./AnchorDiff.vue";
import MarkdownText from "./MarkdownText.vue";
import StepNotes from "./StepNotes.vue";

const props = defineProps<{ step: Step }>();
const tour = inject(TOUR)!;
const done = computed(() => Boolean(tour.progress.value.done[props.step.id]));
</script>

<template>
  <article class="page">
    <div class="pills">
      <span v-if="step.tag === 'read_closely'" class="pill closely">READ CLOSELY</span>
      <span v-else class="pill skim">SKIM</span>
      <span v-if="step.hotspot" class="pill hotspot">★ HOTSPOT</span>
      <span v-if="done" class="pill reviewed">✓ REVIEWED</span>
    </div>
    <h1>{{ step.title }}</h1>
    <MarkdownText :text="step.why" />
    <div v-if="step.check" class="check prose">
      <div class="check-label">CHECK</div>
      <MarkdownText :text="step.check" />
    </div>
    <StepNotes :step="step" />
    <AnchorDiff
      v-for="(anchor, i) in step.anchors"
      :key="anchorKey(step.id, i)"
      :anchor="anchor"
      :anchor-key="anchorKey(step.id, i)"
      :step="step.id"
    />
  </article>
</template>

<style scoped>
.pills {
  display: flex;
  gap: 8px;
}
.check {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--blocked) 40%, transparent);
  background: color-mix(in srgb, var(--blocked) 8%, transparent);
}
.check-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--blocked);
}
</style>
