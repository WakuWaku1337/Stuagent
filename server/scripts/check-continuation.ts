import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_CONTINUATIONS,
  continuationPrompt,
  looksIncomplete,
  manualContinuationPrompt,
  mergeContinuation,
} from '../src/chat/integrity.ts';
import { CHAT_HISTORY_LIMIT, HISTORY_ITEM_MAX_CHARS, historyReplayLimit } from '../src/config.ts';

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

report(CHAT_HISTORY_LIMIT === 16, 'default history limit is 16');
report(HISTORY_ITEM_MAX_CHARS === 6000, 'default history item max chars is 6000');
report(historyReplayLimit() >= 4 && historyReplayLimit() <= 60, 'history limit stays within 4-60');
const handlerSource = readFileSync(resolve(import.meta.dirname, '../src/chat/handler.ts'), 'utf8');
const piSource = readFileSync(resolve(import.meta.dirname, '../src/pi.ts'), 'utf8');
report(
  handlerSource.includes('historyReplayLimit()') && piSource.includes('historyReplayLimit()'),
  'handler and pi share history replay limit',
);
report(
  handlerSource.includes('HISTORY_ITEM_MAX_CHARS') && piSource.includes('HISTORY_ITEM_MAX_CHARS'),
  'handler and pi share history item truncation',
);
report(!/slice\(-24\)/.test(piSource) && !/\b8000\b/.test(piSource), 'pi no longer hardcodes 24 / 8000');

console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
