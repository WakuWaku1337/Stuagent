/** 下载 Docling 公式增强模型到命名卷；CPU 推理很慢，仅按需启用。 */
import { execFileSync } from 'node:child_process';

execFileSync('docker', ['compose', '-f', 'docker/docker-compose.yml', '--profile', 'docling', 'up', '-d', 'docling-serve'], {
  stdio: 'inherit',
});

for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    execFileSync('docker', ['exec', 'edu-docling', 'curl', '-sf', 'http://localhost:5001/health'], { stdio: 'ignore' });
    break;
  } catch {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
}

const code = [
  'from huggingface_hub import snapshot_download',
  "print(snapshot_download('ibm-granite/granite-docling-258M', local_dir='/opt/app-root/src/.cache/docling/models/ibm-granite--granite-docling-258M'))",
].join('; ');

execFileSync('docker', ['exec', '-e', 'HF_ENDPOINT=https://hf-mirror.com', 'edu-docling', 'python', '-c', code], {
  stdio: 'inherit',
});
