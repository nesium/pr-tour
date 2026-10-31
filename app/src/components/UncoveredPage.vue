<script setup lang="ts">
import { computed, inject } from "vue";
import type { Row } from "../lib/diff";
import { anchorKey, type RepoFile } from "../lib/types";
import { TOUR } from "../lib/useTour";
import DiffBody from "./DiffBody.vue";
import DiffSize from "./DiffSize.vue";

const tour = inject(TOUR)!;
const files = computed(() => tour.uncovered.value);
const ready = (file: RepoFile) => {
  const state = tour.diffs.get(file);
  return state?.status === "ready" ? state.diff : null;
};
const failed = (file: RepoFile) => {
  const state = tour.diffs.get(file);
  return state?.status === "error" ? state.message : null;
};
const noHit = (_row: Row) => false;
</script>

<template>
  <article class="page">
    <h1>Not in the tour</h1>
    <p class="prose muted">Changes no step or concern points at. The tour may group them as mechanical, or may have missed them.</p>
    <p v-if="files === null" class="muted">Reading the branch's changes…</p>
    <p v-else-if="!files.length" class="muted">Every change is in the tour.</p>
    <section v-for="entry in files ?? []" :key="entry.file" class="diff-box">
      <header class="file">
        <span class="name">{{ entry.file }}</span>
        <DiffSize v-if="entry.added !== null && entry.removed !== null" :added="entry.added" :removed="entry.removed" />
        <span v-else class="range">binary</span>
        <button class="open" title="Open the whole file's diff in a tab" @click="tour.openTab(entry.file)">Whole file ↗</button>
      </header>
      <div v-if="failed(entry.file)" class="note error">{{ failed(entry.file) }}</div>
      <div v-else-if="entry.added === null" class="note">A binary file: no lines to show.</div>
      <div v-else-if="!ready(entry.file) || entry.hunks === null" class="note">Loading diff…</div>
      <template v-else>
        <template v-for="hunk in entry.hunks" :key="hunk">
          <DiffBody
            v-if="tour.hunkWindowFor(anchorKey(`uncovered-${entry.file}`, hunk), ready(entry.file)!.rows, hunk)"
            :file="entry.file"
            :diff="ready(entry.file)!"
            :window="tour.hunkWindowFor(anchorKey(`uncovered-${entry.file}`, hunk), ready(entry.file)!.rows, hunk)!"
            :hit="noHit"
          />
        </template>
      </template>
    </section>
  </article>
</template>

<style scoped>
.muted {
  margin: 0;
  color: var(--muted);
}
</style>
