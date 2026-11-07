import { callLlm, parseJson } from './llm.ts';

interface VisionOptions {
  scenario?: string;
  subject?: string;
}

/** 多模态识别：图片整卷 → 模型 JSON 输出 */
export async function chatVisionJson<T>(
  dataUrl: string,
  instruction: string,
  options: VisionOptions = {},
): Promise<T> {
  const result = await callLlm({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    scenario: options.scenario ?? 'vision',
    subject: options.subject,
    json: true,
  });
  return parseJson<T>(result.text);
}