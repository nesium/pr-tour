<script setup lang="ts">
import { computed, inject } from "vue";
import { where } from "../lib/handoff";
import { shortCommit, type Note } from "../lib/types";
import { TOUR } from "../lib/useTour";

/** `inline` drops the place, which the diff around it already shows. */
const props = defineProps<{ note: Note; inline?: boolean }>();
const tour = inject(TOUR)!;
const older = computed(() => props.note.head_sha !== tour.tour.value?.head_sha);
/** Open notes follow their lines to the branch's tip; changed lines suggest resolving. */
const drift = computed(() => (props.note.status === "open" ? tour.delta.noteDrift(props.note) : { status: "current" as const }));
</script>

<template>
  <div class="note-card" :class="[`note-${note.kind}`, `note-${note.status}`]">
    <div class="note-meta">
      <span class="note-kind">{{ note.kind === "change" ? "Change" : "Remark" }}</span>
      <span v-if="note.lines && !inline" class="note-where">{{ where(note.lines) }}</span>
      <span v-if="older" class="note-dim" :title="`Written about ${note.head_sha}; its lines may have moved`">on {{ shortCommit(note.head_sha) }}</span>
      <span v-if="note.sent_at && note.status === 'open'" class="note-dim" :title="`Copied for the author at ${note.sent_at}`">sent</span>
      <span class="note-spacer" />
      <button class="note-act" @click="tour.resolveNote(note.id, note.status === 'open')">{{ note.status === "open" ? "Resolve" : "Reopen" }}</button>
      <button class="note-act" title="Delete" @click="tour.deleteNote(note.id)">×</button>
    </div>
    <div class="note-text">{{ note.text }}</div>
    <div v-if="drift.status === 'changed'" class="note-drift">
      A newer commit changed these lines. Addressed?
      <button class="note-act note-suggest" @click="tour.resolveNote(note.id, true)">Resolve</button>
    </div>
    <div v-else-if="drift.status === 'moved'" class="note-drift note-dim">Unchanged since; now at L{{ drift.start }}{{ drift.end === drift.start ? "" : `–${drift.end}` }}.</div>
  </div>
</template>

<style scoped>
.note-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  background: var(--raised);
  color: var(--fg);
  font-family: var(--sans);
}
.note-card.note-remark {
  border-left-color: var(--border);
}
.note-card.note-resolved {
  opacity: 0.55;
}
.note-card.note-resolved .note-text {
  text-decoration: line-through;
}
.note-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.note-kind {
  font-weight: 600;
}
.note-where {
  font-family: var(--mono);
  color: var(--muted);
}
.note-text {
  white-space: pre-wrap;
  font-size: 12.5px;
}
.note-drift {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--accent);
}
.note-suggest {
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 5px;
  color: var(--accent);
}
.note-act {
  padding: 0 6px;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.note-act:hover {
  color: var(--fg);
}
.note-spacer {
  flex: 1;
}
.note-dim {
  color: var(--dim);
}
</style>
