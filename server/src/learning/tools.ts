import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { DEFAULT_LEARNER, listMemories, recallMemories, writeMemory } from './memory.ts';
import { updateMastery, generateQuiz } from './quiz.ts';
import { addWrongRecord, listWrongRecords } from './wrongbook.ts';
import { listMastery } from './mastery.ts';
import { createPlan } from './plan.ts';
import { createVisualizeTool } from './visualize-engine.ts';
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
      difficulty: Type.Optional(Type.String({ description: '基础 | 中等 | 拔高；省略或 auto 时按掌握度推荐' })),
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

  const masteryReport = defineTool({
    name: 'mastery_report',
    label: '掌握度报告',
    description: '读取各知识点 BKT 掌握度、对错次数与薄弱排序，用于诊断分析。',
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: '返回条数，默认 10' })),
    }),
    async execute(_id, params) {
      const rows = listMastery(DEFAULT_LEARNER).slice(0, params.limit ?? 10);
      const text = rows.length
        ? rows
            .map(
              (r) =>
                `- ${r.knowledge_point}：${(r.probability * 100).toFixed(1)}%（对 ${r.correct_count} / 错 ${r.wrong_count}）`,
            )
            .join('\n')
        : '暂无掌握度数据。';
      return { content: [{ type: 'text' as const, text }], details: { rows } };
    },
  });

  const examAnalyze = defineTool({
    name: 'exam_analyze',
    label: '考试复盘',
    description: '对已识别的整卷生成复盘报告（逐题判分、错因归类、失分分布、建议），并联动掌握度与错题本。',
    parameters: Type.Object({
      exam_id: Type.String({ description: '试卷 ID（/api/reviews 列表中的 exam_id）' }),
    }),
    async execute(_id, params) {
      const { analyzeExam } = await import('./exams.ts');
      const result = await analyzeExam(params.exam_id);
      return { content: [{ type: 'text' as const, text: result.report }], details: result.stats };
    },
  });

  const examCompare = defineTool({
    name: 'exam_compare',
    label: '考试趋势对比',
    description: '对比多次考试得分率与累计失分知识点，输出趋势结论。',
    parameters: Type.Object({
      subject: Type.Optional(Type.String({ description: '学科过滤，可选' })),
    }),
    async execute(_id, params) {
      const { compareExams } = await import('./exams.ts');
      const result = compareExams(params.subject);
      const text = `${result.summary}\n\n${result.series.map((s) => `- ${s.date} ${s.name}：${s.score}/${s.total}（${s.rate}%）`).join('\n')}`;
      return { content: [{ type: 'text' as const, text }], details: result };
    },
  });

  const planMake = defineTool({
    name: 'plan_make',
    label: '生成学习计划',
    description:
      '根据学习目标、可用天数、每日学习时长和当前薄弱点生成学习计划并保存，供学生按日执行。学生提出“制定计划/安排复习”时调用。',
    parameters: Type.Object({
      goal: Type.String({ description: '学习目标，例如“两周补完函数基础”' }),
      days: Type.Optional(Type.Number({ description: '计划天数 1-60，默认 7' })),
      daily_minutes: Type.Optional(Type.Number({ description: '每日学习时长（分钟）10-180，默认 30' })),
      subjects: Type.Optional(Type.Array(Type.String(), { description: '涉及学科，可选' })),
    }),
    async execute(_id, params) {
      const plan = createPlan({
        goal: params.goal,
        days: params.days,
        dailyMinutes: params.daily_minutes,
        subjects: params.subjects,
      });
      const preview = plan.content.days
        .slice(0, 3)
        .map((day) => `${day.date} ${day.weekday}（${day.focus}）：${day.tasks.map((task) => task.title).join('；')}`)
        .join('\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: `已生成 ${plan.days} 天学习计划：${plan.content.summary}\n\n前 3 天安排：\n${preview}`,
          },
        ],
        details: plan,
      };
    },
  });

  return [memoryWrite, memoryRecall, wrongbookAdd, masteryUpdate, quizGenerate, dueWrong, masteryReport, planMake, createVisualizeTool(), examAnalyze, examCompare];
}