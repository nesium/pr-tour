<script setup lang="ts">
import { computed } from "vue";
import { sizeBlocks } from "../lib/coverage";

const props = defineProps<{ added: number; removed: number; files?: number }>();
const blocks = computed(() => sizeBlocks(props.added, props.removed));
const format = (n: number) => n.toLocaleString("en-US");
</script>

<template>
  <span class="size" :title="`${format(added)} lines added, ${format(removed)} removed`">
    <span v-if="files !== undefined" class="files">{{ format(files) }} file{{ files === 1 ? "" : "s" }}</span>
    <span class="added">+{{ format(added) }}</span>
    <span class="removed">−{{ format(removed) }}</span>
    <span class="blocks"><span v-for="(block, i) in blocks" :key="i" :class="block" /></span>
  </span>
</template>

<style scoped>
.size {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.files {
  color: var(--muted);
}
.added {
  color: var(--gh-add-sign);
  font-weight: 600;
}
.removed {
  color: var(--gh-del-sign);
  font-weight: 600;
}
.blocks {
  display: inline-flex;
  gap: 1px;
}
.blocks span {
  width: 8px;
  height: 8px;
  border-radius: 1px;
}
.blocks .add {
  background: var(--gh-add-sign);
}
.blocks .del {
  background: var(--gh-del-sign);
}
.blocks .neutral {
  background: var(--border);
}
</style>
