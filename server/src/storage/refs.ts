import { db } from '../store.ts';

function idsFromAttachments(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (item && typeof item === 'object' ? (item as { media_id?: unknown }).media_id : null))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export function referencedMediaIds(): Set<string> {
  const rows = db
    .prepare('SELECT attachments FROM messages WHERE attachments IS NOT NULL')
    .all() as { attachments: string }[];
  const ids = new Set<string>();
  for (const row of rows) {
    for (const id of idsFromAttachments(row.attachments)) ids.add(id);
  }
  return ids;
}

export function conversationMediaIds(conversationId: string): string[] {
  const rows = db
    .prepare('SELECT attachments FROM messages WHERE conversation_id = ? AND attachments IS NOT NULL')
    .all(conversationId) as { attachments: string }[];
  const ids = new Set<string>();
  for (const row of rows) {
    for (const id of idsFromAttachments(row.attachments)) ids.add(id);
  }
  return [...ids];
}
