import { getDocument, listChunks, markChunksIndexed, updateDocument } from '../store.ts';
import { embedTexts } from './embedding.ts';
import { deleteBySource, hybridRecall, insertVectors, type SearchHit } from './milvus.ts';
import { rerank } from './rerank.ts';

export interface Citation {
  index: number;
  chunk_id: string;
  source_id: string;
  source_name: string;
  chapter: string;
  page: number;
  score: number;
  snippet: string;
}

export async function indexDocument(documentId: string): Promise<number> {
  const doc = getDocument(documentId);
  if (!doc) throw new Error('文档不存在');
  const chunks = listChunks(documentId);
  if (chunks.length === 0) throw new Error('没有可灌库的切片');

  updateDocument(documentId, { status: 'indexing', error: null });
  try {
    await deleteBySource(documentId);
    const vectors = await embedTexts(chunks.map((c) => c.text));
    if (vectors.length !== chunks.length) throw new Error(`向量数量不一致 ${vectors.length}/${chunks.length}`);
    await insertVectors(
      chunks.map((c, i) => ({
        chunk_id: c.chunk_id,
        text: c.text,
        dense: vectors[i],
        subject: doc.subject ?? '',
        source_id: documentId,
        source_name: doc.filename,
        chapter: c.chapter ?? '',
        page: c.page ?? 0,
        created_at: doc.created_at,
      })),
    );
    markChunksIndexed(documentId);
    updateDocument(documentId, { status: 'indexed' });
    return chunks.length;
  } catch (e) {
    updateDocument(documentId, { status: 'parsed', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export interface RagResult {
  query: string;
  citations: Citation[];
}

export async function searchKnowledge(
  query: string,
  opts: { topK?: number; candidateK?: number; subject?: string } = {},
): Promise<RagResult> {
  const topK = opts.topK ?? 5;
  const candidateK = opts.candidateK ?? 30;
  const [dense] = await embedTexts([query]);
  const recalled = await hybridRecall(query, dense, 50, opts.subject);
  if (recalled.length === 0) return { query, citations: [] };

  const candidates = recalled.slice(0, candidateK);
  let ordered: SearchHit[];
  try {
    const ranked = await rerank(query, candidates.map((c) => c.text), Math.min(topK, candidates.length));
    const byIndex = new Map(ranked.map((r) => [r.index, r.score]));
    ordered = candidates
      .map((c, i) => ({ ...c, score: byIndex.get(i) ?? 0 }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    if (ordered.length === 0) ordered = candidates.slice(0, topK);
  } catch {
    // 精排不可用时退化为 RRF 粗排结果
    ordered = candidates;
  }

  return {
    query,
    citations: ordered.slice(0, topK).map((c, i) => ({
      index: i + 1,
      chunk_id: c.chunk_id,
      source_id: c.source_id,
      source_name: c.source_name,
      chapter: c.chapter,
      page: c.page,
      score: c.score,
      snippet: c.text.length > 160 ? `${c.text.slice(0, 160)}…` : c.text,
    })),
  };
}

export function buildCitationContext(citations: Citation[]): string {
  return citations
    .map(
      (c) =>
        `[${c.index}] 《${c.source_name}》${c.chapter ? ` · ${c.chapter}` : ''}${c.page ? ` · 第${c.page}页` : ''}\n${c.snippet}`,
    )
    .join('\n\n');
}