import {
  MAX_CONTINUATIONS,
  continuationPrompt,
  looksIncomplete,
  manualContinuationPrompt,
  mergeContinuation,
} from '../src/chat/integrity.ts';

let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

report(looksIncomplete('```js\nconst value = 1;') === true, 'detect open code fence');
report(looksIncomplete('最终答案是 5。') === false, 'accept finished sentence');
report(looksIncomplete('计算结果如下：') === true, 'detect dangling colon');
report(looksIncomplete('（1 + 2') === true, 'detect unclosed parenthesis');
report(looksIncomplete('已闭合（1 + 2）') === false, 'accept closed parenthesis');
report(looksIncomplete('') === false, 'empty is not truncated');

const shared = '这是已经生成的回答内容，需要在断点处继续。';
report(
  mergeContinuation(shared, `${shared.slice(-20)}后续内容`) === `${shared}后续内容`,
  'merge overlapping continuation',
);
report(
  mergeContinuation('第一段。', '第二段。') === '第一段。\n第二段。',
  'separate non-overlapping continuation',
);
report(mergeContinuation('已有内容', '') === '已有内容', 'empty continuation keeps text');

const prompt = continuationPrompt('末尾内容', 2);
report(
  prompt.includes('末尾内容') && prompt.includes('不要重复') && prompt.includes(`2/${MAX_CONTINUATIONS}`),
  'automatic continuation prompt',
);
const manual = manualContinuationPrompt('手动续写末尾');
report(manual.includes('手动续写末尾') && manual.includes('不要重复'), 'manual continuation prompt');

console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
