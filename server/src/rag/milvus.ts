import { DataType, MetricType, MilvusClient } from '@zilliz/milvus2-sdk-node';

export const COLLECTION = 'edu_chunks';
export const DIM = 1024;

let client: MilvusClient | null = null;
export function milvus(): MilvusClient {
  if (!client) {
    client = new MilvusClient({ address: process.env.MILVUS_ADDRESS ?? 'localhost:19530' });
  }
  return client;
}

let ensured: Promise<void> | null = null;

export function ensureCollection(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const c = milvus();
      const exists = await c.hasCollection({ collection_name: COLLECTION });
      if (exists.value) return;
      await c.createCollection({
        collection_name: COLLECTION,
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
      await c.loadCollection({ collection_name: COLLECTION });
    })().catch((e) => {
      ensured = null;
      throw e;
    });
  }
  return ensured;
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

export async function insertVectors(rows: ChunkVector[]): Promise<void> {
  if (rows.length === 0) return;
  await ensureCollection();
  await milvus().insert({
    collection_name: COLLECTION,
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
  await milvus().flush({ collection_names: [COLLECTION] });
}

export async function deleteBySource(sourceId: string): Promise<void> {
  await ensureCollection();
  await milvus().delete({
    collection_name: COLLECTION,
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

export async function hybridRecall(query: string, dense: number[], limit = 50, subject?: string): Promise<SearchHit[]> {
  await ensureCollection();
  const expr = subject ? `subject == "${subject.replace(/"/g, '')}"` : undefined;
  const res = await milvus().search({
    collection_name: COLLECTION,
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
}