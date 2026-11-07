export type AgentId = 'tutor' | 'quizzer' | 'analyst' | 'solver';

export interface AgentMeta {
  id: AgentId;
  name: string;
  description: string;
  tools: string[];
}

export const AGENTS: Record<AgentId, AgentMeta> = {
  tutor: {
    id: 'tutor',
    name: 'Tutor 主讲',
    description: '启发式讲解、日常答疑、概念梳理（默认入口）',
    tools: ['knowledge_search', 'memory_write', 'memory_recall', 'wrongbook_add'],
  },
  quizzer: {
    id: 'quizzer',
    name: 'Quizzer 出题',
    description: '按知识点出题、组卷、校准难度、记录作答',
    tools: ['quiz_generate', 'mastery_update', 'mastery_report', 'knowledge_search'],
  },
  analyst: {
    id: 'analyst',
    name: 'Analyst 诊断',
    description: '掌握度分析、薄弱点诊断、错题与复习建议',
    tools: ['mastery_report', 'wrongbook_due', 'knowledge_search'],
  },
  solver: {
    id: 'solver',
    name: 'Solver 解题',
    description: '复杂题分步推理、验算、拍照题讲解',
    tools: ['knowledge_search'],
  },
};

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && AGENT_IDS.includes(value as AgentId);
}
