<script setup lang="ts">
import { computed, inject } from "vue";
import type { Step } from "../lib/types";
import { TOUR } from "../lib/useTour";
import NoteCard from "./NoteCard.vue";
import NoteComposer from "./NoteComposer.vue";

/** Every note on the step, open first, and a box for notes on the whole step. Line notes also show in the diff. */
const props = defineProps<{ step: Step }>();
const tour = inject(TOUR)!;

const notes = computed(() => {
  const all = tour.notesOf(props.step.id);
  return [...all.filter((n) => n.status === "open"), ...all.filter((n) => n.status === "resolved")];
});
</script>

<template>
  <section class="notes prose">
    <div class="label">NOTES</div>
    <NoteCard v-for="note in notes" :key="note.id" :note="note" />
    <NoteComposer :step="step.id" />
  </section>
</template>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.label {
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
}
</style>
