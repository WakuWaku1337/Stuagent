/** Docling 转换自检：逐页 Markdown、confidence 与耗时 */
import { basename } from 'node:path';
import { convertWithDocling, doclingAvailable } from '../src/documents/docling.ts';

const file = process.argv[2] ?? 'testdata/scanned-sample.pdf';

async function main() {
  if (!(await doclingAvailable())) throw new Error('docling-serve 未启动，先运行 npm run docling:up');
  const started = Date.now();
  const result = await convertWithDocling(file, basename(file), { force: true });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`pages ${result.pageCount} · ${elapsed}s · markdown ${result.markdown.length} chars`);
  for (const page of result.pages) {
    const preview = page.markdown.replace(/\s+/g, ' ').slice(0, 80);
    console.log(
      `p${page.page} chars=${String(page.markdown.length).padStart(5)} confidence=${page.confidence ?? '-'} formulas=${page.formulas} ${preview}`,
    );
  }
  const low = result.pages.filter((page) => (page.confidence ?? 0) < 0.8);
  console.log(`low-confidence pages: ${low.map((page) => page.page).join(', ') || '无'}`);
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
