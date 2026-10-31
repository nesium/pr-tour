<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { where } from "../lib/handoff";
import { shortCommit, type NoteKind, type Step } from "../lib/types";
import { TOUR } from "../lib/useTour";

const props = defineProps<{ step: Step }>();
const tour = inject(TOUR)!;
const draft = ref("");
const kind = ref<NoteKind>("change");

// Open notes first, then resolved ones, each oldest first.
const notes = computed(() => {
  const all = tour.notesOf(props.step.id);
  return [...all.filter((n) => n.status === "open"), ...all.filter((n) => n.status === "resolved")];
});
const head = computed(() => tour.tour.value?.head_sha);

async function add() {
  if (await tour.addNote(props.step.id, kind.value, draft.value)) draft.value = "";
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void add();
  } else if (event.key === "Escape") {
    (event.target as HTMLElement).blur();
  }
}
</script>

<template>
  <section class="notes prose">
    <div class="label">NOTES</div>
    <div v-for="note in notes" :key="note.id" class="note" :class="[note.kind, note.status]">
      <div class="meta">
        <span class="kind">{{ note.kind === "change" ? "Change" : "Remark" }}</span>
        <span v-if="note.lines" class="where">{{ where(note.lines) }}</span>
        <span v-if="note.head_sha !== head" class="dim" :title="`Written about ${note.head_sha}; its lines may have moved`">
          on {{ shortCommit(note.head_sha) }}
        </span>
        <span v-if="note.sent_at && note.status === 'open'" class="dim" :title="`Copied for the author at ${note.sent_at}`">sent</span>
        <span class="spacer" />
        <button class="act" @click="tour.resolveNote(note.id, note.status === 'open')">
          {{ note.status === "open" ? "Resolve" : "Reopen" }}
        </button>
        <button class="act" title="Delete" @click="tour.deleteNote(note.id)">×</button>
      </div>
      <div class="text">{{ note.text }}</div>
    </div>
    <div class="compose">
      <div class="row">
        <div class="kinds">
          <button :class="{ on: kind === 'change' }" @click="kind = 'change'">Change</button>
          <button :class="{ on: kind === 'remark' }" @click="kind = 'remark'">Remark</button>
        </div>
        <span v-if="tour.noteTarget.value" class="target">
          on {{ where(tour.noteTarget.value) }}
          <button class="act" title="Note on the step instead" @click="tour.noteTarget.value = null">×</button>
        </span>
        <span v-else class="dim small">On the step; click line numbers to note lines, ⇧-click for a range</span>
      </div>
      <textarea
        v-model="draft"
        rows="2"
        :placeholder="kind === 'change' ? 'What should change?  ⌘⏎ adds' : 'A remark, no change needed  ⌘⏎ adds'"
        @keydown="onKey"
      />
      <div class="row">
        <span v-if="tour.reviewError.value" class="error small">{{ tour.reviewError.value }}</span>
        <span class="spacer" />
        <button class="add" :disabled="!draft.trim()" @click="add">Add note</button>
      </div>
    </div>
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
.note {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  background: var(--raised);
}
.note.remark {
  border-left-color: var(--border);
}
.note.resolved {
  opacity: 0.55;
}
.note.resolved .text {
  text-decoration: line-through;
}
.meta,
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.kind {
  font-weight: 600;
}
.where,
.target {
  font-family: var(--mono);
  color: var(--muted);
}
.text {
  white-space: pre-wrap;
  font-size: 12.5px;
}
.compose {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.compose textarea {
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.compose textarea:focus {
  border-color: var(--accent);
}
.kinds {
  display: flex;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.kinds button,
.act {
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.kinds button.on {
  background: var(--selected);
  color: var(--fg);
}
.act:hover {
  color: var(--fg);
}
.add {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: var(--solid);
  color: var(--solid-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.add:disabled {
  opacity: 0.5;
  cursor: default;
}
.spacer {
  flex: 1;
}
.dim {
  color: var(--dim);
}
.small {
  font-size: 11px;
}
.error {
  color: var(--gh-del-sign);
}
</style>
