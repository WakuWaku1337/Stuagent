export interface KeyCandidate {
  keyId: string;
}

export interface KeyOrder<T> {
  ordered: T[];
  nextCursor: number;
}

/**
 * 会话固定 key 优先；其余 key 按 cursor 轮换。
 *
 * 固定 key 不在 available 中（冷却/删除）时自动退回轮换，避免把整个会话卡死。
 */
export function orderKeyCandidates<T extends KeyCandidate>(
  available: T[],
  pinnedKeyId: string | undefined,
  cursor: number,
  maxAttempts: number,
): KeyOrder<T> {
  if (available.length === 0) return { ordered: [], nextCursor: cursor };

  const pinned = pinnedKeyId
    ? available.find((candidate) => candidate.keyId === pinnedKeyId)
    : undefined;
  const rest = pinned ? available.filter((candidate) => candidate !== pinned) : [...available];
  const start = rest.length > 0 ? ((cursor % rest.length) + rest.length) % rest.length : 0;
  const rotated = rest.length > 0 ? [...rest.slice(start), ...rest.slice(0, start)] : [];
  const ordered = (pinned ? [pinned, ...rotated] : rotated).slice(
    0,
    Math.max(1, Math.floor(maxAttempts)),
  );

  return { ordered, nextCursor: cursor + 1 };
}