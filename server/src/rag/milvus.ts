import { DataType, MetricType, MilvusClient } from '@zilliz/milvus2-sdk-node';
import { currentLearnerId } from '../learning/context.ts';
import { MILVUS_TIMEOUT_MS, RAG_RETRY_MAX } from '../config.ts';
import { RagCallError } from './resilience.ts';

export const DIM = 1024;
export const LEGACY_COLLECTION = 'edu_chunks';

export function collectionFor(learnerId = currentLearnerId()): string {
  // 旧版本只有一个 collection，全部数据属于 default；保留它作为首个账号的集合，避免强制重建向量。
  if (learnerId === 'default') return LEGACY_COLLECTION;
  const safe = learnerId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 120);
  return `edu_chunks_${safe || 'default'}`;
}

let client: MilvusClient | null = null;
export function milvus(): MilvusClient {
  if (!client) {
    client = new MilvusClient({
      address: process.env.MILVUS_ADDRESS ?? 'localhost:19530',
      timeout: MILVUS_TIMEOUT_MS,
      maxRetries: RAG_RETRY_MAX,
      retryDelay: 300,
      ...(process.env.MILVUS_TOKEN?.trim() ? { token: process.env.MILVUS_TOKEN.trim() } : {}),
      ...(process.env.MILVUS_USERNAME?.trim()
        ? {
            username: process.env.MILVUS_USERNAME.trim(),
            password: process.env.MILVUS_PASSWORD ?? '',
          }
        : {}),
    });
  }
  return client;
}

const ensured = new Map<string, Promise<void>>();

export function ensureCollection(learnerId = currentLearnerId()): Promise<void> {
  const collection = collectionFor(learnerId);
  const existing = ensured.get(collection);
  if (existing) return existing;
  const promise = (async () => {
    const c = milvus();
    const exists = await c.hasCollection({ collection_name: collection });
    if (exists.value) return;
    await c.createCollection({
      collection_name: collection,
      schema: [
        { name: 'chunk_id', data_type: DataType.VarChar, is_primary_key: true, max_length: 100 },
        {
          name: 'text',
          data_type: DataType.VarChar,
          max_length: 65535,
          enable_analyzer: true,
          enable_match: true,
          analyzer_params: { tokenizer: 'jieba', filter: ['cnalphanumonly'] },
        },
        { name: 'sparse_vector', data_type: DataType.SparseFloatVector },
        { name: 'dense_vector', data_type: DataType.FloatVector, dim: DIM },
        { name: 'subject', data_type: DataType.VarChar, max_length: 32 },
        { name: 'source_id', data_type: DataType.VarChar, max_length: 100 },
        { name: 'source_name', data_type: DataType.VarChar, max_length: 256 },
        { name: 'chapter', data_type: DataType.VarChar, max_length: 256 },
        { name: 'page', data_type: DataType.Int64 },
        { name: 'created_at', data_type: DataType.Int64 },
      ],
      functions: [
        {
          name: 'bm25',
          type: 'BM25',
          input_field_names: ['text'],
          output_field_names: ['sparse_vector'],
        },
      ],
      index_params: [
        {
          field_name: 'dense_vector',
          index_type: 'HNSW',
          metric_type: MetricType.COSINE,
          params: { M: 16, efConstruction: 200 },
        },
        {
          field_name: 'sparse_vector',
          index_type: 'SPARSE_INVERTED_INDEX',
          metric_type: 'BM25',
        },
      ],
    });
    await c.loadCollection({ collection_name: collection });
  })().catch((e) => {
    ensured.delete(collection);
    throw e;
  });
  ensured.set(collection, promise);
  return promise;
}

export interface ChunkVector {
  chunk_id: string;
  text: string;
  dense: number[];
  subject: string;
  source_id: string;
  source_name: string;
  chapter: string;
  page: number;
  created_at: number;
}

export async function insertVectors(rows: ChunkVector[], learnerId = currentLearnerId()): Promise<void> {
  if (rows.length === 0) return;
  await ensureCollection(learnerId);
  await milvus().insert({
    collection_name: collectionFor(learnerId),
    data: rows.map((r) => ({
      chunk_id: r.chunk_id,
      text: r.text,
      dense_vector: r.dense,
      subject: r.subject,
      source_id: r.source_id,
      source_name: r.source_name,
      chapter: r.chapter,
      page: r.page,
      created_at: r.created_at,
    })),
  });
  await milvus().flush({ collection_names: [collectionFor(learnerId)] });
}

export async function deleteBySource(sourceId: string, learnerId = currentLearnerId()): Promise<void> {
  await ensureCollection(learnerId);
  await milvus().delete({
    collection_name: collectionFor(learnerId),
    filter: `source_id == "${sourceId.replace(/"/g, '')}"`,
  });
}

export interface SearchHit {
  chunk_id: string;
  text: string;
  subject: string;
  source_id: string;
  source_name: string;
  chapter: string;
  page: number;
  score: number;
}

export async function hybridRecall(
  query: string,
  dense: number[],
  limit = 50,
  subject?: string,
  learnerId = currentLearnerId(),
): Promise<SearchHit[]> {
  try {
    await ensureCollection(learnerId);
    const expr = subject ? `subject == "${subject.replace(/"/g, '')}"` : undefined;
    const res = await milvus().search({
      collection_name: collectionFor(learnerId),
      data: [
        {
          anns_field: 'dense_vector',
          data: [dense],
          limit,
          params: { ef: 64 },
          ...(expr ? { expr } : {}),
        },
        {
          anns_field: 'sparse_vector',
          data: [query],
          limit,
          params: {},
          ...(expr ? { expr } : {}),
        },
      ],
      rerank: { strategy: 'rrf', params: { k: 60 } },
      limit,
      timeout: MILVUS_TIMEOUT_MS,
      output_fields: ['chunk_id', 'text', 'subject', 'source_id', 'source_name', 'chapter', 'page'],
    });

    const results = res.results ?? [];
    return (results as unknown as Record<string, unknown>[]).map((row) => ({
      chunk_id: String(row.chunk_id ?? ''),
      text: String(row.text ?? ''),
      subject: String(row.subject ?? ''),
      source_id: String(row.source_id ?? ''),
      source_name: String(row.source_name ?? ''),
      chapter: String(row.chapter ?? ''),
      page: Number(row.page ?? 0),
      score: Number(row.score ?? 0),
    }));
  } catch (error) {
    if (error instanceof RagCallError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RagCallError('MILVUS_UNAVAILABLE', `向量检索不可用：${message}`, true);
  }
}