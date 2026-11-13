import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { db } = await import('../src/store.ts');
const { functionGraphDocumentFromModeled, conicDocumentFromModeled } = await import('../src/learning/viz/function-scene.ts');
const { documentFromLegacySpec } = await import('../src/learning/viz/document.ts');

const apply = process.argv.includes('--apply');
const strictInput = process.argv.includes('--strict-input');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const batchArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 0) : 0;
const batchSize = batchArg ? Math.max(1, Math.min(500, Number(batchArg.split('=')[1]) || 50)) : 50;

const rows = db.prepare(
  `SELECT visualization_id, type, title, spec, source, input_text
   FROM visualizations
   WHERE schema_version IS NULL OR schema_version < 2
   ORDER BY created_at DESC${limit ? ' LIMIT ?' : ''}`,
).all(...(limit ? [limit] : [])) as unknown as {
  visualization_id: string;
  type: string;
  title: string;
  spec: string;
  source: string | null;
  input_text: string | null;
}[];

let migrated = 0;
let skipped = 0;
let recovered = 0;
let batchCount = 0;

const update = db.prepare('UPDATE visualizations SET spec = ?, schema_version = 2, input_text = ? WHERE visualization_id = ?');

for (let offset = 0; offset < rows.length; offset += batchSize) {
  const batch = rows.slice(offset, offset + batchSize);
  batchCount += 1;
  const writes: { id: string; spec: string; inputText: string }[] = [];
  for (const row of batch) {
    if (strictInput && !row.input_text?.trim()) {
      skipped += 1;
      console.error(`SKIPPED ${row.visualization_id} ${row.type} ${row.title}: 缺少 input_text（--strict-input）`);
      continue;
    }
    try {
      const spec = JSON.parse(row.spec) as Record<string, unknown>;
      const inputText = row.input_text?.trim() || row.title;
      const inputRecovered = !row.input_text?.trim();
      const legacy = { type: row.type, title: row.title, spec, basis: '' } as Parameters<typeof functionGraphDocumentFromModeled>[0];
      const document = row.type === 'function2d'
        ? functionGraphDocumentFromModeled(legacy, inputText, undefined, row.source === 'preset' ? 'preset' : 'manual', inputRecovered)
        : row.type === 'conic'
          ? conicDocumentFromModeled(legacy, inputText, undefined, row.source === 'preset' ? 'preset' : 'manual', inputRecovered)
          : documentFromLegacySpec({
              type: row.type as Parameters<typeof documentFromLegacySpec>[0]['type'],
              title: row.title,
              spec,
              inputText,
              generator: row.source === 'preset' ? 'preset' : 'manual',
              inputRecovered,
            });
      if (inputRecovered) {
        recovered += 1;
        document.diagnostics.push({
          code: 'VIZ_INPUT_RECOVERED',
          severity: 'info',
          message: '历史记录没有保存原题文本，已用标题回填 input.text；原题无法逐字还原。',
          path: 'input.text',
        });
      }
      writes.push({ id: row.visualization_id, spec: JSON.stringify(document), inputText });
      migrated += 1;
      console.log(`${apply ? 'MIGRATED' : 'WOULD MIGRATE'} ${row.visualization_id} ${row.type} ${row.title}${inputRecovered ? ' [title-as-input]' : ''}`);
    } catch (error) {
      skipped += 1;
      console.error(`SKIPPED ${row.visualization_id} ${row.type} ${row.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (apply && writes.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const write of writes) update.run(write.spec, write.inputText, write.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

console.log(`\n${apply ? 'migrated' : 'dry-run'}: ${migrated}, skipped: ${skipped}, recovered-input: ${recovered}, batches: ${batchCount}, total: ${rows.length}`);
if (!apply) console.log('加上 --apply 才会写库；--limit=N 可限制条数，--batch-size=N 控制事务批次。');
if (recovered) console.log('注意：少量记录没有 input_text，迁移后用标题回填并写入 VIZ_INPUT_RECOVERED 诊断。');
db.close();
