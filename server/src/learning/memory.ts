import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';

export const DEFAULT_LEARNER = 'default';

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
    return { memory_id: existing.memory_id, type, content: trimmed, updated_at: Date.now() };
  }
  const memoryId = randomUUID();
  db.prepare(
    'INSERT INTO memories (memory_id, learner_id, type, content, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(memoryId, DEFAULT_LEARNER, type, trimmed, Date.now());
  return { memory_id: memoryId, type, content: trimmed, updated_at: Date.now() };
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
}