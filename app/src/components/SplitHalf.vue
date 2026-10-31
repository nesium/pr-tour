<script setup lang="ts">
import type { Row } from "../lib/diff";
import type { Token } from "../lib/highlight";
import type { Side } from "../lib/types";
import CodeText from "./CodeText.vue";

/** One side of a split-view line; without a row, the other side changed alone. */
defineProps<{ row?: Row; side: Side; hit: boolean; tokens?: Token[]; picked?: boolean; noted?: boolean }>();
defineEmits<{ pick: [event: MouseEvent] }>();
</script>

<template>
  <div class="row half" :class="{ add: row?.kind === '+', del: row?.kind === '-', empty: !row, hit, picked, noted }">
    <span class="gutter single" @click="row && $emit('pick', $event)">{{ (side === "old" ? row?.old : row?.new) ?? "" }}</span>
    <span v-if="row" class="text"><span class="sign">{{ row.kind === " " ? " " : row.kind }}</span><CodeText :text="row.text" :tokens="tokens" /></span>
    <span v-else class="text" />
  </div>
</template>
