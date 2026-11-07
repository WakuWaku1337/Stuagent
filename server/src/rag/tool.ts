import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { buildCitationContext, searchKnowledge, type Citation } from './service.ts';

/** 每个会话一个工具实例，检索到的引用回传给上层用于 SSE 推送 */
export function createKnowledgeTool(onCitations: (citations: Citation[]) => void) {
  return defineTool({
    name: 'knowledge_search',
    label: '知识库检索',
    description:
      '检索学生上传的教材/资料知识库。当问题涉及教材概念、定义、定理、公式时需要调用。返回带来源编号的片段。',
    parameters: Type.Object({
      query: Type.String({ description: '检索问题，尽量保留学科关键词' }),
      topK: Type.Optional(Type.Number({ description: '返回片段数，默认 5' })),
      subject: Type.Optional(Type.String({ description: '学科过滤，如 数学 / 化学' })),
    }),
    async execute(_toolCallId, params) {
      let result = await searchKnowledge(params.query, {
        topK: params.topK ?? 5,
        subject: params.subject,
      });
      // 资料未标学科时，按学科过滤会误伤；空结果回退到全库检索
      if (result.citations.length === 0 && params.subject) {
        result = await searchKnowledge(params.query, { topK: params.topK ?? 5 });
      }
      onCitations(result.citations);
      const text =
        result.citations.length === 0
          ? '知识库中没有检索到相关内容。'
          : `以下是知识库检索结果，请基于这些内容回答，并用 [编号] 标注引用：\n\n${buildCitationContext(result.citations)}`;
      return { content: [{ type: 'text' as const, text }], details: { citations: result.citations } };
    },
  });
}