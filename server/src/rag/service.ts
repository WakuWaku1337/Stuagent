import { getDocument, listChunks, markChunksIndexed, updateDocument } from '../store.ts';
import { embedTexts } from './embedding.ts';
import { deleteBySource, hybridRecall, insertVectors, type SearchHit } from './milvus.ts';
import { getSemanticCache, invalidateRagCache, putSemanticCache } from './cache.ts';
import { rerank } from './rerank.ts';
import { invalidateAnswerCache } from '../chat/answer-cache.ts';
import { currentLearnerId } from '../learning/context.ts';

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
    await deleteBySource(documentId, doc.learner_id);
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
      doc.learner_id,
    );
    markChunksIndexed(documentId);
    updateDocument(documentId, { status: 'indexed' });
    invalidateRagCache(doc.learner_id);
    invalidateAnswerCache(doc.learner_id);
    lastIndexAt.set(doc.learner_id, Date.now());
    return chunks.length;
  } catch (e) {
    updateDocument(documentId, { status: 'parsed', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

const lastIndexAt = new Map<string, number>();

export interface RagResult {
  query: string;
  citations: Citation[];
  cached?: boolean;
}

export async function searchKnowledge(
  query: string,
  opts: { topK?: number; candidateK?: number; subject?: string; noCache?: boolean } = {},
): Promise<RagResult> {
  const topK = opts.topK ?? 5;
  const candidateK = opts.candidateK ?? 30;
  const [dense] = await embedTexts([query]);
  const cached = opts.noCache ? null : getSemanticCache<RagResult>(dense, opts.subject, topK);
  if (cached) return { ...cached, query, cached: true };
  let recalled = await hybridRecall(query, dense, 50, opts.subject);
  if (recalled.length === 0) {
    const learnerId = currentLearnerId();
    const recent = lastIndexAt.get(learnerId) ?? 0;
    if (Date.now() - recent < 10_000) {
      // Milvus 新写入的切片可能短暂不可见，刚索引完的问题重试一次
      await new Promise((resolve) => setTimeout(resolve, 300));
      recalled = await hybridRecall(query, dense, 50, opts.subject);
    }
  }
  if (recalled.length === 0) return { query, citations: [] };

  const candidates = recalled.slice(0, candidateK);
  const rerankMinChars = Number(process.env.RERANK_MIN_QUERY_CHARS ?? 16);
  let ordered: SearchHit[];
  if (candidates.length <= topK || query.trim().length < rerankMinChars) {
    // 简单短查询直接使用 RRF 粗排，省掉一次 Cross-Encoder 推理
    ordered = candidates.slice(0, topK);
  } else {
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
      ordered = candidates.slice(0, topK);
    }
  }

  const result: RagResult = {
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
    cached: false,
  };
  if (!opts.noCache && result.citations.length > 0) putSemanticCache(dense, opts.subject, topK, result);
  return result;
}

export function buildCitationContext(citations: Citation[]): string {
  return citations
    .map(
      (c) =>
        `[${c.index}] 《${c.source_name}》${c.chapter ? ` · ${c.chapter}` : ''}${c.page ? ` · 第${c.page}页` : ''}\n${c.snippet}`,
    )
    .join('\n\n');
}