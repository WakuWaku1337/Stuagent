export interface GuardResult {
  blocked: boolean;
  reason?: string;
  matches?: string[];
}

const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'override-instructions', re: /(忽略|无视|忘掉)(之前|以上|前面|所有).{0,8}(指令|提示|规则|设定)/ },
  { name: 'ignore-instructions', re: /ignore\s+(all\s+|the\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i },
  { name: 'prompt-exfiltration', re: /(输出|显示|告诉我|复述|泄露).{0,10}(系统提示词|系统指令|developer\s*message|system\s*prompt)/i },
  { name: 'prompt-exfiltration-en', re: /(reveal|print|show|repeat).{0,20}(system\s*prompt|hidden\s*prompt|instructions)/i },
  { name: 'role-hijack', re: /(你现在是|从现在开始你是|you\s+are\s+now)\s*(dan|jailbreak|开发者模式|无限制)/i },
  { name: 'fake-role-tags', re: /<\s*\/?\s*(system|developer|assistant)\s*>/i },
  { name: 'dev-mode', re: /进入.{0,4}(开发者模式|上帝模式|无限制模式)/ },
];

/** 输入侧：提示词注入拦截（规则，确定性可测） */
export function checkInput(text: string): GuardResult {
  const matches: string[] = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(text)) matches.push(p.name);
  }
  if (matches.length > 0) {
    return { blocked: true, reason: '检测到提示词注入尝试，已拒绝处理。', matches };
  }
  return { blocked: false };
}

export interface RedactionResult {
  text: string;
  hits: { type: string; count: number }[];
}

const PII_RULES: { type: string; re: RegExp; mask: (m: string) => string }[] = [
  {
    type: 'phone',
    re: /(?<!\d)(1[3-9]\d{9})(?!\d)/g,
    mask: (m) => `${m.slice(0, 3)}****${m.slice(-4)}`,
  },
  {
    type: 'id-card',
    re: /(?<!\d)(\d{6})(\d{4})(\d{2})(\d{2})(\d{3}[\dXx])(?!\d)/g,
    mask: (m) => `${m.slice(0, 6)}********${m.slice(-4)}`,
  },
  {
    type: 'bank-card',
    re: /(?<!\d)(\d{4})\d{8,11}(\d{4})(?!\d)/g,
    mask: (m) => `${m.slice(0, 4)}********${m.slice(-4)}`,
  },
  {
    type: 'email',
    re: /([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    mask: (m) => `${m[0]}***${m.slice(m.indexOf('@'))}`,
  },
];

const SECRET_RULES: { type: string; re: RegExp; mask: (m: string) => string }[] = [
  { type: 'api-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, mask: (m) => `${m.slice(0, 5)}****` },
  { type: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g, mask: () => 'Bearer ****' },
  { type: 'access-key', re: /\b(AKID|LTAI)[A-Za-z0-9]{12,}\b/g, mask: (m) => `${m.slice(0, 4)}****` },
];

function applyRules(
  text: string,
  rules: { type: string; re: RegExp; mask: (m: string) => string }[],
): RedactionResult {
  let out = text;
  const hits: { type: string; count: number }[] = [];
  for (const rule of rules) {
    let count = 0;
    out = out.replace(rule.re, (m) => {
      count += 1;
      return rule.mask(m);
    });
    if (count > 0) hits.push({ type: rule.type, count });
  }
  return { text: out, hits };
}

/** 输入/文档文本：隐私脱敏 */
export function redactPII(text: string): RedactionResult {
  return applyRules(text, PII_RULES);
}

/** 输出侧：脱敏 + 密钥/令牌过滤 */
export function filterOutput(text: string): RedactionResult {
  const pii = applyRules(text, PII_RULES);
  const secret = applyRules(pii.text, SECRET_RULES);
  return { text: secret.text, hits: [...pii.hits, ...secret.hits] };
}

/** 流式输出过滤：保留尾部 24 字符，避免敏感模式被分片漏检 */
export class StreamRedactor {
  private carry = '';
  private static TAIL = 24;

  push(delta: string): string {
    const combined = this.carry + delta;
    const filtered = filterOutput(combined).text;
    if (filtered.length <= StreamRedactor.TAIL) {
      this.carry = filtered;
      return '';
    }
    const cut = filtered.length - StreamRedactor.TAIL;
    this.carry = filtered.slice(cut);
    return filtered.slice(0, cut);
  }

  flush(): string {
    const rest = filterOutput(this.carry).text;
    this.carry = '';
    return rest;
  }
}