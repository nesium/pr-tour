<script setup lang="ts">
import { inject } from "vue";
import { TOUR } from "../lib/useTour";
import type { RepoFile } from "../lib/types";

const tour = inject(TOUR)!;
const name = (file: RepoFile) => file.split("/").pop();

function onAuxClick(event: MouseEvent, file: RepoFile) {
  if (event.button === 1) tour.closeTab(file);
}
</script>

<template>
  <nav v-if="tour.tabs.value.length" class="tabs">
    <button class="tab" :class="{ active: tour.activeTab.value === null }" @click="tour.activeTab.value = null">Tour</button>
    <div
      v-for="file in tour.tabs.value"
      :key="file"
      class="tab file"
      :class="{ active: tour.activeTab.value === file }"
      :title="file"
      @click="tour.activeTab.value = file"
      @auxclick="onAuxClick($event, file)"
    >
      <span class="name">{{ name(file) }}</span>
      <button class="close" title="Close" @click.stop="tour.closeTab(file)">×</button>
    </div>
  </nav>
</template>

<style scoped>
.tabs {
  flex: none;
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  background: var(--raised);
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 7px 7px 0 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.tab.file {
  font-family: var(--mono);
  font-size: 11px;
}
.tab:hover {
  color: var(--fg);
}
.tab.active {
  margin-bottom: -1px;
  border-color: var(--border);
  background: var(--bg);
  color: var(--fg);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--dim);
  font-size: 13px;
  line-height: 16px;
  cursor: pointer;
}
.close:hover {
  background: var(--hover);
  color: var(--fg);
}
</style>
