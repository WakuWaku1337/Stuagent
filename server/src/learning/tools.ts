import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { DEFAULT_LEARNER, listMemories, recallMemories, writeMemory } from './memory.ts';
import { updateMastery, generateQuiz } from './quiz.ts';
import { addWrongRecord, listWrongRecords } from './wrongbook.ts';
import { listMastery } from './mastery.ts';
import { db } from '../store.ts';

function saveManualQuestion(input: {
  question: string;
  correctAnswer: string;
  knowledgePoint: string;
}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO questions (question_id, bank_id, subject, knowledge_point, difficulty, content, options, answer, explanation, source, created_at)
     VALUES (?, 'manual', NULL, ?, '未知', ?, '{}', ?, NULL, 'chat', ?)`,
  ).run(id, input.knowledgePoint, input.question, input.correctAnswer, Date.now());
  return id;
}

export function createLearningTools() {
  const memoryWrite = defineTool({
    name: 'memory_write',
    label: '写入学习记忆',
    description: '记住学生的长期信息（学习目标、薄弱点、偏好、习惯、重要事件）。学生透露个人信息或明确要求记住时调用。',
    parameters: Type.Object({
      content: Type.String({ description: '要记住的一句话事实' }),
      type: Type.Optional(Type.String({ description: 'fact | preference | goal | weakness，默认 fact' })),
    }),
    async execute(_id, params) {
      const item = writeMemory(params.content, params.type ?? 'fact');
      return { content: [{ type: 'text' as const, text: `已记住：${item.content}` }], details: item };
    },
  });

  const memoryRecall = defineTool({
    name: 'memory_recall',
    label: '回忆学习记忆',
    description: '检索关于该学生的长期记忆。需要个性化讲解或回顾历史信息时调用。',
    parameters: Type.Object({
      query: Type.String({ description: '检索关键词，留空可列出最近记忆' }),
    }),
    async execute(_id, params) {
      const items = params.query.trim() ? recallMemories(params.query) : listMemories(10);
      return {
        content: [
          {
            type: 'text' as const,
            text: items.length ? items.map((m) => `- ${m.content}`).join('\n') : '暂无相关记忆。',
          },
        ],
        details: { items },
      };
    },
  });

  const wrongbookAdd = defineTool({
    name: 'wrongbook_add',
    label: '收录错题',
    description: '把学生做错的题目收入错题本。学生说"这题我不会/做错了"或对话中确认答错时调用。',
    parameters: Type.Object({
      question: Type.String({ description: '题干' }),
      student_answer: Type.Optional(Type.String({ description: '学生答案' })),
      correct_answer: Type.String({ description: '正确答案' }),
      reason: Type.Optional(Type.String({ description: '错因：知识漏洞/审题失误/计算错误/表达不规范/时间分配' })),
      knowledge_point: Type.String({ description: '知识点' }),
    }),
    async execute(_id, params) {
      const questionId = saveManualQuestion({
        question: params.question,
        correctAnswer: params.correct_answer,
        knowledgePoint: params.knowledge_point,
      });
      const record = addWrongRecord({
        learnerId: DEFAULT_LEARNER,
        questionId,
        snapshot: {
          content: params.question,
          answer: params.correct_answer,
          explanation: null,
          knowledge_point: params.knowledge_point,
        },
        studentAnswer: params.student_answer,
        reason: params.reason,
      });
      return {
        content: [{ type: 'text' as const, text: `已收录错题（知识点：${params.knowledge_point}），下次复习：${new Date(record.next_review).toLocaleDateString('zh-CN')}` }],
        details: record,
      };
    },
  });

  const masteryUpdate = defineTool({
    name: 'mastery_update',
    label: '更新掌握度',
    description: '根据一次作答结果更新知识点掌握度（BKT）。学生做对/做错某知识点题目时调用。',
    parameters: Type.Object({
      knowledge_point: Type.String({ description: '知识点名称' }),
      is_correct: Type.Boolean({ description: '本次是否答对' }),
    }),
    async execute(_id, params) {
      const probability = updateMastery(params.knowledge_point, params.is_correct);
      const weak = listMastery(DEFAULT_LEARNER).slice(0, 5);
      return {
        content: [
          {
            type: 'text' as const,
            text: `「${params.knowledge_point}」掌握度更新为 ${(probability * 100).toFixed(1)}%。当前薄弱：${weak.map((w) => `${w.knowledge_point} ${(w.probability * 100).toFixed(0)}%`).join('、') || '无'}`,
          },
        ],
        details: { probability, weak },
      };
    },
  });

  const quizGenerate = defineTool({
    name: 'quiz_generate',
    label: '生成练习题',
    description: '按知识点出单选题。学生要求练习/出题时调用。',
    parameters: Type.Object({
      knowledge_point: Type.String({ description: '知识点' }),
      difficulty: Type.Optional(Type.String({ description: '基础 | 中等 | 拔高，默认中等' })),
      count: Type.Optional(Type.Number({ description: '题量 1-10，默认 3' })),
    }),
    async execute(_id, params) {
      const questions = await generateQuiz({
        knowledgePoint: params.knowledge_point,
        difficulty: params.difficulty,
        count: params.count,
      });
      const text = questions
        .map(
          (q, i) =>
            `${i + 1}. ${q.content}\n${Object.entries(JSON.parse(q.options) as Record<string, string>)
              .map(([k, v]) => `${k}. ${v}`)
              .join('\n')}\n答案：${q.answer}`,
        )
        .join('\n\n');
      return { content: [{ type: 'text' as const, text: `已生成 ${questions.length} 道题：\n\n${text}` }], details: { count: questions.length } };
    },
  });

  const dueWrong = defineTool({
    name: 'wrongbook_due',
    label: '待复习错题',
    description: '查看今天到期需要复习的错题。学生问复习安排时调用。',
    parameters: Type.Object({}),
    async execute() {
      const rows = listWrongRecords(DEFAULT_LEARNER, true);
      const text = rows.length
        ? rows
            .slice(0, 10)
            .map((r, i) => {
              const snap = JSON.parse(r.question_snapshot) as { content?: string; knowledge_point?: string };
              return `${i + 1}. [${snap.knowledge_point}] ${snap.content?.slice(0, 80) ?? ''}`;
            })
            .join('\n')
        : '今天没有到期错题。';
      return { content: [{ type: 'text' as const, text }], details: { count: rows.length } };
    },
  });

  return [memoryWrite, memoryRecall, wrongbookAdd, masteryUpdate, quizGenerate, dueWrong];
}