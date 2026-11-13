import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { modelVisualization } from './visualize-modeler.ts';
import { matchPreset, presetDocument, type VizPreset } from './visualize-presets.ts';
import { functionGraphDocumentFromModeled, conicDocumentFromModeled } from './viz/function-scene.ts';
import { documentFromLegacySpec } from './viz/document.ts';
import {
  VisualizationError,
  createVisualization,
  type Visualization,
} from './visualize.ts';
import { VizPlanError } from '../../../shared/viz/types.ts';

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

function createFromPreset(preset: VizPreset, source: string, inputText?: string): Visualization {
  const document = presetDocument(preset, inputText);
  const visualization = createVisualization({
    type: preset.type,
    title: preset.title,
    spec: document,
    source,
    schemaVersion: 2,
    inputText: inputText?.trim() || preset.title,
    visualizationId: `preset:${preset.id}`,
  });
  return { ...visualization, kind: 'preset' } as Visualization;
}

function hasConcreteStructure(question: string): boolean {
  return /=/.test(question) || /[A-Za-z]\s*\(/.test(question) || /x\s*[\^+\-*/]/.test(question);
}

function createModeledVisualization(
  modeled: NonNullable<ReturnType<typeof modelVisualization>>,
  question: string,
  subject?: string,
): Visualization {
  try {
    if (modeled.type === 'function2d') {
      const doc = functionGraphDocumentFromModeled(modeled, question, subject);
      return createVisualization({
        type: 'function2d',
        title: modeled.title,
        spec: doc,
        source: 'modeler',
        schemaVersion: 2,
        inputText: question,
      });
    }
    if (modeled.type === 'conic') {
      const doc = conicDocumentFromModeled(modeled, question, subject);
      return createVisualization({
        type: 'conic',
        title: modeled.title,
        spec: doc,
        source: 'modeler',
        schemaVersion: 2,
        inputText: question,
      });
    }
    const document = documentFromLegacySpec({
      type: modeled.type,
      title: modeled.title,
      spec: modeled.spec,
      inputText: question,
      subject,
      generator: 'modeler',
    });
    return createVisualization({
      type: modeled.type,
      title: modeled.title,
      spec: document,
      source: 'modeler',
      schemaVersion: 2,
      inputText: question,
    });
  } catch (error) {
    if (error instanceof VizPlanError) {
      throw new VisualizationError(error.code, error.message, 422);
    }
    throw error;
  }
}

/**
 * 题目 → 结构化可视化：先按题目文本做确定性解析与建模，不调用对话模型。
 * 具体函数/方程建模失败时不回退到模型手写 spec；只有纯主题才回退预置模板。
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
    const visualization = createModeledVisualization(modeled, question, input.subject);
    return { visualization, matched: 'modeled', basis: modeled.basis };
  }

  const definitionNames = new Set([...question.matchAll(/([fgh])\s*\(\s*[a-zA-Z]\s*\)\s*=/g)].map((match) => match[1]));
  const explicitTarget = /(?:画出?|作出?|绘制|研究|求)\s*(?:函数)?\s*[fgh]\s*\(/.test(question);
  if (definitionNames.size > 1 && !explicitTarget && !/交点|相交|交于|比较|[与和]/.test(question)) {
    throw new VisualizationError('VIZ_AMBIGUOUS_TARGET', '题目包含多个函数，请明确要绘制哪个函数。', 422);
  }

  if (hasConcreteStructure(question)) return null;

  const preset = matchPreset(question, input.subject);
  if (preset) {
    return { visualization: createFromPreset(preset, 'preset', question), matched: 'preset', preset_id: preset.id };
  }
  return null;
}

export function createVisualizeTool() {
  return defineTool({
    name: 'visualize_generate',
    label: '生成统一可视化',
    description:
      '画图与交互课件的唯一入口。只传题目原文与学科，由后端按题目文本实际解析函数、方程、几何点/尺寸、分子式或物理场景并本地建模，不调用对话模型，也不接受智能体手写 spec。解析不到具体结构时返回结构化原因；不要重试手画。function2d 的表达式支持 abs、函数定义/复合与 \\begin{cases} 分段函数。',
    parameters: Type.Object({
      question: Type.String({ description: '题目原文；必填' }),
      subject: Type.Optional(Type.String({ description: '学科，如 数学 / 化学 / 物理' })),
      hint: Type.Optional(
        Type.Union([
          Type.Literal('auto'),
          Type.Literal('function'),
          Type.Literal('geometry'),
          Type.Literal('molecule'),
          Type.Literal('physics'),
          Type.Literal('diagram'),
        ], { description: '可选的类型提示，仅用于辅助，不改变生成规则' }),
      ),
    }),
    async execute(_id, params) {
      const raw = params as Record<string, unknown>;
      if (raw.spec !== undefined) {
        throw new VisualizationError(
          'VIZ_AGENT_SPEC_FORBIDDEN',
          '可视化 spec 不能由智能体直接提供；请只传题目，由本地建模器生成。',
        );
      }
      if (!params.question.trim()) {
        throw new VisualizationError('VIZ_QUESTION_REQUIRED', 'question 不能为空');
      }
      const result = await generateVisualization({ question: params.question, subject: params.subject });
      if (!result) {
        throw new VisualizationError(
          'VIZ_UNSUPPORTED_STRUCTURE',
          '未从题目中解析到可建模的图形结构；请补充方程、函数定义、点、尺寸或场景信息。',
          422,
        );
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `已生成可视化「${result.visualization.title}」：[打开可视化](/visualize?id=${result.visualization.visualization_id})`,
          },
        ],
        details: result.visualization,
      };
    },
  });
}
