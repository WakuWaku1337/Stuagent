import { db } from '../store.ts';

export interface MasteryRow {
  knowledge_point: string;
  probability: number;
  correct_count: number;
  wrong_count: number;
  updated_at: number;
}

export function getMastery(learnerId: string, knowledgePoint: string): MasteryRow | undefined {
  return db
    .prepare(
      'SELECT knowledge_point, probability, correct_count, wrong_count, updated_at FROM mastery WHERE learner_id = ? AND knowledge_point = ?',
    )
    .get(learnerId, knowledgePoint) as unknown as MasteryRow | undefined;
}

export function saveMastery(row: MasteryRow & { learner_id: string }): void {
  db.prepare(
    `INSERT INTO mastery (learner_id, knowledge_point, probability, correct_count, wrong_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(learner_id, knowledge_point) DO UPDATE SET
       probability = excluded.probability,
       correct_count = excluded.correct_count,
       wrong_count = excluded.wrong_count,
       updated_at = excluded.updated_at`,
  ).run(row.learner_id, row.knowledge_point, row.probability, row.correct_count, row.wrong_count, row.updated_at);
}

export function listMastery(learnerId: string): MasteryRow[] {
  return db
    .prepare(
      'SELECT knowledge_point, probability, correct_count, wrong_count, updated_at FROM mastery WHERE learner_id = ? ORDER BY probability ASC',
    )
    .all(learnerId) as unknown as MasteryRow[];
}