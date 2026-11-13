# 智学 Agent（EduPi）

面向高中生的本地优先 AI 学习智能体。以 Pi Coding Agent 为内核，Node（Hono）提供 API 与 SSE，Vue3 提供学习台；默认单实例部署，支持多账号注册与按账号隔离学习数据。

- 设计文档：[智学Agent项目设计文档.md](./智学Agent项目设计文档.md)
- 实施进度：[PROGRESS.md](./PROGRESS.md)
- Agent 配置：[AGENTS.md](./AGENTS.md) 与 `docs/agents/`

## 能做什么

- **资料问答（RAG）**：上传 PDF / Word / TXT / Markdown，混合检索 + RRF + Cross-Encoder 精排，回答带教材引用。
- **对话与引导解题**：Tutor / Quizzer / Analyst / Solver 四个角色，SSE 流式输出，支持拍照/图片问答、语音输入与朗读、回复截断续写。
- **记忆与诊断**：长期记忆、学习者画像、BKT 掌握度、薄弱点推荐。
- **出题与练习**：按知识点出题、按掌握度校准难度、每日练习、模拟考试、错题本与 SM-2 复习。
- **考试复盘**：整卷识别、逐题判分、错因归类、趋势对比与复盘报告。
- **统一可视化**：9 种类型全部使用 VizPlan v2 严格语义场景；函数/圆锥曲线由项目内 SVG 渲染，立体几何/分子/地形/生物/物理由各自渲染器读取已校验 scene；预置模板直接保存 v2，另有像素基线 CI。
- **MCP 扩展**：接入 stdio / HTTP / SSE MCP 服务，工具发现后按服务授权给子智能体。
- **账号与隔离**：注册登录、会话管理、管理员账号页；每个账号独立拥有资料、对话、错题、媒体、任务与 RAG collection。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 内核 | Pi Coding Agent |
| 后端 | Node.js 24 + TypeScript + Hono + SSE + WebSocket |
| 前端 | Vue3 + Vite + TypeScript + Element Plus + ECharts + KaTeX |
| 数据 | SQLite（`node:sqlite`）+ 本地文件 |
| 检索 | Milvus Standalone（Dense + 原生 BM25）→ RRF → Cross-Encoder |
| 文档解析 | pdfjs-dist、mammoth、word-extractor；扫描件走 Docling |
| 语音 | sherpa-onnx Paraformer（ASR）+ 浏览器/服务端 TTS |
| 可视化 | `GET/POST /api/visualize`、`GET/DELETE /api/visualize/:id`、`POST /api/visualize/generate`、`/api/courseware/:id` |

## 环境要求

- Node.js 24（`node:sqlite` 需要 Node ≥ 22.5）
- Docker Desktop（Milvus；扫描件 OCR 另需 docling-serve）
- 可选：Ollama（本地模型）、NVIDIA GPU（加速 Docling）
- 麦克风功能需在 `localhost` 或 HTTPS 下使用

## 快速开始

```bash
npm install

# 依赖服务
docker compose -f docker/docker-compose.yml up -d etcd milvus  # 仅启动 Milvus（19530）
npm run docling:up         # 可选：扫描件 OCR 服务（5001，CPU 镜像较大）
npm run docling:models     # 可选：下载 Docling 公式增强模型，默认不启用
npm run asr:model          # 可选：下载本地 ASR 模型（约 82MB，不入库）

# 首次初始化管理员
npm run auth:bootstrap

# 启动开发环境
npm run dev                # server 3000 + web 5173
```

浏览器打开 http://localhost:5173 登录。公开注册默认开放；关闭注册时可用 `npm run user:create` 建号。

> 首次管理员必须在本机创建；未初始化时注册接口返回 409，登录页会提示先运行 `npm run auth:bootstrap`。

## 账号与数据隔离

- 首个管理员 `user_id` 固定为 `default`，已有 `default` 数据自动归属该管理员。
- 公开注册默认开启；设置 `REGISTRATION_OPEN=0` 可关闭，关闭后只能由管理员建号。
- 密码长度 6–128 位；管理员重置密码后用户下次登录必须改密。
- 每个账号独立拥有：资料与切片、题库、对话、记忆、错题、掌握度、考试、计划、每日练习、媒体、可视化、后台任务与用量。
- 模型密钥、MCP、存储治理属于实例级资源，仅管理员可读写；普通用户不可见密钥。
- 管理员可在侧栏「账号管理」页建号、启停、改角色/联系方式、重置密码、查看审计与上线检查。
- 停用账号会立即撤销其全部会话；最后一名管理员不能停用或降级。
- RAG 按账号使用独立 Milvus collection；首个账号沿用旧 `edu_chunks` 以兼容已有向量。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 并行启动后端 3000 与前端 5173 |
| `npm run dev:server` / `npm run dev:web` | 只启动后端 / 只启动前端 |
| `npm run build` | 构建前端 `web/dist` |
| `npm run auth:bootstrap` | 创建首个管理员（仅首次） |
| `npm run user:create` | 管理员/CLI 建号 |
| `npm run auth:reset` | 重置指定账号密码 |
| `npm run auth:check` | 注册、登录、会话、重置密码、限流自检 |
| `npm run auth:isolation` | A/B 账号数据隔离自检 |
| `npm run auth:admin-check` | 管理端建号/停用/重置/最后管理员保护自检 |
| `npm run auth:migrate` | 账号迁移检查；`-- --reindex` 强制重建向量 |
| `npm run backup` | SQLite 备份到 `data/backups`；`-- --with-uploads` 同时备份 uploads |
| `npm run bench:s23` | RAG 冷/热延迟与缓存命中；`-- --chat` 测 TTFT/P95 |
| `npm run check:multiuser:all --workspace server` | 多用户回归：固定 key、会话锁、并发门限、缓存与维护清理 |
| `npm run milvus:up` / `down` / `health` | compose 整体启停与健康检查（会连带应用容器） |
| `npm run docling:up` / `down` / `models` | Docling 启停与模型下载 |
| `npm run asr:model` | 下载本地 ASR 模型 |

## 配置

配置放在 `server/.env`。SQLite、记忆镜像与课件镜像默认写入 `server/data`，上传文件写入 `server/uploads`。

### 模型与检索

| 变量 | 说明 |
| --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 对话模型（OpenAI 兼容或 Anthropic） |
| `EMBEDDING_MODEL` | Embedding 模型，默认 `text-embedding-v4` |
| `RERANK_MODEL` | Cross-Encoder 模型，默认 `gte-rerank-v2` |
| `LLM_OCR_MODEL` | 图片 OCR 兜底模型（默认复用当前 Provider 的视觉模型） |
| `LLM_VISION` | `0/1` 覆盖视觉能力判断 |
| `MILVUS_ADDRESS` | 默认 `localhost:19530` |
| `MILVUS_USERNAME` / `MILVUS_PASSWORD` / `MILVUS_TOKEN` | Milvus 认证；本地默认无认证，三者按部署实际填写 |
| `MILVUS_TIMEOUT_MS` | Milvus 调用超时，默认 15000 |
| `RAG_TOP_K` / `RAG_CANDIDATE_K` / `RAG_RECALL_LIMIT` | 检索条数、精排候选与召回上限，默认 5 / 30 / 50 |
| `RAG_TIMEOUT_MS` / `RAG_RETRY_MAX` | Embedding/Rerank 超时与重试，默认 15000 / 2 |
| `FAST_MODEL_ID` | 快模型 ID；仅用于 `routing` 等轻量场景，空=关闭 |
| `DOCLING_URL` | 默认 `http://localhost:5001` |
| `EDUPI_SETTINGS_SECRET` | 设置与模型密钥的加密主密钥；生产必须显式配置并备份 |
| `TTS_BASE_URL` / `TTS_API_KEY` / `TTS_MODEL` / `TTS_VOICE` | 服务端 TTS（OpenAI 兼容 `/audio/speech`）；前两项不配置时前端使用浏览器 `speechSynthesis`；`TTS_API_KEY` 缺省复用 `LLM_API_KEY`，`TTS_VOICE` 默认 `alloy` |

### 账号

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AUTH_ENABLED` | 1 | 关闭仅限隔离测试，生产禁止 |
| `REGISTRATION_OPEN` | 1 | 公开注册开关 |
| `REGISTER_MAX_PER_HOUR` | 10 | 每 IP 每小时注册上限 |
| `AUTH_BOOTSTRAP` | 0 | 允许本机首次注册成为管理员 |
| `BOOTSTRAP_LOCAL_ONLY` | 1 | 首个管理员仅连接层本机可创建；带转发头直接拒绝 |
| `CSRF_ENABLED` | 1 | 非幂等请求同源 Origin/Referer 校验 |
| `CSRF_ALLOWED_ORIGINS` | 空 | 额外可信来源白名单（逗号分隔） |
| `MCP_CONFIRM_SIDE_EFFECTS` | 1 | 副作用工具需在管理页确认后才可调用 |
| `DOCUMENT_PII_REDACT` | 0 | 切片前脱敏电话/邮箱等 PII；开启后引用不可回查原文 |
| `TRACE_LOG` | 0 | 输出带 `trace_id` 的链路日志，入参出参先脱敏 |
| `SESSION_TTL_DAYS` / `SESSION_ABSOLUTE_DAYS` | 7 / 30 | 会话空闲/绝对有效期 |
| `SESSION_MAX_PER_USER` | 10 | 单账号同时保留的有效会话数 |
| `COOKIE_SECURE` | auto | HTTPS 下设置 Secure Cookie |
| `TRUST_PROXY` | 1 | 信任反向代理转发头 |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_MIN` | 5 / 15 | 登录失败锁定 |
| `LOGIN_WINDOW_MIN` | 15 | 登录失败统计窗口（分钟） |
| `ANSWER_CACHE_TTL_MIN` | 60 | 精确答案缓存，0 关闭 |
| `RAG_CACHE_TTL_MIN` / `RAG_CACHE_THRESHOLD` / `RAG_CACHE_MAX` | 10 / 0.96 / 80 | 检索结果缓存 TTL、相似度阈值与条数上限 |
| `EMBEDDING_CACHE_DAYS` | 30 | embedding 缓存保留天数 |
| `CHAT_HISTORY_LIMIT` / `HISTORY_ITEM_MAX_CHARS` | 16 / 6000 | 回放历史条数与单条截断长度 |
| `RERANK_MIN_QUERY_CHARS` | 16 | 短查询跳过 Cross-Encoder |
| `ROUTE_LLM_MIN_CHARS` | 24 | 短问题跳过路由模型 |

### 有界自主与容错

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AGENT_MAX_TOOL_STEPS` | 10 | 单次对话工具调用步数上限，0=不限 |
| `AGENT_WALL_CLOCK_MS` | 180000 | 单次对话墙钟上限，0=不限 |
| `AGENT_TOKEN_BUDGET` | 0 | token 预算，0=不限 |
| `TASK_TIMEOUT_MS` | 180000 | 后台任务 watchdog 超时 |
| `TASK_RETRY_MAX` | 3 | 后台任务失败重试次数 |
| `DAILY_PRACTICE_COUNT` | 5 | 每日练习题目数，夹取 3–10 |
| `LLM_KEY_MAX_ATTEMPTS` | 3 | 单次请求最多轮换的密钥数；同一会话正常路径固定一个 key |
| `AGENT_SESSION_MAX` / `AGENT_SESSION_TTL_MIN` | 300 / 60 | Pi 会话缓存条数上限与空闲过期分钟数，0=不限制 |
| `AGENT_MAX_CONCURRENT` / `AGENT_MAX_CONCURRENT_PER_USER` | 6 / 2 | 聊天全局/单用户并发上限，0=不限制 |
| `AGENT_QUEUE_WAIT_MS` | 15000 | 全局并发满时的最长排队时间，超时返回 429 |
| `MAINTENANCE_INTERVAL_HOURS` | 6 | 运行时表清理周期，0=关闭 |
| `IDEMPOTENCY_RETENTION_HOURS` / `TASK_RETENTION_DAYS` | 24 / 30 | 幂等记录与已结束任务保留时间 |
| `TTS_DEFAULT_VOLUME` | 1 | TTS 默认音量 0–1；客户端应用参数，服务端仅校验与回显，不送入 /audio/speech（OpenAI 兼容接口无标准音量参数），实际音量由浏览器 Audio.volume / SpeechSynthesisUtterance.volume 应用 |
| `SSE_RETRY_MAX`（前端 `VITE_SSE_RETRY_MAX`） | 2 | 前端 SSE 未收到任何事件时的重连次数，0=关闭 |
| `EVAL_ENABLE_ADVANCED` | 0 | 输出 Precision@K / nDCG@K 等高级评测指标 |

### 存储与扫描件

| 变量 | 说明 |
| --- | --- |
| `EDU_DATA_DIR` / `EDU_UPLOADS_DIR` | 数据目录与上传目录 |
| `STORAGE_QUOTA_MB` / `STORAGE_RETENTION_DAYS` / `STORAGE_CLEANUP_HOURS` | 存储配额（默认 1024MB）、保留天数（30）与孤儿清理周期（24h） |
| `MCP_ALLOWED_HOSTS` | 远程 MCP 主机白名单（逗号分隔，支持 `*.example.com`）；空=不限制，仅允许 http/https |
| `OCR_ENGINE` | 应用侧 OCR 路径：`auto` / `docling` / `docling+vision` / `vision`，默认 `auto` |
| `OCR_TIMEOUT_MS` | 单篇 OCR 超时，默认 180000（夹取 30–600 秒） |
| `DOCLING_OCR_ENGINE` | 仅透传给 docling-serve 的 `ocr_engine` 字段（默认 `auto`），**不是**应用侧模式开关 |
| `DOCLING_TIMEOUT_MS` / `DOCLING_POLL_MS` | Docling 转换超时（默认 30 分钟）与轮询间隔（默认 1500ms） |
| `DOCLING_FORMULA_ENRICHMENT` | `1` 时启用 Docling 公式 LaTeX（CPU 很慢，默认关闭） |
| `OCR_CONFIDENCE_THRESHOLD` | 待校对阈值，默认 0.8 |
| `OCR_VISION_FORMULA_MIN_MARKERS` | 公式占位达到该数量的页面走视觉增强，默认 10，0 关闭 |
| `OCR_DPI` | 扫描页渲染 DPI，默认 200 |

### 实现口径说明（v0.31）

- **CSRF / 本机 bootstrap**：`server/src/auth/csrf.ts` 挂在 `/api/*`，非幂等请求校验 Origin/Referer；首个管理员用连接层 loopback 判定，带转发头直接拒绝；启用 `BOOTSTRAP_LOCAL_ONLY=0` 可关闭。
- **MCP 配置期确认**：无 `readOnlyHint` 即视为副作用，未确认返回 `MCP_CONFIRMATION_REQUIRED`；升级时对存量已授权工具执行 `node --import jiti/register scripts/migrate-mcp-confirmations.ts`（默认 dry-run，核对清单后加 `--apply`）。
- **SSE 幂等重发**：前端每次发送生成 `clientRequestId`，重发复用；服务端 `server/src/chat/idempotency.ts` 按 `(learner_id, clientRequestId)` 去重，命中已完成记录直接重放，处理中返回 409；去重窗口 5 分钟。
- **有界自主**：`server/src/pi.ts` 用 SDK 事件 `tool_execution_start`（已在 `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts` 核实）计数实现 `AGENT_MAX_TOOL_STEPS=10`，配合 `AGENT_WALL_CLOCK_MS`、`AGENT_TOKEN_BUDGET` 与 `incomplete` 人工接管点。
- **检索容错**：`server/src/rag/resilience.ts` 提供显式超时 + 指数退避抖动重试；Milvus 客户端带 `timeout`/`maxRetries`；rerank 失败降级 RRF 粗排。
- **后台任务**：`server/src/tasks/queue.ts` watchdog 用 `AbortController` 真正中止，`signal` 已贯穿 quiz 与 analysis；`TASK_RETRY_MAX` 控制失败重试（指数退避 + 抖动）。
- **可观测范围**：`trace_id` 进入 SSE 事件、`usage_records.trace_id` 与可选 stdout（`TRACE_LOG=1`，入参出参脱敏）；**无独立 span/链路存储、无跨服务传播、无可视化查询**。
- **错误响应**：新增与关键路径返回 `{code, error, message}` 双写；历史校验分支仍为 `{ error }` 单写，前端统一按 `error ?? message` 兼容。
- **多用户错误码**：同会话并发生成返回 `409 CONVERSATION_BUSY`；单用户或全局并发超限返回 `429 CHAT_BUSY`（全局满时先按 `AGENT_QUEUE_WAIT_MS` 排队）。
- **评测口径**：`eval-rag.ts` 已实现 Hit@1/3/5、Recall@5、MRR、P50/P95 及高级指标 Precision@5、nDCG@5、引用命中率(Citation Precision@5)；`引用正确率` 为答案级判定，缺 `expected_citations` 与生成答案标注时输出「不可计算」，有标注时仅输出**检索级代理**并明确标注；标注缺失不算失败（退出码 0）。四方案离线对比未实现。
- **工程配置**：`server/tsconfig.json` 启用 `allowImportingTsExtensions`（仓库全部使用 `.ts` 后缀导入，避免 TS5097），`noEmit: true` 必须保留；仅影响 `npx tsc --noEmit` 门禁，运行时由 jiti 加载不受影响。
- **连接池**：依赖 Node 原生 fetch 的 undici keep-alive 默认行为，未引入显式连接池；工具并行调用未实现。

### 多用户运行护栏（v0.32）

- **单实例约束**：默认形态是一个 Node 进程 + 一个 SQLite 文件；不要让多个应用容器共享同一个 `app_data` 卷。SQLite 已设 WAL 与 `busy_timeout=5000`，但不等同于多写实例。
- **会话固定 Key**：同一 `learner_id + conversation_id + role` 正常路径固定一个 provider key；只有调用失败才切换，并用数据库历史重建 session，避免多 key 轮换导致上下文跳变。
- **会话互斥**：同一会话同时只允许一个生成任务；第二个请求返回 `409 CONVERSATION_BUSY`，且不会写入第二条用户消息。
- **并发门限**：`AGENT_MAX_CONCURRENT`（全局，默认 6）与 `AGENT_MAX_CONCURRENT_PER_USER`（单用户，默认 2）；超限返回 `429 CHAT_BUSY`，全局满时最多排队 `AGENT_QUEUE_WAIT_MS`。
- **缓存上限**：Pi `AgentSession` 使用 LRU + 空闲 TTL（默认 300 条 / 60 分钟），避免长期运行内存无界增长。
- **周期清理**：`MAINTENANCE_INTERVAL_HOURS=6` 清理过期 `chat_idempotency`、`answer_cache` 与已结束 `tasks`。
- **容器运维护栏**：compose 带 `/health` healthcheck 与 json-file 日志轮转；Nginx 上传上限 210m，与应用 200MB 单批限制对齐。
- **生产建议**：多用户公网部署设 `REGISTRATION_OPEN=0`，由管理员建号；`.env` 权限 600，并单独备份 `EDUPI_SETTINGS_SECRET`。

## 数据与检索

- 文档切片保留章节路径与页码，引用可回查原文；扫描件由 Docling 输出逐页 Markdown，低置信/公式密集页可用视觉模型增强。
- 开启 `DOCUMENT_PII_REDACT=1` 时切片只保留脱敏文本，引用将无法回查原文；默认关闭。
- 扫描件异步执行，资料库显示进度；低置信页面提供原文图与 Markdown 对照校对，校对后重新切片入库。
- 每个账号的向量写入独立 Milvus collection；资料、媒体、任务事件与用量都按账号隔离。
- 长期记忆同时镜像到 `data/memory/<learner_id>/`；旧版单文件 HTML 课件保留只读兼容。
- Markdown 渲染先保护 `$...$`/`$$...$$` 再交给 marked，分段函数与 `\\[2pt]` 不再被 Markdown 转义；表达式统一由 `shared/expression.ts` 编译，函数复合与 cases 分段可绘制。
- 上传限制：单文件 50MB、单次最多 50 个文件、单次总大小 200MB；前端提前校验，后端唯一来源为 `server/src/documents/limits.ts`。上传界面只显示状态与 OCR 进度，不显示浏览器上传进度条。
- MCP 密钥边界：`server/data/pi-agent/mcp.json` 只同步命令/URL/工具开关，不写解密后的 env/headers；实际调用由服务端从加密 DB 解密后建立连接。数据库加密不等于所有落盘副本都加密。

## 主要 API

> 下表为主要 API 摘要，非完整清单；完整路由以 `server/src/routes` 为准。

| 分组 | 路径 |
| --- | --- |
| 认证 | `POST /api/auth/register`、`login`、`logout`；`GET /api/auth/me`；`PUT /api/auth/password`；`GET /api/auth/sessions` |
| 管理 | `/api/admin/users`、`/api/admin/users/:id`、`/reset-password`、`/api/admin/audit`、`/api/admin/system-check` |
| 对话 | `POST /api/chat`（支持可选 `clientRequestId` 幂等键）；`POST /api/conversations/:id/messages`；`GET/POST /api/conversations` |
| 资料 | `POST/GET /api/documents`、`POST /api/documents/batch`、`/api/documents/:id`；OCR：`GET /api/documents/:id/ocr`、`GET .../ocr/pages/:page/image`、`PUT .../ocr/pages/:page`、`POST .../ocr/confirm`、`POST .../ocr/retry`；`/reparse`、`/index`；`POST /api/knowledge/search` |
| 学习 | `/api/quiz/*`、`/api/wrongbook/*`、`/api/mastery`、`/api/memory/*`、`/api/plan/*`、`/api/daily/*` |
| 考试 | `POST /api/reviews/recognize`、`/api/reviews/:id/analyze`；`GET /api/reviews`、`/compare` |
| 媒体/语音 | `/api/media/upload`、`/api/media/:id`、`/api/media/storage`、`/api/asr`、`/api/tts` |
| 可视化 | `GET/POST /api/visualize`、`GET/DELETE /api/visualize/:id`、`POST /api/visualize/generate`、`/api/courseware/:id` |
| MCP | `/api/mcp/servers`、`/api/mcp/tools`、`/api/mcp/servers/:id/test`；工具启停 `PUT /api/mcp/servers/:id/tools/:toolName`；副作用确认 `POST .../tools/:toolName/confirm` |
| 设置/用量 | `/api/settings/model`、`/api/settings/generation`、`/api/settings/keys`、`/api/settings/*`；`/api/usage/summary`、`/daily`、`/cost`、`/export` |
| 任务 | `POST/GET /api/tasks`、`/api/tasks/:id`、`POST /api/tasks/:id/cancel`；WebSocket `/ws` |

> 可视化：`/api/visualize/generate` 的所有类型均返回 VizPlan v2（`schema_version=2`），并由 `shared/viz/schema.ts` 做严格场景校验；无法从题目建模时返回 422 `VIZ_UNSUPPORTED_STRUCTURE` 与 diagnostics，不再回退到模型手写 spec。

## 页面

`/` 学习台、`/plan` 学习计划、`/chat` 对话、`/documents` 资料库、`/quiz` 智能出题、`/wrongbook` 错题本、`/mastery` 掌握度、`/exam` 模拟考试、`/tasks` 后台任务、`/review` 考试复盘、`/visualize` 统一可视化、`/settings` 模型设置、`/usage` 用量统计、`/storage` 存储治理、`/mcp` MCP 扩展、`/admin` 账号管理、`/account` 账号设置、`/privacy` 隐私政策、`/terms` 用户协议。

> `/privacy` 与 `/terms` 当前为占位页，正文与联系方式待运营方提供（上线阻断项）。

## 本次整改新增模块

- `server/src/config.ts`
- `server/src/auth/csrf.ts`
- `server/src/trace.ts`
- `server/src/rag/resilience.ts`
- `server/src/chat/idempotency.ts`
- `server/src/mcp/backfill.ts`
- `server/scripts/lib/same-origin-fetch.ts`
- `server/scripts/check-resilience.ts`
- `server/scripts/check-sse-idempotency.ts`
- `server/scripts/check-config-keys.ts`
- `server/scripts/migrate-mcp-confirmations.ts`
- `server/src/documents/limits.ts`
- `server/scripts/check-exam-isolation.ts`
- `server/scripts/check-api-docs.ts`
- `server/scripts/check-docs.ts`
- `server/scripts/repair-exam-question-owner.ts`
- `shared/expression.ts`
- `web/src/utils/math.ts`
- `server/scripts/check-markdown-math.ts`
- `web/src/views/PrivacyView.vue`
- `web/src/views/TermsView.vue`

## 验证

```bash
cd server
node --import jiti/register scripts/regression.ts          # 全流程回归
node --import jiti/register scripts/check-auth.ts          # 认证
node --import jiti/register scripts/check-isolation.ts     # 多账号隔离
node --import jiti/register scripts/check-admin.ts         # 管理端
node --import jiti/register scripts/eval-rag.ts            # RAG 检索指标与延迟
node --import jiti/register scripts/check-docling.ts       # Docling 解析
node --import jiti/register scripts/check-ocr.ts           # 扫描件 OCR 与校对
node --import jiti/register scripts/check-visualize.ts     # 可视化建模
npm run check:viz                                          # VizPlan v2 / SVG 编译 / 像素快照回归
npm run check:viz:snapshots --workspace server -- --update # 更新像素基线
npm run migrate:viz                                        # v1 → v2 可视化 dry-run（加 --apply 写库；支持 --limit/--batch-size/--strict-input）
node --import jiti/register scripts/check-security.ts      # PII / 注入 / 切片脱敏
node --import jiti/register scripts/check-mcp.ts           # MCP 授权与副作用确认
node --import jiti/register scripts/check-sse-idempotency.ts  # SSE 幂等
node --import jiti/register scripts/check-config-keys.ts      # 配置键三方一致（全 src 扫描）
node --import jiti/register scripts/check-api-docs.ts         # 关键路由与 README 同步
node --import jiti/register scripts/check-exam-isolation.ts   # 考试题库 A/B 隔离
node --import jiti/register scripts/check-docs.ts             # 文档口径一致性
node --import jiti/register scripts/check-markdown-math.ts   # Markdown/KaTeX 数学保护
node --import jiti/register scripts/check-resilience.ts       # 超时/重试/中止（含 quiz）
node --import jiti/register scripts/check-voice.ts         # ASR / TTS
```

对开启认证的服务运行回归时设置 `AUTH_USER` / `AUTH_PASSWORD`；隔离测试服务可用 `AUTH_ENABLED=0`。

MCP 存量授权回填：升级后执行 `node --import jiti/register scripts/migrate-mcp-confirmations.ts`（默认 dry-run，核对清单后加 `--apply`）。

## 生产与 Docker

```bash
npm run build
npm run dev:server        # 3000 同时托管 API 与 SPA
```

Docker：

```bash
docker compose -f docker/docker-compose.yml up -d --build
# 与 dev 的 3000 冲突时
APP_PORT=3100 docker compose -f docker/docker-compose.yml up -d edu-agent
```

- 应用、Milvus、Docling 可分开运行；Docling 通过 compose profile `docling` 启停。
- SQLite 与记忆/课件镜像放命名卷 `app_data`，上传文件挂载 `server/uploads`；不要把 SQLite 放回 Windows bind mount。
- 公网部署需配置 HTTPS 反向代理、Secure Cookie 与每日备份；管理员可在「账号管理 → 上线检查」查看认证、注册、HTTPS 与最近备份状态。
- 多用户部署建议只跑一个 `edu-agent` 容器，容器绑定 `127.0.0.1:3001`，由宿主机 Nginx 对外；compose 已配置 `/health` healthcheck 与 10m×3 日志轮转。
- `deploy/deploy.sh` 默认同步代码时会排除 `server/.env`、`server/data`、`server/uploads` 与 `server/models`，服务器 `.env` 由运维单独维护，避免本地配置覆盖生产密钥。
- 生产建议 `REGISTRATION_OPEN=0`，由管理员建号；如需开放注册，再显式改回 `1` 并重启容器。
- 备份：`npm run backup -- --with-uploads`，恢复后建议撤销全部会话；`.env`（尤其 `EDUPI_SETTINGS_SECRET`）必须异地保存。
- 当前服务器 `8.148.185.212` 仍是 HTTP + Nginx 3000 直连；HTTPS 域名证书未配置，属于真实多用户上线前的阻断项。

## 已知限制与后续

- 快模型分级路由已提供 `FAST_MODEL_ID`（默认关闭，仅作用于轻量路由场景）；已完成会话锁/并发门限/多 key 固定等功能级并发回归，50+ 用户压力测试仍未做。
- MCP 副作用工具采用配置期显式授权，不在对话中途弹窗确认。
- 部分非核心体验仍在后续：MCP 断线重连/日志/推荐模板、复盘报告导出、可视化动画与联动高亮。
- 复盘当前只支持单文件图片或 PDF；多图自动拼接、纠偏、分页、确定性自动判分未实现；统计只到题型与知识点。
- 可视化已支持 `abs`（含 `|...|` 原生解析）、三角/根式、`f(x)=`/`g(x)=` 定义与复合、`\begin{cases}` 分段函数、根/交点/极值、x/y 双向条件区域、自适应圆锥曲线、全类型 VizPlan v2 严格 schema、预置原生 v2、批量迁移与 SVG 像素基线 CI；未实现渐近线/切点/对称轴、`f(x)=g(x)+1` 这类嵌套分段复合、逐步辅助线、预置生物 3D 模型库，以及 WebGL 浏览器截图基线。
- 语音：ASR 仅支持 16-bit PCM WAV（sherpa-onnx Paraformer），云端 ASR、edge-tts / piper 与音频统一入库未实现；播放控制只有停止。
- 上传：单文件 50MB、单次最多 50 个文件、单次总大小 200MB；不显示浏览器上传进度条。
- MCP：`mcp.json` 不含密钥，Pi 原生 MCP 需要 env/headers 的场景请使用管理页配置。
- 解题视频按设计不自研渲染管线，后续接外部 MCP。
- 扫描件 OCR 依赖 docling-serve；公式增强默认关闭，Docling 转换中途重启会重新提交。
- `/privacy`、`/terms` 为占位视图，正文、备案号、联系方式待运营方提供，登记为上线阻断（Q6）。
- 反代（Caddy/Nginx）、HTTPS 域名与每日备份调度未定，B4 未开工（Q5）。
- `edu_questions` 集合、Router/Worker 运行时、edulab 工程移植、GeoGebra 按 Q4 兜底不实现，已在设计文档 v0.31 标注。
- 评测集仍为 8 题小样本，人工标注（`relevant_sources`/`answer`/`expected_citations`）为独立数据任务。
- 引用正确率答案级判定不可计算。
