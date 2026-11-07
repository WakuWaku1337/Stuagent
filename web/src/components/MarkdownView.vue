<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import renderMathInElement from 'katex/contrib/auto-render';

const props = defineProps<{ text: string }>();
const el = ref<HTMLElement>();

const html = computed(() =>
  DOMPurify.sanitize(marked.parse(props.text, { async: false }) as string),
);

watch(
  () => props.text,
  () =>
    nextTick(() => {
      if (!el.value) return;
      renderMathInElement(el.value, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    }),
  { immediate: true },
);
</script>

<template>
  <div ref="el" class="markdown" v-html="html"></div>
</template>

<style scoped>
.markdown :deep(p) {
  margin: 0.4em 0;
}
.markdown :deep(pre) {
  background: #f3f4f6;
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
}
.markdown :deep(code) {
  font-family: Consolas, monospace;
  font-size: 0.9em;
}
.markdown :deep(ol),
.markdown :deep(ul) {
  padding-left: 1.4em;
  margin: 0.4em 0;
}
</style>