<script setup lang="ts">
import { computed } from "vue";
import type { Token } from "../lib/highlight";

const props = defineProps<{ text: string; tokens?: Token[] }>();
// Highlighting comes from the file, not the diff; if a line differs (e.g. CRLF), show it plain.
const shown = computed(() => (props.tokens && props.tokens.map((t) => t.text).join("") === props.text ? props.tokens : null));
</script>

<template>
  <template v-if="shown"><span v-for="(token, i) in shown" :key="i" class="token" :style="{ '--light': token.light, '--dark': token.dark ?? token.light }">{{ token.text }}</span></template>
  <template v-else>{{ text }}</template>
</template>

<style scoped>
.token {
  color: var(--light);
}
@media (prefers-color-scheme: dark) {
  .token {
    color: var(--dark);
  }
}
</style>
