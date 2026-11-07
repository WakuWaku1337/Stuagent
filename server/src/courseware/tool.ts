import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { generateCourseware } from './service.ts';

export function createCoursewareTool() {
  return defineTool({
    name: 'courseware_generate',
    label: '生成交互课件',
    description:
      '把几何/化学等抽象难点生成可交互的单文件 HTML 课件（canvas 演示 + 滑块），返回可访问链接。学生说"看不懂、想要动画/课件"时调用。',
    parameters: Type.Object({
      topic: Type.String({ description: '课件主题，例如：勾股定理、函数图像平移、分子空间构型' }),
      subject: Type.Optional(Type.String({ description: '学科，如 数学 / 化学' })),
    }),
    async execute(_id, params) {
      const row = await generateCourseware({ topic: params.topic, subject: params.subject });
      return {
        content: [
          {
            type: 'text' as const,
            text: `已生成交互课件《${row.title}》（${row.source === 'llm' ? '模型生成' : '内置模板'}），可在课件页查看：/courseware?open=${row.courseware_id}`,
          },
        ],
        details: { courseware_id: row.courseware_id, url: `/api/courseware/${row.courseware_id}` },
      };
    },
  });
}