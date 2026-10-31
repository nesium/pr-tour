<script setup lang="ts">
import { inject, onMounted, ref } from "vue";
import { where } from "../lib/handoff";
import type { NoteKind, NoteLines, StepId } from "../lib/types";
import { TOUR } from "../lib/useTour";

/**
 * Writes a note on `step`, on `lines` when given. Inline under picked lines
 * it takes focus and can be cancelled; under the explanation it stays.
 */
const props = defineProps<{ step: StepId; lines?: NoteLines | null; inline?: boolean }>();
const emit = defineEmits<{ cancel: [] }>();
const tour = inject(TOUR)!;
const draft = ref("");
const kind = ref<NoteKind>("change");
const field = ref<HTMLTextAreaElement | null>(null);

async function add() {
  if (await tour.addNote(props.step, kind.value, draft.value, props.lines ?? null)) {
    draft.value = "";
    if (props.inline) emit("cancel");
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void add();
  } else if (event.key === "Escape") {
    if (props.inline) emit("cancel");
    else (event.target as HTMLElement).blur();
  }
}

onMounted(() => {
  if (props.inline) field.value?.focus();
});
</script>

<template>
  <div class="note-box" :class="{ 'note-box-inline': inline }">
    <div class="note-box-row">
      <div class="note-kinds">
        <button :class="{ on: kind === 'change' }" @click="kind = 'change'">Change</button>
        <button :class="{ on: kind === 'remark' }" @click="kind = 'remark'">Remark</button>
      </div>
      <span v-if="lines" class="note-where">on {{ where(lines) }}</span>
      <span v-else class="note-dim">On the whole step. For lines, click their numbers in the diff; ⇧-click for a range.</span>
    </div>
    <textarea
      ref="field"
      v-model="draft"
      rows="2"
      :placeholder="kind === 'change' ? 'What should change?  ⌘⏎ adds' : 'A remark, no change needed  ⌘⏎ adds'"
      @keydown="onKey"
    />
    <div class="note-box-row">
      <span v-if="tour.reviewError.value" class="note-error">{{ tour.reviewError.value }}</span>
      <span class="note-spacer" />
      <button v-if="inline" class="note-cancel" @click="emit('cancel')">Cancel</button>
      <button class="note-add" :disabled="!draft.trim()" @click="add">Add note</button>
    </div>
  </div>
</template>

<style scoped>
.note-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--sans);
  color: var(--fg);
}
.note-box.note-box-inline {
  padding: 10px 12px;
  border-top: 1px solid var(--gh-border);
  border-bottom: 1px solid var(--gh-border);
  background: var(--bg);
}
.note-box-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
textarea {
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 12.5px;
  white-space: pre-wrap;
  outline: none;
}
textarea:focus {
  border-color: var(--accent);
}
.note-kinds {
  display: flex;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.note-kinds button {
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.note-kinds button.on {
  background: var(--selected);
  color: var(--fg);
}
.note-where {
  font-family: var(--mono);
  color: var(--muted);
}
.note-add,
.note-cancel {
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
.note-cancel {
  background: var(--raised);
  color: var(--fg);
}
.note-add:disabled {
  opacity: 0.5;
  cursor: default;
}
.note-spacer {
  flex: 1;
}
.note-dim {
  color: var(--dim);
}
.note-error {
  color: var(--gh-del-sign);
}
</style>
