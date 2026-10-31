<script setup lang="ts">
import { computed, inject } from "vue";
import type { Row } from "../lib/diff";
import { globMatches } from "../lib/glob";
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

/** Each `skipped` entry with the changed files it matches. */
const skipped = computed(() => {
  const reviewed = tour.tour.value;
  if (!reviewed?.skipped?.length) return [];
  const changed = tour.stat.value ?? [];
  return reviewed.skipped.map((entry) => ({ ...entry, files: changed.filter((s) => globMatches(entry.file, s.file)).map((s) => s.file) }));
});
</script>

<template>
  <article class="page">
    <h1>Not in the tour</h1>
    <p class="prose muted">Changes no step or concern points at. The tour may group them as mechanical, or may have missed them.</p>
    <p v-if="files === null" class="muted">Reading the branch's changes…</p>
    <p v-else-if="!files.length" class="muted">Every change is in the tour{{ skipped.length ? " or skipped below" : "" }}.</p>
    <section v-for="entry in files ?? []" :key="entry.file" class="diff-box">
      <header class="file">
        <span class="name">{{ entry.file }}</span>
        <DiffSize v-if="entry.added !== null && entry.removed !== null" :added="entry.added" :removed="entry.removed" />
        <span v-else class="range">binary</span>
        <button class="open-file" title="Open the whole file's diff in a tab" @click="tour.openTab(entry.file)">Whole file ↗</button>
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
            :from="tour.tour.value!.base_sha"
            :to="tour.tour.value!.head_sha"
            :window="tour.hunkWindowFor(anchorKey(`uncovered-${entry.file}`, hunk), ready(entry.file)!.rows, hunk)!"
            :hit="noHit"
          />
        </template>
      </template>
    </section>
    <template v-if="skipped.length">
      <h2>Skipped on purpose</h2>
      <div v-for="entry in skipped" :key="entry.file" class="skipped prose">
        <div><code>{{ entry.file }}</code> <span class="muted">— {{ entry.why }}</span></div>
        <div class="matched">
          <button v-for="file in entry.files" :key="file" class="link" @click="tour.openTab(file)">{{ file }}</button>
          <span v-if="tour.stat.value && !entry.files.length" class="muted">matches no changed file</span>
        </div>
      </div>
    </template>
  </article>
</template>

<style scoped>
.skipped {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.skipped code {
  font-family: var(--mono);
  font-size: 12px;
}
.matched {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  padding-left: 12px;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
}
.muted {
  margin: 0;
  color: var(--muted);
}
</style>
