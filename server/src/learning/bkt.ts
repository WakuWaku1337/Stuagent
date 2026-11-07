export interface BktParams {
  pL0: number;
  pT: number;
  pS: number;
  pG: number;
}

export const DEFAULT_BKT: BktParams = { pL0: 0.3, pT: 0.1, pS: 0.1, pG: 0.2 };
export const MASTERED_THRESHOLD = 0.95;

/** 标准 BKT：贝叶斯更新 + 学习转移 */
export function bktUpdate(pL: number, correct: boolean, params: BktParams = DEFAULT_BKT): number {
  const { pT, pS, pG } = params;
  const posterior = correct
    ? (pL * (1 - pS)) / (pL * (1 - pS) + (1 - pL) * pG)
    : (pL * pS) / (pL * pS + (1 - pL) * (1 - pG));
  const next = posterior + (1 - posterior) * pT;
  return Math.min(0.999, Math.max(0.001, Number(next.toFixed(4))));
}

export function isMastered(pL: number): boolean {
  return pL >= MASTERED_THRESHOLD;
}