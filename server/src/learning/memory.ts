import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../store.ts';

export const DEFAULT_LEARNER = 'default';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const dataRoot = process.env.EDU_DATA_DIR?.trim()
  ? resolve(process.env.EDU_DATA_DIR)
  : resolve(serverRoot, 'data');
const memoryDir = join(dataRoot, 'memory');

async function mirrorMemory(item: MemoryItem): Promise<void> {
  try {
    await mkdir(memoryDir, { recursive: true });
    const body = [
      '# 学习记忆',
      '',
      `- 类型：${item.type}`,
      `- 更新时间：${new Date(item.updated_at).toISOString()}`,
      `- ID：${item.memory_id}`,
      '',
      item.content,
      '',
    ].join('\n');
    await writeFile(join(memoryDir, `${item.memory_id}.md`), body, 'utf8');
  } catch {
    // 文件镜像失败不影响数据库主链路
  }
}

export function ensureLearner(): void {
  const row = db.prepare('SELECT learner_id FROM learners WHERE learner_id = ?').get(DEFAULT_LEARNER);
  if (!row) {
    db.prepare('INSERT INTO learners (learner_id, name, grade, subjects, created_at) VALUES (?, ?, ?, ?, ?)').run(
      DEFAULT_LEARNER,
      '同学',
      '高中',
      '数学,化学,英语',
      Date.now(),
    );
  }
}

export interface MemoryItem {
  memory_id: string;
  type: string;
  content: string;
  updated_at: number;
}

export function writeMemory(content: string, type = 'fact'): MemoryItem {
  ensureLearner();
  const trimmed = content.trim();
  if (!trimmed) throw new Error('记忆内容不能为空');
  const existing = db
    .prepare('SELECT memory_id FROM memories WHERE learner_id = ? AND content = ?')
    .get(DEFAULT_LEARNER, trimmed) as { memory_id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE memories SET updated_at = ? WHERE memory_id = ?').run(Date.now(), existing.memory_id);
    const item = { memory_id: existing.memory_id, type, content: trimmed, updated_at: Date.now() };
    void mirrorMemory(item);
    return item;
  }
  const memoryId = randomUUID();
  db.prepare(
    'INSERT INTO memories (memory_id, learner_id, type, content, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(memoryId, DEFAULT_LEARNER, type, trimmed, Date.now());
  const item = { memory_id: memoryId, type, content: trimmed, updated_at: Date.now() };
  void mirrorMemory(item);
  return item;
}

export function listMemories(limit = 50): MemoryItem[] {
  ensureLearner();
  return db
    .prepare('SELECT memory_id, type, content, updated_at FROM memories WHERE learner_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(DEFAULT_LEARNER, limit) as unknown as MemoryItem[];
}

export function recallMemories(query: string, limit = 10): MemoryItem[] {
  ensureLearner();
  const q = query.trim();
  if (!q) return listMemories(limit);
  return db
    .prepare(
      `SELECT memory_id, type, content, updated_at FROM memories
       WHERE learner_id = ? AND content LIKE ?
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(DEFAULT_LEARNER, `%${q}%`, limit) as unknown as MemoryItem[];
}

/** 每轮对话注入的画像上下文 */
export function profileContext(): string {
  const memories = listMemories(10);
  const learner = db
    .prepare('SELECT name, grade, subjects FROM learners WHERE learner_id = ?')
    .get(DEFAULT_LEARNER) as { name: string; grade: string; subjects: string } | undefined;
  const weak = db
    .prepare('SELECT knowledge_point, probability FROM mastery WHERE learner_id = ? ORDER BY probability ASC LIMIT 5')
    .all(DEFAULT_LEARNER) as unknown as { knowledge_point: string; probability: number }[];

  const lines: string[] = [];
  if (learner) lines.push(`学生：${learner.name}（${learner.grade}），学科：${learner.subjects}`);
  if (weak.length) {
    lines.push(
      `薄弱知识点：${weak.map((w) => `${w.knowledge_point}（掌握度 ${(w.probability * 100).toFixed(0)}%）`).join('、')}`,
    );
  }
  if (memories.length) {
    lines.push(`已知信息：\n${memories.map((m) => `- ${m.content}`).join('\n')}`);
  }
  return lines.join('\n');
}

export function deleteMemory(id: string): void {
  db.prepare('DELETE FROM memories WHERE memory_id = ?').run(id);
  void unlink(join(memoryDir, `${id}.md`)).catch(() => undefined);
}