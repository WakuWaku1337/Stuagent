import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { currentLearnerId } from './learning/context.ts';

const dataDir = process.env.EDU_DATA_DIR?.trim()
  ? resolve(process.env.EDU_DATA_DIR)
  : resolve(fileURLToPath(new URL('.', import.meta.url)), '../data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(resolve(dataDir, 'edu.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL DEFAULT 'default',
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    subject TEXT,
    tags TEXT,
    source_path TEXT,
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

  CREATE TABLE IF NOT EXISTS learners (
    learner_id TEXT PRIMARY KEY,
    name TEXT,
    grade TEXT,
    subjects TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memories (
    memory_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memories_learner ON memories(learner_id);

  CREATE TABLE IF NOT EXISTS questions (
    question_id TEXT PRIMARY KEY,
    bank_id TEXT NOT NULL,
    learner_id TEXT NOT NULL DEFAULT 'default',
    subject TEXT,
    knowledge_point TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    content TEXT NOT NULL,
    options TEXT NOT NULL,
    answer TEXT NOT NULL,
    explanation TEXT,
    source TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id);

  CREATE TABLE IF NOT EXISTS wrong_records (
    record_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    question_snapshot TEXT NOT NULL,
    student_answer TEXT,
    reason TEXT,
    review_count INTEGER NOT NULL DEFAULT 0,
    ease REAL NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    next_review INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_review INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_wrong_due ON wrong_records(learner_id, next_review);

  CREATE TABLE IF NOT EXISTS mastery (
    learner_id TEXT NOT NULL,
    knowledge_point TEXT NOT NULL,
    probability REAL NOT NULL,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (learner_id, knowledge_point)
  );

  CREATE TABLE IF NOT EXISTS quiz_sessions (
    session_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    subject TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    score REAL,
    duration_min INTEGER,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    question_ids TEXT
  );

  CREATE TABLE IF NOT EXISTS quiz_answers (
    answer_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    student_answer TEXT,
    is_correct INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_answers_session ON quiz_answers(session_id);

  CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL DEFAULT 'default',
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    result TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);

  CREATE TABLE IF NOT EXISTS exam_papers (
    exam_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    subject TEXT,
    exam_date TEXT,
    total_score REAL,
    my_score REAL,
    duration INTEGER,
    source TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exam_questions (
    exam_question_id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    question_no INTEGER NOT NULL,
    question_type TEXT,
    full_score REAL,
    got_score REAL,
    is_correct INTEGER,
    student_answer TEXT,
    correct_answer TEXT,
    error_reason TEXT,
    knowledge_point TEXT,
    content TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_exam_questions ON exam_questions(exam_id);

  CREATE TABLE IF NOT EXISTS exam_reviews (
    review_id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    summary TEXT,
    loss_analysis TEXT,
    suggestions TEXT,
    report TEXT,
    generated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS courseware (
    courseware_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    subject TEXT,
    html TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS model_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    base_url TEXT NOT NULL,
    reasoning TEXT NOT NULL DEFAULT 'medium',
    temperature REAL NOT NULL DEFAULT 0.5,
    top_p REAL NOT NULL DEFAULT 0.95,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    context_length INTEGER NOT NULL DEFAULT 131072,
    scenario_params TEXT NOT NULL DEFAULT '{}',
    monthly_budget REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_keys (
    key_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    label TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    hint TEXT NOT NULL,
    fail_count INTEGER NOT NULL DEFAULT 0,
    cooldown_until INTEGER,
    last_error TEXT,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_provider_keys ON provider_keys(provider);

  CREATE TABLE IF NOT EXISTS usage_records (
    usage_id TEXT PRIMARY KEY,
    learner_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    scenario TEXT NOT NULL,
    subject TEXT,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    success INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    key_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_scenario ON usage_records(scenario, created_at);

  CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    title_auto INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conversations_learner ON conversations(learner_id, updated_at);

  CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    msg_type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    attachments TEXT,
    agent TEXT,
    citations TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS media (
    media_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL DEFAULT 'default',
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_hash ON media(hash);

  CREATE TABLE IF NOT EXISTS storage_cleanups (
    cleanup_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    media_removed INTEGER NOT NULL DEFAULT 0,
    files_removed INTEGER NOT NULL DEFAULT 0,
    bytes_freed INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_storage_cleanups_created ON storage_cleanups(created_at);

  CREATE TABLE IF NOT EXISTS learning_plans (
    plan_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    subjects TEXT,
    start_date TEXT NOT NULL,
    days INTEGER NOT NULL,
    daily_minutes INTEGER NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_learning_plans_learner ON learning_plans(learner_id, status, updated_at);

  CREATE TABLE IF NOT EXISTS daily_practices (
    date TEXT NOT NULL,
    learner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    score REAL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER,
    PRIMARY KEY (learner_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_practices_learner ON daily_practices(learner_id, date);

  CREATE TABLE IF NOT EXISTS mcp_servers (
    server_id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL,
    command TEXT,
    args TEXT,
    url TEXT,
    secrets TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    exposure TEXT NOT NULL DEFAULT 'direct',
    status TEXT NOT NULL DEFAULT 'unknown',
    last_error TEXT,
    tools TEXT,
    enabled_tools TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visualizations (
    visualization_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL DEFAULT 'default',
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    spec TEXT NOT NULL,
    source TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ocr_jobs (
    document_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL DEFAULT 'default',
    engine TEXT NOT NULL,
    status TEXT NOT NULL,
    total_pages INTEGER NOT NULL DEFAULT 0,
    done_pages INTEGER NOT NULL DEFAULT 0,
    low_confidence INTEGER NOT NULL DEFAULT 0,
    failed_pages INTEGER NOT NULL DEFAULT 0,
    current_page INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ocr_pages (
    document_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    status TEXT NOT NULL,
    engine TEXT,
    markdown TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    image_file TEXT,
    width INTEGER,
    height INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (document_id, page)
  );
  CREATE INDEX IF NOT EXISTS idx_ocr_pages_status ON ocr_pages(document_id, status);

  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_norm TEXT NOT NULL UNIQUE,
    phone TEXT,
    email TEXT,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    last_login_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    absolute_expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

  CREATE TABLE IF NOT EXISTS auth_events (
    event_id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    result TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events(created_at);

  CREATE TABLE IF NOT EXISTS embedding_cache (
    cache_key TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    vector TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_embedding_cache_created ON embedding_cache(created_at);

  CREATE TABLE IF NOT EXISTS answer_cache (
    cache_key TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    answer TEXT NOT NULL,
    citations TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_answer_cache_learner ON answer_cache(learner_id, created_at);
`);

const sessionCols = db.prepare('PRAGMA table_info(quiz_sessions)').all() as unknown as { name: string }[];
if (!sessionCols.some((c) => c.name === 'question_ids')) {
  db.exec('ALTER TABLE quiz_sessions ADD COLUMN question_ids TEXT');
}

const documentCols = db.prepare('PRAGMA table_info(documents)').all() as unknown as { name: string }[];
if (!documentCols.some((c) => c.name === 'source_path')) {
  db.exec('ALTER TABLE documents ADD COLUMN source_path TEXT');
}

const messageCols = db.prepare('PRAGMA table_info(messages)').all() as unknown as { name: string }[];
if (!messageCols.some((c) => c.name === 'visualization_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN visualization_id TEXT');
}

function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  return cols.some((c) => c.name === column);
}

for (const table of ['documents', 'questions', 'exam_papers', 'courseware', 'media', 'visualizations', 'tasks', 'ocr_jobs']) {
  if (!hasColumn(table, 'learner_id')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN learner_id TEXT NOT NULL DEFAULT 'default'`);
  }
}

db.exec(`
  UPDATE visualizations SET learner_id = '__global__' WHERE visualization_id LIKE 'preset:%';
  UPDATE documents SET hash = learner_id || ':' || hash WHERE instr(hash, ':') = 0;
  UPDATE media SET hash = learner_id || ':' || hash WHERE instr(hash, ':') = 0;
  CREATE INDEX IF NOT EXISTS idx_documents_learner ON documents(learner_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_questions_learner ON questions(learner_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_learner ON tasks(learner_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_exam_papers_learner ON exam_papers(learner_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_courseware_learner ON courseware(learner_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_media_learner ON media(learner_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_visualizations_learner ON visualizations(learner_id, created_at);
`);

const dailyCols = db.prepare('PRAGMA table_info(daily_practices)').all() as unknown as { name: string; pk: number }[];
const dailyPk = dailyCols.filter((c) => c.pk > 0).map((c) => c.name);
if (dailyPk.length === 1 && dailyPk[0] === 'date') {
  db.exec(`
    BEGIN;
    CREATE TABLE daily_practices_new (
      date TEXT NOT NULL,
      learner_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL,
      score REAL,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      PRIMARY KEY (learner_id, date)
    );
    INSERT INTO daily_practices_new (date, learner_id, session_id, total, status, score, created_at, finished_at)
      SELECT date, learner_id, session_id, total, status, score, created_at, finished_at FROM daily_practices;
    DROP TABLE daily_practices;
    ALTER TABLE daily_practices_new RENAME TO daily_practices;
    CREATE INDEX IF NOT EXISTS idx_daily_practices_learner ON daily_practices(learner_id, date);
    COMMIT;
  `);
}

export interface DocumentRow {
  document_id: string;
  learner_id: string;
  filename: string;
  file_type: string;
  size: number;
  hash: string;
  subject: string | null;
  tags: string | null;
  source_path: string | null;
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

export interface OcrJobRow {
  document_id: string;
  learner_id: string;
  engine: string;
  status: string;
  total_pages: number;
  done_pages: number;
  low_confidence: number;
  failed_pages: number;
  current_page: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface OcrPageRow {
  document_id: string;
  page: number;
  status: string;
  engine: string | null;
  markdown: string;
  confidence: number;
  image_file: string | null;
  width: number | null;
  height: number | null;
  updated_at: number;
}

export function insertDocument(row: Omit<DocumentRow, 'created_at'>): void {
  db.prepare(
    `INSERT INTO documents (document_id, learner_id, filename, file_type, size, hash, subject, tags, source_path, status, chunk_count, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.document_id,
    row.learner_id,
    row.filename,
    row.file_type,
    row.size,
    row.hash,
    row.subject,
    row.tags,
    row.source_path,
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

export function findDocumentByHash(hash: string, learnerId = currentLearnerId()): DocumentRow | undefined {
  return db
    .prepare('SELECT * FROM documents WHERE hash = ? AND learner_id = ?')
    .get(hash, learnerId) as unknown as DocumentRow | undefined;
}

export function getDocument(id: string, learnerId = currentLearnerId()): DocumentRow | undefined {
  return db
    .prepare('SELECT * FROM documents WHERE document_id = ? AND learner_id = ?')
    .get(id, learnerId) as unknown as DocumentRow | undefined;
}

export function listDocuments(learnerId = currentLearnerId()): DocumentRow[] {
  return db
    .prepare('SELECT * FROM documents WHERE learner_id = ? ORDER BY created_at DESC')
    .all(learnerId) as unknown as DocumentRow[];
}

export function listChunks(documentId: string, learnerId = currentLearnerId()): ChunkRow[] {
  return db
    .prepare(
      `SELECT c.* FROM chunks c JOIN documents d ON d.document_id = c.document_id
       WHERE c.document_id = ? AND d.learner_id = ? ORDER BY c.seq`,
    )
    .all(documentId, learnerId) as unknown as ChunkRow[];
}

export function updateDocument(
  id: string,
  patch: { status?: string; chunk_count?: number; error?: string | null },
  learnerId = currentLearnerId(),
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
  values.push(id, learnerId);
  db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE document_id = ? AND learner_id = ?`).run(...values);
}

export function deleteDocument(id: string, learnerId = currentLearnerId()): void {
  if (!getDocument(id, learnerId)) return;
  db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM documents WHERE document_id = ? AND learner_id = ?').run(id, learnerId);
  db.prepare('DELETE FROM ocr_pages WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM ocr_jobs WHERE document_id = ?').run(id);
}

export function getOcrJob(documentId: string): OcrJobRow | undefined {
  return db.prepare('SELECT * FROM ocr_jobs WHERE document_id = ?').get(documentId) as unknown as
    | OcrJobRow
    | undefined;
}

export function listOcrJobs(statuses: string[]): OcrJobRow[] {
  const placeholders = statuses.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM ocr_jobs WHERE status IN (${placeholders})`)
    .all(...statuses) as unknown as OcrJobRow[];
}

export function saveOcrJob(row: Omit<OcrJobRow, 'created_at' | 'updated_at'> & { created_at?: number }): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO ocr_jobs (document_id, learner_id, engine, status, total_pages, done_pages, low_confidence, failed_pages, current_page, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET
       engine = excluded.engine, status = excluded.status, total_pages = excluded.total_pages,
       done_pages = excluded.done_pages, low_confidence = excluded.low_confidence,
       failed_pages = excluded.failed_pages, current_page = excluded.current_page,
       error = excluded.error, updated_at = excluded.updated_at`,
  ).run(
    row.document_id,
    row.learner_id,
    row.engine,
    row.status,
    row.total_pages,
    row.done_pages,
    row.low_confidence,
    row.failed_pages,
    row.current_page,
    row.error,
    row.created_at ?? now,
    now,
  );
}

export function listOcrPages(documentId: string): OcrPageRow[] {
  return db
    .prepare('SELECT * FROM ocr_pages WHERE document_id = ? ORDER BY page')
    .all(documentId) as unknown as OcrPageRow[];
}

export function getOcrPage(documentId: string, page: number): OcrPageRow | undefined {
  return db
    .prepare('SELECT * FROM ocr_pages WHERE document_id = ? AND page = ?')
    .get(documentId, page) as unknown as OcrPageRow | undefined;
}

export function saveOcrPage(row: Omit<OcrPageRow, 'updated_at'>): void {
  db.prepare(
    `INSERT INTO ocr_pages (document_id, page, status, engine, markdown, confidence, image_file, width, height, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_id, page) DO UPDATE SET
       status = excluded.status, engine = excluded.engine, markdown = excluded.markdown,
       confidence = excluded.confidence, image_file = excluded.image_file,
       width = excluded.width, height = excluded.height, updated_at = excluded.updated_at`,
  ).run(
    row.document_id,
    row.page,
    row.status,
    row.engine,
    row.markdown,
    row.confidence,
    row.image_file,
    row.width,
    row.height,
    Date.now(),
  );
}

export function clearOcrPages(documentId: string): void {
  db.prepare('DELETE FROM ocr_pages WHERE document_id = ?').run(documentId);
}

export function markChunksIndexed(documentId: string): void {
  db.prepare('UPDATE chunks SET indexed = 1 WHERE document_id = ?').run(documentId);
}

export function dbPath(): string {
  return resolve(dataDir, 'edu.db');
}

export { dirname };