<script setup lang="ts">
import { computed, inject, reactive } from "vue";
import { wholeFileWindow, type DiffWindow } from "../lib/diff";
import { shortCommit, type RepoFile, type StepId } from "../lib/types";
import { TOUR } from "../lib/useTour";
import DiffBody from "./DiffBody.vue";
import DiffSize from "./DiffSize.vue";

/** What the branch did after the tour's commit: its commits, the steps they changed, and their diffs. */
const tour = inject(TOUR)!;
const loaded = computed(() => tour.tour.value!);
const since = computed(() => tour.delta.since.value);
const changed = computed(() => tour.delta.changedSteps.value.map((id) => loaded.value.steps.find((s) => s.id === id)!).filter(Boolean));
const titleOf = (id: StepId) => loaded.value.steps.find((s) => s.id === id)?.title ?? id;
const touching = (file: RepoFile) => loaded.value.steps.filter((s) => tour.delta.changedSteps.value.includes(s.id) && s.anchors.some((a) => a.file === file)).map((s) => s.id);

const windows = new Map<string, DiffWindow>();
function windowOf(file: RepoFile) {
  const diff = tour.delta.range(loaded.value.head_sha, tour.tip.value!, file);
  if (!diff) return null;
  const key = `${tour.tip.value}:${file}`;
  if (!windows.has(key)) windows.set(key, reactive(wholeFileWindow(diff.rows)));
  return windows.get(key)!;
}
const noHit = () => false;
</script>

<template>
  <article class="page">
    <h1>Since the tour</h1>
    <p class="prose muted">
      The tour is for {{ shortCommit(loaded.head_sha) }}; the branch is now at {{ shortCommit(tour.tip.value) }}. Steps whose lines these
      commits changed come back for review, with the new hunks under their explanation.
    </p>
    <template v-if="since">
      <h2>{{ since.commits.length }} commit{{ since.commits.length === 1 ? "" : "s" }}</h2>
      <ol class="commits prose">
        <li v-for="commit in since.commits" :key="commit.sha"><code>{{ shortCommit(commit.sha) }}</code> {{ commit.subject }}</li>
      </ol>
      <h2>Steps they changed</h2>
      <p v-if="!changed.length" class="muted">None: the new commits don't touch any step's lines.</p>
      <ul v-else class="steps prose">
        <li v-for="step in changed" :key="step.id">
          <button class="link" @click="tour.go(step.id)">{{ step.title }}</button>
          <span v-if="tour.progress.value.done[step.id]" class="muted"> · reviewed before</span>
        </li>
      </ul>
      <h2>Changes</h2>
      <section v-for="file in since.files" :key="file.file" class="diff-box">
        <header class="file">
          <span class="name">{{ file.file }}</span>
          <DiffSize v-if="file.added !== null && file.removed !== null" :added="file.added" :removed="file.removed" />
          <span v-for="id in touching(file.file)" :key="id" class="range">↻ {{ titleOf(id) }}</span>
        </header>
        <div v-if="file.added === null" class="note">A binary file: no lines to show.</div>
        <DiffBody
          v-else-if="windowOf(file.file)"
          :file="file.file"
          :diff="tour.delta.range(loaded.head_sha, tour.tip.value!, file.file)!"
          :from="loaded.head_sha"
          :to="tour.tip.value!"
          :window="windowOf(file.file)!"
          :hit="noHit"
          whole
        />
        <div v-else class="note">Loading diff…</div>
      </section>
    </template>
    <p v-else class="muted">Reading the new commits…</p>
  </article>
</template>

<style scoped>
.muted {
  margin: 0;
  color: var(--muted);
}
.commits,
.steps {
  margin: 0;
  padding-left: 1.4em;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.commits code {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
</style>
