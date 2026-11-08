import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkills } from '@earendil-works/pi-coding-agent';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-s31-'));
process.env.EDU_DATA_DIR = dataDir;
process.env.COURSEWARE_FORCE_TEMPLATE = '1';

const { db } = await import('../src/store.ts');
const { writeMemory, deleteMemory } = await import('../src/learning/memory.ts');
const { generateVisualization } = await import('../src/learning/visualize-engine.ts');
const { matchPreset } = await import('../src/learning/visualize-presets.ts');
const {
  validateVisualizationSpec,
  listUnifiedVisualizations,
  getUnifiedVisualization,
  deleteUnifiedVisualization,
} = await import('../src/learning/visualize.ts');

const workspace = resolve(fileURLToPath(new URL('.', import.meta.url)), '../agent-workspace/roles');
let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

try {
  for (const [role, expected] of [
    ['tutor', ['socratic', 'mind', 'edulab']],
    ['quizzer', ['quiz-gen', 'mind']],
    ['analyst', ['mind']],
    ['solver', ['mind', 'edulab']],
  ] as const) {
    const result = loadSkills({
      cwd: join(workspace, role),
      agentDir: join(dataDir, 'agent'),
      skillPaths: [],
      includeDefaults: true,
    });
    const names = result.skills.map((skill) => skill.name).sort();
    report(
      expected.every((name) => names.includes(name)),
      `skills for ${role}`,
      names.join(', '),
    );
  }

  report(matchPreset('正方体的截面怎么画', '数学')?.id === 'cube-section', 'preset matcher hits cube-section');
  report(matchPreset('今天天气不错') === undefined, 'preset matcher misses unrelated question');

  const generated = await generateVisualization({ question: '正方体截面', subject: '数学' });
  report(
    generated?.matched === 'preset' && generated.visualization.type === 'geometry3d',
    'unified generate returns preset object',
    generated?.matched,
  );
  const aux = (generated?.visualization.spec.auxiliary ?? []) as unknown[];
  report(aux.length === 2, 'preset carries auxiliary elements', `${aux.length}`);

  const id = generated!.visualization.visualization_id;
  report(
    listUnifiedVisualizations().some((item) => item.visualization_id === id && item.kind === 'preset'),
    'unified list marks preset kind',
  );
  report(getUnifiedVisualization(id)?.kind === 'preset', 'unified get returns preset kind');

  let rejected = false;
  try {
    validateVisualizationSpec('geometry3d', {
      points: [{ id: 'A', coord: [0, 0, 0] }, { id: 'B', coord: [1, 0, 0] }],
      auxiliary: [{ kind: 'bogus', points: ['A'] }],
    });
  } catch {
    rejected = true;
  }
  report(rejected, 'spec validation rejects unknown auxiliary kind');

  report(deleteUnifiedVisualization(id), 'unified delete removes preset instance');
  report(getUnifiedVisualization(id) === undefined, 'deleted visualization gone');

  const memory = writeMemory('S31 存储镜像测试：函数定义域优先。', 'test');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const memoryPath = join(dataDir, 'memory', `${memory.memory_id}.md`);
  const memoryText = await readFile(memoryPath, 'utf8');
  report(
    memoryText.includes('记忆') && memoryText.includes('函数定义域优先'),
    'memory Markdown mirror',
  );
  deleteMemory(memory.memory_id);
  await new Promise((resolve) => setTimeout(resolve, 30));
  report(!(await exists(memoryPath)), 'memory mirror removed');

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}