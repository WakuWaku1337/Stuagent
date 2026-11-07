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
.markdown {
  font-size: 14px;
  line-height: 1.78;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}

.markdown :deep(> :first-child) {
  margin-top: 0;
}

.markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown :deep(p) {
  margin: 0.55em 0;
}

.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4) {
  font-family: var(--font-serif);
  color: var(--ink);
  line-height: 1.4;
  margin: 1.1em 0 0.45em;
}

.markdown :deep(h1) {
  font-size: 20px;
}

.markdown :deep(h2) {
  font-size: 17px;
}

.markdown :deep(h3) {
  font-size: 15px;
}

.markdown :deep(pre) {
  background: #f5f7f6;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.65;
}

.markdown :deep(code) {
  font-family: Consolas, 'Cascadia Code', monospace;
  font-size: 0.9em;
  background: #f2f5f3;
  border-radius: 4px;
  padding: 1px 4px;
}

.markdown :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown :deep(ol),
.markdown :deep(ul) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.markdown :deep(li) {
  margin: 0.18em 0;
}

.markdown :deep(blockquote) {
  margin: 0.8em 0;
  padding: 4px 14px;
  border-left: 2px solid var(--line-strong);
  color: var(--muted);
}

.markdown :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 13px;
}

.markdown :deep(th),
.markdown :deep(td) {
  border: 1px solid var(--line);
  padding: 6px 9px;
  text-align: left;
}

.markdown :deep(th) {
  background: #f6f8f7;
  color: var(--ink-soft);
  font-weight: 600;
}

.markdown :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 1.2em 0;
}
</style>
