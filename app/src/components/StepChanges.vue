<script setup lang="ts">
import { computed, inject } from "vue";
import { anchorKey, shortCommit, type Step } from "../lib/types";
import { TOUR } from "../lib/useTour";
import DiffBody from "./DiffBody.vue";

/** The new commits' hunks that changed this step's lines since it was last reviewed (or since the tour). */
const props = defineProps<{ step: Step }>();
const tour = inject(TOUR)!;

const delta = computed(() => tour.delta.steps.value.get(props.step.id));
const reviewed = computed(() => Boolean(tour.progress.value.done[props.step.id]));
const noHit = () => false;
const place = (file: string, from: string, hunk: number) => anchorKey(`since-${props.step.id}-${file}-${from}`, hunk);
</script>

<template>
  <section v-if="delta?.status === 'changed'" class="changes">
    <header class="head">
      <span class="badge">CHANGED</span>
      <span>
        {{ reviewed ? "Since you reviewed it at" : "Since the tour, at" }} {{ shortCommit(delta.since) }}, newer commits changed this step's lines.
        Marking it reviewed again covers them.
      </span>
    </header>
    <template v-for="change in delta.changes" :key="`${change.file}-${change.from}`">
      <section v-if="tour.delta.range(change.from, change.to, change.file)" class="diff-box">
        <header class="file">
          <span class="name">{{ change.file }}</span>
          <span class="range">{{ shortCommit(change.from) }}..{{ shortCommit(change.to) }}</span>
        </header>
        <template v-for="hunk in change.hunks" :key="hunk">
          <DiffBody
            v-if="tour.hunkWindowFor(place(change.file, change.from, hunk), tour.delta.range(change.from, change.to, change.file)!.rows, hunk)"
            :file="change.file"
            :diff="tour.delta.range(change.from, change.to, change.file)!"
            :from="change.from"
            :to="change.to"
            :window="tour.hunkWindowFor(place(change.file, change.from, hunk), tour.delta.range(change.from, change.to, change.file)!.rows, hunk)!"
            :hit="noHit"
            :step="step.id"
            :place="place(change.file, change.from, hunk)"
          />
        </template>
      </section>
    </template>
  </section>
  <p v-else-if="delta?.status === 'loading'" class="checking">Checking the new commits…</p>
</template>

<style scoped>
.changes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  color: var(--muted);
}
.badge {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
}
.checking {
  margin: 0;
  font-size: 11px;
  color: var(--dim);
}
</style>
