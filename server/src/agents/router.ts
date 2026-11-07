import { chatJson } from '../learning/llm.ts';
import { AGENT_IDS, type AgentId } from './roles.ts';

export interface RouteDecision {
  agent: AgentId;
  reason: string;
  source: 'rule' | 'llm' | 'default';
}

const RULES: { agent: AgentId; pattern: RegExp; weight: number }[] = [
  { agent: 'quizzer', pattern: /出题|来几道|做题|练习|测验|组卷|考考我|刷题/, weight: 3 },
  { agent: 'quizzer', pattern: /难度|题量/, weight: 1 },
  { agent: 'solver', pattern: /证明|求证|求解|推导|验算|解题|解法|分步|这道题怎么做|怎么做这道/, weight: 3 },
  { agent: 'solver', pattern: /计算|答案是多少/, weight: 1 },
  { agent: 'analyst', pattern: /诊断|掌握度|薄弱|复盘|学习报告|分析报告|趋势|学得怎么样|水平如何/, weight: 3 },
  { agent: 'analyst', pattern: /错题情况|复习安排|优先级/, weight: 1 },
  { agent: 'tutor', pattern: /讲解|为什么|是什么|概念|不懂|听不懂|区别|梳理/, weight: 2 },
];

/** 规则优先，无法判定时用 LLM 分类；失败回退 Tutor */
export async function routeMessage(message: string): Promise<RouteDecision> {
  const scores = new Map<AgentId, number>();
  const hits: string[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(message)) {
      scores.set(rule.agent, (scores.get(rule.agent) ?? 0) + rule.weight);
      hits.push(`${rule.agent}:${rule.pattern.source.slice(0, 12)}`);
    }
  }
  let best: AgentId | null = null;
  let bestScore = 0;
  for (const [agent, score] of scores) {
    if (score > bestScore) {
      best = agent;
      bestScore = score;
    }
  }
  if (best) {
    return { agent: best, reason: `规则命中（${hits.join(', ')}）`, source: 'rule' };
  }

  try {
    const result = await chatJson<{ agent?: string; reason?: string }>([
      {
        role: 'system',
        content:
          '你是学习助手路由器。根据学生输入判断应由哪个角色处理，只输出 JSON：{"agent":"tutor|quizzer|analyst|solver","reason":"一句话理由"}。tutor=讲解答疑，quizzer=出题练习，analyst=诊断分析，solver=复杂解题。',
      },
      { role: 'user', content: message },
    ], 0);
    const agent = AGENT_IDS.includes(result.agent as AgentId) ? (result.agent as AgentId) : 'tutor';
    return { agent, reason: result.reason ?? 'LLM 分类', source: 'llm' };
  } catch {
    return { agent: 'tutor', reason: '默认入口', source: 'default' };
  }
}