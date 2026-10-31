<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown";

const props = defineProps<{ text: string }>();
const html = computed(() => renderMarkdown(props.text));

// Links would replace the tour in this window; opening them in a browser comes later.
function keepTour(event: MouseEvent) {
  if ((event.target as HTMLElement).closest("a")) event.preventDefault();
}
</script>

<template>
  <div class="markdown" @click="keepTour" v-html="html" />
</template>

<style scoped>
.markdown :deep(p) {
  margin: 0 0 0.6em;
}
.markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown :deep(code) {
  font-family: var(--mono);
  font-size: 0.92em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--raised);
}
.markdown :deep(pre) {
  overflow-x: auto;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--raised);
}
.markdown :deep(pre code) {
  padding: 0;
  background: none;
}
.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 0.6em;
  padding-left: 1.4em;
}
.markdown :deep(a) {
  color: var(--accent);
}
</style>
