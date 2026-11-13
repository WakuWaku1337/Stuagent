import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { modelVisualization } from './visualize-modeler.ts';
import { matchPreset, type VizPreset } from './visualize-presets.ts';
import {
  VISUALIZATION_TYPES,
  VisualizationError,
  createVisualization,
  type Visualization,
  type VisualizationType,
} from './visualize.ts';

export const AUTO_VISUALIZE_PATTERN =
  /函数|图像|图象|抛物线|椭圆|双曲线|正弦|余弦|三角函数|勾股|直角三角形|正方形|三角形|矩形|平行四边形|梯形|立体|正方体|长方体|棱锥|棱柱|圆柱|圆锥|球体|截面|分子|甲烷|晶体|键角|受力|摩擦力|斜面|电路|欧姆|光路|透镜|焦距|细胞|细胞器|地形|等高线|数形结合|打印机|进纸|滚轮|摩擦片/;

export function shouldAutoVisualize(message: string, hasImages: boolean): boolean {
  return hasImages || AUTO_VISUALIZE_PATTERN.test(message);
}

export interface GenerateResult {
  visualization: Visualization;
  matched: 'modeled' | 'preset';
  preset_id?: string;
  basis?: string;
}

function createFromPreset(preset: VizPreset, source: string): Visualization {
  const visualization = createVisualization({
    type: preset.type,
    title: preset.title,
    spec: preset.spec,
    source,
    visualizationId: `preset:${preset.id}`,
  });
  return { ...visualization, kind: 'preset' } as Visualization;
}

/**
 * 题目 → 结构化可视化：先按题目文本做确定性解析与建模，不调用对话模型。
 * 只有题目本身是纯主题（没有可解析的具体内容）时才回退预置模板。
 */
export async function generateVisualization(input: {
  question: string;
  subject?: string;
}): Promise<GenerateResult | null> {
  const question = input.question.trim();
  if (!question) throw new VisualizationError('VIZ_QUESTION_REQUIRED', 'question 不能为空');
  if (question.length > 2000) throw new VisualizationError('VIZ_QUESTION_TOO_LONG', 'question 不超过 2000 字');

  const modeled = modelVisualization(question, input.subject);
  if (modeled) {
    const visualization = createVisualization({
      type: modeled.type,
      title: modeled.title,
      spec: modeled.spec,
      source: 'modeler',
    });
    return { visualization, matched: 'modeled', basis: modeled.basis };
  }

  const preset = matchPreset(question, input.subject);
  if (preset) {
    return { visualization: createFromPreset(preset, 'preset'), matched: 'preset', preset_id: preset.id };
  }
  return null;
}

const vizTypeSchema = Type.Union(VISUALIZATION_TYPES.map((value) => Type.Literal(value)));

function parseSpec(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function createVisualizeTool() {
  return defineTool({
    name: 'visualize_generate',
    label: '生成统一可视化',
    description:
      '画图与交互课件的唯一入口。优先只传 question 与 subject：后端按题目文本实际解析函数、方程、几何点/尺寸、分子式或物理场景并本地建模，不调用对话模型；解析不到具体结构时不硬凑图。需要精确控制时再传 type+spec（spec 可传对象或 JSON 字符串）。function2d 的 expression 支持 abs（|x| 写成 abs(x)）、函数定义与复合（g(x)=...，f(x)=g(x)g(|x|)）以及 \\begin{cases} 分段函数。不要在回答里手绘 ASCII 图，直接调用本工具。',
    parameters: Type.Object({
      question: Type.Optional(Type.String({ description: '题目原文；只传它也能出图' })),
      subject: Type.Optional(Type.String({ description: '学科，如 数学 / 化学 / 物理' })),
      type: Type.Optional(vizTypeSchema),
      title: Type.Optional(Type.String({ description: '可视化标题' })),
      spec: Type.Optional(Type.Any({ description: '结构化可视化规格（对象或 JSON 字符串）' })),
    }),
    async execute(_id, params) {
      const spec = parseSpec(params.spec);
      let visualization: Visualization | null = null;

      // function2d 有题目原文时优先走本地确定性建模：模型经常把 f(-x) 误写成 f(x)，
      // 还会带出整块区域填充。只有建模失败时才使用模型自带的 type+spec。
      if (params.question && params.type === 'function2d') {
        const modeled = await generateVisualization({ question: params.question, subject: params.subject });
        if (modeled) visualization = modeled.visualization;
      }

      if (!visualization && params.type && spec) {
        try {
          visualization = createVisualization({
            type: params.type as VisualizationType,
            title: params.title ?? '',
            spec,
            source: 'agent',
          });
        } catch (error) {
          if (!params.question) throw error;
        }
      }

      if (!visualization && params.question) {
        const result = await generateVisualization({ question: params.question, subject: params.subject });
        if (!result) {
          throw new VisualizationError('VIZ_SKIPPED', '未从题目中解析到可建模的图形结构；如确需作图，请传 type+spec');
        }
        visualization = result.visualization;
      }

      if (!visualization) {
        throw new VisualizationError(
          params.spec !== undefined && !spec ? 'VIZ_SPEC_INVALID' : 'VIZ_SPEC_REQUIRED',
          params.spec !== undefined && !spec
            ? 'spec 必须是对象或 JSON 字符串'
            : '需要 question，或 type+title+spec',
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `已生成可视化「${visualization.title}」：[打开可视化](/visualize?id=${visualization.visualization_id})`,
          },
        ],
        details: visualization,
      };
    },
  });
}