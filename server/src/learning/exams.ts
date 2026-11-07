import { randomUUID } from 'node:crypto';
import { db } from '../store.ts';
import { chatJson } from './llm.ts';
import { updateMastery } from './quiz.ts';
import { DEFAULT_LEARNER, profileContext } from './memory.ts';
import { addWrongRecord } from './wrongbook.ts';
import { chatVisionJson } from './vision.ts';

export interface RecognizedQuestion {
  question_no: number;
  question_type?: string;
  full_score: number;
  got_score: number;
  student_answer?: string | null;
  correct_answer?: string | null;
  knowledge_point?: string;
  content?: string;
  error_reason?: string | null;
  is_correct?: boolean | null;
}

export interface RecognizedPaper {
  name: string;
  subject?: string;
  exam_date?: string;
  duration?: number;
  total_score: number;
  my_score: number;
  questions: RecognizedQuestion[];
}

export interface ExamPaperRow {
  exam_id: string;
  name: string;
  subject: string | null;
  exam_date: string | null;
  total_score: number | null;
  my_score: number | null;
  duration: number | null;
  source: string | null;
  status: string;
  created_at: number;
}

export interface ExamQuestionRow {
  exam_question_id: string;
  exam_id: string;
  question_no: number;
  question_type: string | null;
  full_score: number | null;
  got_score: number | null;
  is_correct: number | null;
  student_answer: string | null;
  correct_answer: string | null;
  error_reason: string | null;
  knowledge_point: string | null;
  content: string | null;
}

const RECOGNIZE_INSTRUCTION = `你是试卷识别助手。请把整卷内容结构化为 JSON，只输出 JSON：
{"name":"试卷名称","subject":"学科","exam_date":"YYYY-MM-DD 或空","duration":分钟数或null,"total_score":总分,"my_score":学生得分,"questions":[{"question_no":1,"question_type":"选择|填空|解答","full_score":分值,"got_score":得分,"student_answer":"学生答案","correct_answer":"正确答案","knowledge_point":"知识点","content":"题干摘要（30字内）","error_reason":"若有批注/错因则填写，否则 null"}]}
要求：题号连续；分值、得分必须是数字；识别老师批改痕迹（勾叉、扣分、批注）；无法确定学生答案时填空字符串。`;

export async function recognizeFromText(text: string, sourceName?: string): Promise<RecognizedPaper> {
  const result = await chatJson<RecognizedPaper>([
    { role: 'system', content: RECOGNIZE_INSTRUCTION },
    { role: 'user', content: `试卷内容：\n${text.slice(0, 12000)}` },
  ]);
  return normalizePaper(result, sourceName);
}

export async function recognizeFromImage(dataUrl: string, sourceName?: string): Promise<RecognizedPaper> {
  const result = await chatVisionJson<RecognizedPaper>(dataUrl, RECOGNIZE_INSTRUCTION);
  return normalizePaper(result, sourceName);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePaper(input: RecognizedPaper, sourceName?: string): RecognizedPaper {
  const questions = (input.questions ?? []).map((q, i) => {
    const full = num(q.full_score);
    const got = num(q.got_score);
    const sameAnswer =
      q.student_answer && q.correct_answer
        ? q.student_answer.trim().toUpperCase() === q.correct_answer.trim().toUpperCase()
        : null;
    const isCorrect = typeof q.is_correct === 'boolean' ? q.is_correct : sameAnswer ?? null;
    return {
      ...q,
      question_no: num(q.question_no, i + 1),
      full_score: full,
      got_score: got,
      is_correct: isCorrect,
      knowledge_point: q.knowledge_point?.trim() || '未标注',
    };
  });
  if (questions.length === 0) throw new Error('未从整卷中识别出题目');
  const totalScore = num(input.total_score) || questions.reduce((s, q) => s + q.full_score, 0);
  const myScore = num(input.my_score) || questions.reduce((s, q) => s + q.got_score, 0);
  return {
    name: input.name?.trim() || sourceName || '未命名试卷',
    subject: input.subject?.trim() || undefined,
    exam_date: input.exam_date || new Date().toISOString().slice(0, 10),
    duration: input.duration ? num(input.duration) : undefined,
    total_score: totalScore,
    my_score: myScore,
    questions,
  };
}

export function savePaper(paper: RecognizedPaper, source: string): { exam_id: string; questions: number } {
  const examId = randomUUID();
  db.prepare(
    `INSERT INTO exam_papers (exam_id, name, subject, exam_date, total_score, my_score, duration, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recognized', ?)`,
  ).run(
    examId,
    paper.name,
    paper.subject ?? null,
    paper.exam_date ?? null,
    paper.total_score,
    paper.my_score,
    paper.duration ?? null,
    source,
    Date.now(),
  );
  const stmt = db.prepare(
    `INSERT INTO exam_questions (exam_question_id, exam_id, question_no, question_type, full_score, got_score, is_correct, student_answer, correct_answer, error_reason, knowledge_point, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const q of paper.questions) {
    stmt.run(
      randomUUID(),
      examId,
      q.question_no,
      q.question_type ?? null,
      q.full_score,
      q.got_score,
      q.is_correct === null || q.is_correct === undefined ? null : q.is_correct ? 1 : 0,
      q.student_answer ?? null,
      q.correct_answer ?? null,
      q.error_reason ?? null,
      q.knowledge_point ?? null,
      q.content ?? null,
    );
  }
  return { exam_id: examId, questions: paper.questions.length };
}

export function listExams(): ExamPaperRow[] {
  return db.prepare('SELECT * FROM exam_papers ORDER BY COALESCE(exam_date, created_at) DESC').all() as unknown as ExamPaperRow[];
}

export function getExam(examId: string) {
  const paper = db.prepare('SELECT * FROM exam_papers WHERE exam_id = ?').get(examId) as unknown as ExamPaperRow | undefined;
  if (!paper) return undefined;
  const questions = db
    .prepare('SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY question_no')
    .all(examId) as unknown as ExamQuestionRow[];
  const review = db
    .prepare('SELECT * FROM exam_reviews WHERE exam_id = ? ORDER BY generated_at DESC LIMIT 1')
    .get(examId) as unknown as { report: string; generated_at: number } | undefined;
  return { paper, questions, review };
}

interface Stats {
  total: number;
  got: number;
  rate: number;
  byType: { type: string; lost: number; full: number }[];
  byKnowledge: { knowledge_point: string; lost: number; full: number; wrong: number; total: number }[];
  wrongCount: number;
}

function computeStats(questions: ExamQuestionRow[]): Stats {
  const total = questions.reduce((s, q) => s + (q.full_score ?? 0), 0);
  const got = questions.reduce((s, q) => s + (q.got_score ?? 0), 0);
  const typeMap = new Map<string, { lost: number; full: number }>();
  const kpMap = new Map<string, { lost: number; full: number; wrong: number; total: number }>();
  let wrongCount = 0;
  for (const q of questions) {
    const lost = (q.full_score ?? 0) - (q.got_score ?? 0);
    const type = q.question_type || '未分类';
    const tp = typeMap.get(type) ?? { lost: 0, full: 0 };
    tp.lost += lost;
    tp.full += q.full_score ?? 0;
    typeMap.set(type, tp);

    const kp = q.knowledge_point || '未标注';
    const k = kpMap.get(kp) ?? { lost: 0, full: 0, wrong: 0, total: 0 };
    k.lost += lost;
    k.full += q.full_score ?? 0;
    k.total += 1;
    if (lost > 0 || q.is_correct === 0) k.wrong += 1;
    kpMap.set(kp, k);
    if (lost > 0 || q.is_correct === 0) wrongCount += 1;
  }
  return {
    total,
    got,
    rate: total > 0 ? Number(((got / total) * 100).toFixed(1)) : 0,
    byType: [...typeMap].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.lost - a.lost),
    byKnowledge: [...kpMap]
      .map(([knowledge_point, v]) => ({ knowledge_point, ...v }))
      .sort((a, b) => b.lost - a.lost),
    wrongCount,
  };
}

async function classifyReasons(questions: ExamQuestionRow[]): Promise<Record<string, string>> {
  const wrong = questions.filter((q) => q.error_reason === null && ((q.got_score ?? 0) < (q.full_score ?? 0)));
  if (wrong.length === 0) return {};
  try {
    const result = await chatJson<{ items: { question_no: number; reason: string }[] }>([
      {
        role: 'system',
        content:
          '你是试卷分析师。为每道错题归因，只输出 JSON：{"items":[{"question_no":1,"reason":"知识漏洞|审题失误|计算错误|表达不规范|时间分配"}]}。reason 必须从这五类中选一个。',
      },
      {
        role: 'user',
        content: wrong
          .map(
            (q) =>
              `第${q.question_no}题 知识点:${q.knowledge_point} 得分:${q.got_score}/${q.full_score} 学生答案:${q.student_answer ?? ''} 正确答案:${q.correct_answer ?? ''}`,
          )
          .join('\n'),
      },
    ], 0.2);
    const map: Record<string, string> = {};
    for (const item of result.items ?? []) map[String(item.question_no)] = item.reason;
    return map;
  } catch {
    return {};
  }
}

export interface AnalyzeResult {
  exam_id: string;
  report: string;
  stats: Stats;
  masteryUpdates: { knowledge_point: string; probability: number }[];
  wrongAdded: number;
}

export async function analyzeExam(examId: string): Promise<AnalyzeResult> {
  const detail = getExam(examId);
  if (!detail) throw new Error('试卷不存在');
  const { paper, questions } = detail;
  if (questions.length === 0) throw new Error('试卷没有题目');

  const reasonMap = await classifyReasons(questions);

  for (const q of questions) {
    const lost = (q.full_score ?? 0) - (q.got_score ?? 0);
    const isCorrect = q.is_correct !== null ? q.is_correct === 1 : lost <= 0;
    const reason = q.error_reason ?? reasonMap[String(q.question_no)] ?? null;
    db.prepare('UPDATE exam_questions SET is_correct = ?, error_reason = ? WHERE exam_question_id = ?').run(
      isCorrect ? 1 : 0,
      isCorrect ? null : reason,
      q.exam_question_id,
    );
    q.is_correct = isCorrect ? 1 : 0;
    q.error_reason = isCorrect ? null : reason;
  }

  const stats = computeStats(questions);
  const masteryUpdates: { knowledge_point: string; probability: number }[] = [];
  const byKp = new Map<string, boolean[]>();
  for (const q of questions) {
    const arr = byKp.get(q.knowledge_point ?? '未标注') ?? [];
    arr.push(q.is_correct === 1);
    byKp.set(q.knowledge_point ?? '未标注', arr);
  }
  for (const [kp, results] of byKp) {
    let p = 0;
    for (const ok of results) p = updateMastery(kp, ok);
    masteryUpdates.push({ knowledge_point: kp, probability: p });
  }

  let wrongAdded = 0;
  for (const q of questions) {
    if (q.is_correct === 1) continue;
    db.prepare(
      `INSERT OR IGNORE INTO questions (question_id, bank_id, subject, knowledge_point, difficulty, content, options, answer, explanation, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, NULL, ?, ?)`,
    ).run(
      q.exam_question_id,
      `exam:${examId}`,
      paper.subject,
      q.knowledge_point ?? '未标注',
      '考试',
      q.content ?? `第${q.question_no}题`,
      q.correct_answer ?? '',
      `exam:${examId}`,
      Date.now(),
    );
    addWrongRecord({
      learnerId: DEFAULT_LEARNER,
      questionId: q.exam_question_id,
      snapshot: {
        content: q.content ?? `第${q.question_no}题`,
        answer: q.correct_answer,
        explanation: null,
        knowledge_point: q.knowledge_point,
        difficulty: '考试',
        exam: paper.name,
      },
      studentAnswer: q.student_answer ?? undefined,
      reason: q.error_reason ?? '考试失分',
    });
    wrongAdded += 1;
  }

  const report = await buildReport(paper, questions, stats, masteryUpdates);
  db.prepare(
    `INSERT INTO exam_reviews (review_id, exam_id, summary, loss_analysis, suggestions, report, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    examId,
    `得分率 ${stats.rate}%`,
    JSON.stringify({ byType: stats.byType, byKnowledge: stats.byKnowledge }),
    JSON.stringify(masteryUpdates.map((m) => m.knowledge_point)),
    report,
    Date.now(),
  );
  db.prepare("UPDATE exam_papers SET status = 'analyzed' WHERE exam_id = ?").run(examId);

  return { exam_id: examId, report, stats, masteryUpdates, wrongAdded };
}

async function buildReport(
  paper: ExamPaperRow,
  questions: ExamQuestionRow[],
  stats: Stats,
  mastery: { knowledge_point: string; probability: number }[],
): Promise<string> {
  const facts = {
    name: paper.name,
    subject: paper.subject,
    score: `${stats.got}/${stats.total}`,
    rate: stats.rate,
    byType: stats.byType,
    byKnowledge: stats.byKnowledge,
    wrong: questions
      .filter((q) => q.is_correct === 0)
      .map((q) => ({ no: q.question_no, kp: q.knowledge_point, reason: q.error_reason, lost: (q.full_score ?? 0) - (q.got_score ?? 0) })),
    mastery,
    profile: profileContext(),
  };
  try {
    return await chatJson<{ report: string }>([
      {
        role: 'system',
        content:
          '你是学习诊断分析师。基于给定数据写考试复盘报告，只输出 JSON：{"report":"Markdown 文本"}。报告必须包含：## 总体情况、## 失分分布（题型/知识点）、## 错因归类、## 行动建议（含下次目标分与变式题方向）。结论先行，数字必须来自数据，不得编造。',
      },
      { role: 'user', content: JSON.stringify(facts) },
    ]).then((r) => r.report);
  } catch {
    const weak = stats.byKnowledge.slice(0, 3);
    return [
      `## 总体情况`,
      `${paper.name}：得分 ${stats.got}/${stats.total}，得分率 ${stats.rate}%。`,
      ``,
      `## 失分分布`,
      ...stats.byType.map((t) => `- ${t.type}：失 ${t.lost}/${t.full} 分`),
      ...weak.map((k) => `- ${k.knowledge_point}：失 ${k.lost}/${k.full} 分（错 ${k.wrong}/${k.total} 题）`),
      ``,
      `## 错因归类`,
      ...questions
        .filter((q) => q.is_correct === 0)
        .map((q) => `- 第${q.question_no}题（${q.knowledge_point}）：${q.error_reason ?? '未归类'}`),
      ``,
      `## 行动建议`,
      `优先攻克：${weak.map((k) => k.knowledge_point).join('、') || '保持当前节奏'}；下次目标分：${Math.min(stats.total, Math.ceil(stats.got * 1.1))}。`,
    ].join('\n');
  }
}

export interface CompareResult {
  subject: string | null;
  series: { exam_id: string; name: string; date: string; score: number; total: number; rate: number }[];
  weakest: { knowledge_point: string; lost: number; wrong: number }[];
  summary: string;
}

export function compareExams(subject?: string): CompareResult {
  const papers = subject
    ? (db.prepare('SELECT * FROM exam_papers WHERE subject = ? ORDER BY exam_date ASC').all(subject) as unknown as ExamPaperRow[])
    : (db.prepare('SELECT * FROM exam_papers ORDER BY exam_date ASC').all() as unknown as ExamPaperRow[]);

  const series = papers
    .filter((p) => (p.total_score ?? 0) > 0)
    .map((p) => ({
      exam_id: p.exam_id,
      name: p.name,
      date: p.exam_date ?? new Date(p.created_at).toISOString().slice(0, 10),
      score: p.my_score ?? 0,
      total: p.total_score ?? 0,
      rate: Number((((p.my_score ?? 0) / (p.total_score ?? 1)) * 100).toFixed(1)),
    }));

  const kpMap = new Map<string, { lost: number; wrong: number }>();
  for (const p of papers) {
    const rows = db
      .prepare('SELECT knowledge_point, full_score, got_score, is_correct FROM exam_questions WHERE exam_id = ?')
      .all(p.exam_id) as unknown as { knowledge_point: string | null; full_score: number | null; got_score: number | null; is_correct: number | null }[];
    for (const r of rows) {
      if (r.is_correct === 1 || (r.got_score ?? 0) >= (r.full_score ?? 0)) continue;
      const kp = r.knowledge_point ?? '未标注';
      const item = kpMap.get(kp) ?? { lost: 0, wrong: 0 };
      item.lost += (r.full_score ?? 0) - (r.got_score ?? 0);
      item.wrong += 1;
      kpMap.set(kp, item);
    }
  }
  const weakest = [...kpMap]
    .map(([knowledge_point, v]) => ({ knowledge_point, ...v }))
    .sort((a, b) => b.lost - a.lost)
    .slice(0, 5);

  let summary: string;
  if (series.length === 0) {
    summary = '暂无考试记录。';
  } else if (series.length === 1) {
    summary = `目前只有 1 次考试（得分率 ${series[0].rate}%），再做一次试卷即可得到趋势对比。`;
  } else {
    const first = series[0];
    const last = series[series.length - 1];
    const diff = Number((last.rate - first.rate).toFixed(1));
    summary = `共 ${series.length} 次考试，得分率从 ${first.rate}% 变化到 ${last.rate}%（${diff >= 0 ? '+' : ''}${diff} 个百分点）。累计失分最多的知识点：${weakest.map((w) => w.knowledge_point).join('、') || '无'}。`;
  }
  return { subject: subject ?? null, series, weakest, summary };
}

export function listExamSummaries() {
  return listExams().map((p) => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id = ?').get(p.exam_id) as { n: number };
    const review = db
      .prepare('SELECT COUNT(*) AS n FROM exam_reviews WHERE exam_id = ?')
      .get(p.exam_id) as { n: number };
    return { ...p, question_count: count.n, reviewed: review.n > 0 };
  });
}