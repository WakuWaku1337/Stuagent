import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { chatJson } from './llm.ts';
import { matchPreset, type VizPreset } from './visualize-presets.ts';
import {
  VISUALIZATION_TYPES,
  VisualizationError,
  createVisualization,
  type Visualization,
  type VisualizationType,
} from './visualize.ts';

export const AUTO_VISUALIZE_PATTERN =
  /函数|图像|图象|抛物线|椭圆|双曲线|正弦|余弦|三角函数|勾股|直角三角形|立体|正方体|长方体|棱锥|棱柱|圆柱|圆锥|球体|截面|分子|甲烷|晶体|键角|受力|摩擦力|斜面|电路|欧姆|光路|透镜|细胞|细胞器|地形|等高线|数形结合/;

export function shouldAutoVisualize(message: string, hasImages: boolean): boolean {
  return hasImages || AUTO_VISUALIZE_PATTERN.test(message);
}

const JUDGE_PROMPT = `你是可视化判定器。读题后判断是否值得生成可交互可视化，并只输出 JSON：
{"visualize":true|false,"type":"...","title":"...","spec":{...}}
不值得可视化（纯文字问答、概念背诵、无需图形）时输出 {"visualize":false}。
type 只能是 geometry3d/function2d/function3d/conic/molecule/terrain/biology/physics/diagram。
spec 规则：
- geometry3d：points[{id,coord:[x,y,z]}]、edges[[id,id]]、faces[[id...]]、auxiliary[{kind,points:[id...],style:{dash,color,opacity},reason}]、labels:true。auxiliary kind 取 line/plane/perpendicular/midline/parallel/projection/mark/hidden/trajectory，reason 写为什么加这条辅助元素。
- function2d：functions[{expression,color,label}]（可多条叠加）、range:[min,max]、relations[{kind:"intersection",solve:"f=g"}]、regions[{where:"f<g",fill}]、sliders[{param,min,max,step,value}]；单函数也可用 expression。
- conic：expression 为隐式方程（如 x^2/9+y^2/4-1），implicit:true，range。
- function3d/terrain：expression 为二元函数（x,y）或 terrain 用 grid 二维数组，range。
- molecule：format:"xyz"|"pdb"|"sdf"，data 为结构文本，style:"stick"|"sphere"。
- biology：parts[{id,label,coord,radius,color}]。
- physics/diagram：elements[{kind:"rect"|"arrow"|"text"|"line"|"circle",x,y,w,h,r,from:[x,y],to:[x,y],label,text,color,rotate}]，画布坐标 0~720 x 0~420。
表达式只用 + - * / ^ 与 sin/cos/tan/sqrt/log/ln/exp/abs，变量 x（二元加 y），禁止 eval 与任何代码。|x| 写成 abs(x)；分段函数尽量合并成单式（例如 3x|x| 写作 3*x*abs(x)，符号函数可用 x/abs(x)）。
学生明确要求画图、看图像、要课件时，visualize 必须为 true，不要以文字替代作图。`;

export interface GenerateResult {
  visualization: Visualization;
  matched: 'preset' | 'llm' | 'fallback';
  preset_id?: string;
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

export async function generateVisualization(input: {
  question: string;
  subject?: string;
}): Promise<GenerateResult | null> {
  const question = input.question.trim();
  if (!question) throw new VisualizationError('VIZ_QUESTION_REQUIRED', 'question 不能为空');
  if (question.length > 2000) throw new VisualizationError('VIZ_QUESTION_TOO_LONG', 'question 不超过 2000 字');

  const preset = matchPreset(question, input.subject);
  if (preset) {
    return { visualization: createFromPreset(preset, 'preset'), matched: 'preset', preset_id: preset.id };
  }

  const forceTemplate = process.env.COURSEWARE_FORCE_TEMPLATE === '1';
  if (!forceTemplate) {
    try {
      const decision = await chatJson<{
        visualize?: boolean;
        type?: string;
        title?: string;
        spec?: unknown;
      }>(
        [
          { role: 'system', content: JUDGE_PROMPT },
          { role: 'user', content: `题目：${question}${input.subject ? `（${input.subject}）` : ''}` },
        ],
        { scenario: 'courseware', subject: input.subject, timeoutMs: 20000 },
      );
      if (decision.visualize === false) return null;
      const type = decision.type as VisualizationType;
      if (!VISUALIZATION_TYPES.includes(type)) {
        throw new VisualizationError('VIZ_TYPE_INVALID', `模型返回了不支持的类型：${decision.type}`);
      }
      const visualization = createVisualization({
        type,
        title: decision.title?.trim() || question.slice(0, 40),
        spec: decision.spec,
        source: 'llm',
      });
      return { visualization: { ...visualization, kind: 'generated' } as Visualization, matched: 'llm' };
    } catch (error) {
      if (error instanceof VisualizationError && error.code === 'VIZ_TYPE_INVALID') throw error;
      // 判定失败不硬凑：宁可不出图，也不要给一张与题目无关的预置图
      return null;
    }
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
      '画图与交互课件的唯一入口。优先只传 question 与 subject：先匹配预置课件库，未命中由模型生成 spec，仍失败回退预置，保证有图。需要精确控制时再传 type+spec（spec 可传对象或 JSON 字符串）。function2d 的 expression 支持 abs（|x| 写成 abs(x)），分段函数请合并为单式（3x|x| → 3*x*abs(x)）。不要在回答里手绘 ASCII 图，直接调用本工具。',
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

      if (params.type && spec) {
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
          throw new VisualizationError('VIZ_SKIPPED', '未生成可视化（判定无需作图或模型不可用）；如确需作图，请传 type+spec');
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