<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import type { StepId } from "../lib/types";
import { TOUR } from "../lib/useTour";
import MarkdownText from "./MarkdownText.vue";

const tour = inject(TOUR)!;
const draft = ref("");
const thread = ref<HTMLElement | null>(null);

const step = computed(() => (tour.current.value && "step" in tour.current.value ? tour.current.value.step : null));
const entries = computed(() => (step.value ? tour.currentAnswers.value.filter((e) => e.step === step.value!.id) : []));
/** Off a step, every question so far, to jump back to its step. */
const elsewhere = computed(() => (step.value ? [] : tour.currentAnswers.value));
const titleOf = (id: StepId) => tour.tour.value?.steps.find((s) => s.id === id)?.title ?? id;

async function send() {
  if (!step.value) return;
  if (await tour.askQuestion(step.value.id, draft.value)) draft.value = "";
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void send();
  } else if (event.key === "Escape") {
    (event.target as HTMLElement).blur();
  }
}

// Newest at the bottom, as in any chat; follow it as answers arrive.
watch(
  () => [step.value?.id, entries.value.length, entries.value.at(-1)?.status],
  async () => {
    await nextTick();
    thread.value?.scrollTo({ top: thread.value.scrollHeight });
  },
  { immediate: true },
);
</script>

<template>
  <aside class="chat">
    <header class="head">
      <span class="strong">Ask</span>
      <span v-if="step" class="about">about “{{ step.title }}”</span>
      <span class="spacer" />
      <button class="collapse" title="Hide the chat (a)" @click="tour.toggleChat()">⇥</button>
    </header>
    <div ref="thread" class="thread">
      <template v-if="step">
        <p v-if="!entries.length" class="hint">
          Ask the agent about this step. It sees the step and the diff it points at, and remembers earlier questions about this
          tour. It can read the code, but not change it.
        </p>
        <div v-for="entry in entries" :key="entry.id" class="exchange">
          <div class="question">{{ entry.question }}</div>
          <div v-if="entry.status === 'pending'" class="answer pending"><span class="dots"><i /><i /><i /></span> Answering…</div>
          <div v-else-if="entry.status === 'error'" class="answer error">{{ entry.answer }}</div>
          <MarkdownText v-else class="answer" :text="entry.answer ?? ''" />
        </div>
      </template>
      <template v-else>
        <p class="hint">Open a step to ask about it.</p>
        <button v-for="entry in elsewhere" :key="entry.id" class="earlier" @click="tour.go(entry.step)">
          <span class="small dim">{{ titleOf(entry.step) }}</span>
          <span>{{ entry.question }}</span>
        </button>
      </template>
    </div>
    <footer v-if="step" class="compose">
      <textarea
        v-model="draft"
        rows="3"
        placeholder="Ask about this step…  ⏎ sends, ⇧⏎ new line"
        :disabled="tour.asking.value"
        @keydown="onKey"
      />
      <div class="row">
        <span v-if="tour.askError.value" class="small error">{{ tour.askError.value }}</span>
        <span v-else-if="tour.asking.value" class="small dim">One question at a time; the agent is answering.</span>
        <span class="spacer" />
        <button class="send" :disabled="tour.asking.value || !draft.trim()" @click="send">Ask</button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.chat {
  flex: none;
  width: 360px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--border);
}
.head {
  flex: none;
  height: 36px;
  padding: 0 10px 0 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--border);
}
.about {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
}
.collapse {
  flex: none;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.collapse:hover {
  background: var(--hover);
  color: var(--fg);
}
.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.exchange {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.question {
  align-self: flex-end;
  max-width: 90%;
  padding: 8px 10px;
  border-radius: 10px 10px 2px 10px;
  background: var(--selected);
  white-space: pre-wrap;
  font-size: 12.5px;
}
.answer {
  font-size: 12.5px;
}
.answer.pending {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
}
.answer.error,
.error {
  color: var(--gh-del-sign);
}
.dots {
  display: inline-flex;
  gap: 3px;
}
.dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--muted);
  animation: pulse 1s infinite ease-in-out;
}
.dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}
.earlier {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: none;
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.earlier:hover {
  background: var(--hover);
}
.compose {
  flex: none;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--border);
}
.compose textarea {
  resize: none;
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
.compose textarea:disabled {
  opacity: 0.6;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.send {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 7px;
  background: var(--solid);
  color: var(--solid-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.send:disabled {
  opacity: 0.5;
  cursor: default;
}
.spacer {
  flex: 1;
}
.strong {
  font-weight: 600;
}
.small {
  font-size: 11px;
}
.dim {
  color: var(--dim);
}
</style>
