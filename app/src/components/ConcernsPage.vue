<script setup lang="ts">
import { anchorKey, type Concern } from "../lib/types";
import AnchorDiff from "./AnchorDiff.vue";
import MarkdownText from "./MarkdownText.vue";

defineProps<{ concerns: Concern[] }>();
</script>

<template>
  <article class="page">
    <h1>Open concerns</h1>
    <p v-if="!concerns.length" class="none">None.</p>
    <div v-for="(concern, i) in concerns" :key="i" class="concern">
      <div class="text">
        <span class="mark">!</span>
        <MarkdownText :text="concern.text" />
      </div>
      <AnchorDiff v-if="concern.anchor" :anchor="concern.anchor" :anchor-key="anchorKey(`concern-${i}`, 0)" />
    </div>
  </article>
</template>

<style scoped>
.none {
  color: var(--dim);
}
.concern {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.text {
  display: flex;
  gap: 8px;
}
.mark {
  flex: none;
  color: var(--blocked);
}
</style>
