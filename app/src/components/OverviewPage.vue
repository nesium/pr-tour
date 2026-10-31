<script setup lang="ts">
import { computed } from "vue";
import type { Tour } from "../lib/types";
import MarkdownText from "./MarkdownText.vue";

const props = defineProps<{ tour: Tour }>();
const counts = computed(() => {
  const { steps, concerns } = props.tour;
  const closely = steps.filter((s) => s.tag === "read_closely").length;
  return `${closely} to read closely · ${steps.length - closely} to skim · ${concerns.length} concerns`;
});
</script>

<template>
  <article class="page">
    <h1>What this change does</h1>
    <MarkdownText :text="tour.intent" />
    <h2>Reading order</h2>
    <ol class="order prose">
      <li v-for="(entry, i) in tour.reading_order" :key="entry.file">
        <span class="number">{{ i + 1 }}.</span>
        <div>
          <div class="file">{{ entry.file }}</div>
          <div class="why">{{ entry.why }}</div>
        </div>
      </li>
    </ol>
    <p class="meta">
      {{ counts }}<template v-if="tour.author?.agent"> · by {{ tour.author.agent }}</template>
    </p>
  </article>
</template>

<style scoped>
.order {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.order li {
  display: flex;
  gap: 10px;
}
.number {
  flex: none;
  width: 18px;
  text-align: right;
  color: var(--dim);
}
.file {
  font-family: var(--mono);
  font-size: 12px;
}
.why {
  font-size: 12px;
  color: var(--muted);
}
.meta {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--dim);
}
</style>
