import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const dataDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(resolve(dataDir, 'edu.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    subject TEXT,
    tags TEXT,
    status TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
    chunk_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    chapter TEXT,
    page INTEGER,
    char_count INTEGER NOT NULL,
    indexed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (document_id) REFERENCES documents(document_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);
`);

export interface DocumentRow {
  document_id: string;
  filename: string;
  file_type: string;
  size: number;
  hash: string;
  subject: string | null;
  tags: string | null;
  status: string;
  chunk_count: number;
  error: string | null;
  created_at: number;
}

export interface ChunkRow {
  chunk_id: string;
  document_id: string;
  seq: number;
  text: string;
  chapter: string | null;
  page: number | null;
  char_count: number;
  indexed: number;
}

export function insertDocument(row: Omit<DocumentRow, 'created_at'>): void {
  db.prepare(
    `INSERT INTO documents (document_id, filename, file_type, size, hash, subject, tags, status, chunk_count, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.document_id,
    row.filename,
    row.file_type,
    row.size,
    row.hash,
    row.subject,
    row.tags,
    row.status,
    row.chunk_count,
    row.error,
    Date.now(),
  );
}

export function insertChunks(chunks: Omit<ChunkRow, 'indexed'>[]): void {
  const stmt = db.prepare(
    `INSERT INTO chunks (chunk_id, document_id, seq, text, chapter, page, char_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of chunks) {
    stmt.run(c.chunk_id, c.document_id, c.seq, c.text, c.chapter, c.page, c.char_count);
  }
}

export function findDocumentByHash(hash: string): DocumentRow | undefined {
  return db.prepare('SELECT * FROM documents WHERE hash = ?').get(hash) as DocumentRow | undefined;
}

export function getDocument(id: string): DocumentRow | undefined {
  return db.prepare('SELECT * FROM documents WHERE document_id = ?').get(id) as DocumentRow | undefined;
}

export function listDocuments(): DocumentRow[] {
  return db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all() as unknown as DocumentRow[];
}

export function listChunks(documentId: string): ChunkRow[] {
  return db
    .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY seq')
    .all(documentId) as unknown as ChunkRow[];
}

export function updateDocument(
  id: string,
  patch: { status?: string; chunk_count?: number; error?: string | null },
): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE document_id = ?`).run(...values);
}

export function deleteDocument(id: string): void {
  db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM documents WHERE document_id = ?').run(id);
}

export function markChunksIndexed(documentId: string): void {
  db.prepare('UPDATE chunks SET indexed = 1 WHERE document_id = ?').run(documentId);
}

export function dbPath(): string {
  return resolve(dataDir, 'edu.db');
}

export { dirname };