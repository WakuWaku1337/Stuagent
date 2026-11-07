import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const targetDir = join(serverRoot, 'models', 'sherpa-onnx-paraformer-zh-small');
const mirror =
  process.env.ASR_MODEL_MIRROR ??
  'https://hf-mirror.com/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main';

const files: { name: string; minBytes: number }[] = [
  { name: 'model.int8.onnx', minBytes: 70_000_000 },
  { name: 'tokens.txt', minBytes: 50_000 },
  { name: 'am.mvn', minBytes: 1_000 },
];

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function main() {
  await mkdir(targetDir, { recursive: true });
  for (const file of files) {
    const target = join(targetDir, file.name);
    const existing = await sizeOf(target);
    if (existing >= file.minBytes) {
      console.log(`SKIP ${file.name} (${existing} bytes)`);
      continue;
    }
    const url = `${mirror}/${file.name}`;
    console.log(`GET  ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if (!res.ok || !res.body) throw new Error(`下载失败 ${file.name}: HTTP ${res.status}`);
    const temp = `${target}.tmp`;
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(temp));
    const size = await sizeOf(temp);
    if (size < file.minBytes) throw new Error(`${file.name} 大小异常：${size} bytes`);
    await rename(temp, target);
    console.log(`DONE ${file.name} (${size} bytes)`);
  }
  console.log(`ASR 模型已就绪：${targetDir}`);
}

main().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : error);
  process.exit(1);
});
