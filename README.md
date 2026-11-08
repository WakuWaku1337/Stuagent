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
- **统一可视化**：函数/圆锥曲线、立体几何、分子、物理场景、细胞结构等按题目内容确定性建模；预置模板 + 交互渲染。
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
| 可视化 | Three.js、function-plot、3Dmol、内联 SVG |

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
| `LLM_VISION=0/1` | 覆盖视觉能力判断 |
| `MILVUS_ADDRESS` | 默认 `localhost:19530` |
| `DOCLING_URL` | 默认 `http://localhost:5001` |

### 账号

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AUTH_ENABLED` | 1 | 关闭仅限隔离测试，生产禁止 |
| `REGISTRATION_OPEN` | 1 | 公开注册开关 |
| `AUTH_BOOTSTRAP` | 0 | 允许本机首次注册成为管理员 |
| `SESSION_TTL_DAYS` / `SESSION_ABSOLUTE_DAYS` | 7 / 30 | 会话空闲/绝对有效期 |
| `COOKIE_SECURE` | auto | HTTPS 下设置 Secure Cookie |
| `TRUST_PROXY` | 1 | 信任反向代理转发头 |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_MIN` | 5 / 15 | 登录失败锁定 |
| `ANSWER_CACHE_TTL_MIN` | 60 | 精确答案缓存，0 关闭 |
| `RAG_CACHE_TTL_MIN` / `RAG_CACHE_THRESHOLD` | 10 / 0.96 | 检索语义缓存 |
| `EMBEDDING_CACHE_DAYS` | 30 | embedding 缓存保留天数 |
| `CHAT_HISTORY_LIMIT` | 16 | 回放历史条数 |
| `RERANK_MIN_QUERY_CHARS` | 16 | 短查询跳过 Cross-Encoder |
| `ROUTE_LLM_MIN_CHARS` | 24 | 短问题跳过路由模型 |

### 存储与扫描件

| 变量 | 说明 |
| --- | --- |
| `EDU_DATA_DIR` / `EDU_UPLOADS_DIR` | 数据目录与上传目录 |
| `STORAGE_QUOTA_MB` / `STORAGE_RETENTION_DAYS` / `STORAGE_CLEANUP_HOURS` | 存储配额与孤儿清理 |
| `DOCLING_OCR_ENGINE` | `auto` / `docling` / `docling+vision` |
| `DOCLING_TIMEOUT_MS` / `DOCLING_POLL_MS` | Docling 超时与轮询 |
| `DOCLING_FORMULA_ENRICHMENT=1` | 启用 Docling 公式 LaTeX（CPU 很慢，默认关闭） |
| `OCR_CONFIDENCE_THRESHOLD` | 待校对阈值，默认 0.8 |
| `OCR_VISION_FORMULA_MIN_MARKERS` | 公式占位达到该数量的页面走视觉增强，默认 10，0 关闭 |
| `OCR_DPI` | 扫描页渲染 DPI，默认 200 |

## 数据与检索

- 文档切片保留章节路径与页码，引用可回查原文；扫描件由 Docling 输出逐页 Markdown，低置信/公式密集页可用视觉模型增强。
- 扫描件异步执行，资料库显示进度；低置信页面提供原文图与 Markdown 对照校对，校对后重新切片入库。
- 每个账号的向量写入独立 Milvus collection；资料、媒体、任务事件与用量都按账号隔离。
- 长期记忆同时镜像到 `data/memory/<learner_id>/`；旧版单文件 HTML 课件保留只读兼容。

## 主要 API

| 分组 | 路径 |
| --- | --- |
| 认证 | `POST /api/auth/register`、`login`、`logout`；`GET /api/auth/me`；`PUT /api/auth/password`；`GET /api/auth/sessions` |
| 管理 | `/api/admin/users`、`/api/admin/users/:id`、`/reset-password`、`/api/admin/audit`、`/api/admin/system-check` |
| 对话 | `POST /api/chat`；`POST /api/conversations/:id/messages`；`GET/POST /api/conversations` |
| 资料 | `POST/GET /api/documents`、`/api/documents/:id`、`/ocr`、`/reparse`、`/index`；`POST /api/knowledge/search` |
| 学习 | `/api/quiz/*`、`/api/wrongbook/*`、`/api/mastery`、`/api/memory/*`、`/api/plan/*`、`/api/daily/*` |
| 考试 | `POST /api/reviews/recognize`、`/api/reviews/:id/analyze`；`GET /api/reviews`、`/compare` |
| 媒体/语音 | `/api/media/upload`、`/api/media/:id`、`/api/media/storage`、`/api/asr`、`/api/tts` |
| 可视化 | `GET/POST /api/visualize`、`POST /api/visualize/generate`、`/api/courseware/:id` |
| MCP | `/api/mcp/servers`、`/api/mcp/tools`、`/api/mcp/servers/:id/test` |
| 设置/用量 | `/api/settings/*`、`/api/usage/summary`、`/daily`、`/cost`、`/export` |
| 任务 | `POST/GET /api/tasks`、`/api/tasks/:id`；WebSocket `/ws` |

## 页面

`/` 学习台、`/plan` 学习计划、`/chat` 对话、`/documents` 资料库、`/quiz` 智能出题、`/wrongbook` 错题本、`/mastery` 掌握度、`/exam` 模拟考试、`/tasks` 后台任务、`/review` 考试复盘、`/visualize` 统一可视化、`/settings` 模型设置、`/usage` 用量统计、`/storage` 存储治理、`/mcp` MCP 扩展、`/admin` 账号管理、`/account` 账号设置。

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
```

对开启认证的服务运行回归时设置 `AUTH_USER` / `AUTH_PASSWORD`；隔离测试服务可用 `AUTH_ENABLED=0`。

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
- 备份：`npm run backup`，恢复后建议撤销全部会话。

## 已知限制与后续

- S23 仍未完成独立“快模型”分级路由与并发压测；当前已落地 embedding/检索/答案缓存、短问题快路径与 TTFT/P95 小样本压测。
- 部分非核心体验仍在后续：MCP 断线重连/日志/推荐模板、复盘报告导出、TTS 音量/逐句跟读、可视化动画与联动高亮。
- 解题视频按设计不自研渲染管线，后续接外部 MCP。
- 扫描件 OCR 依赖 docling-serve；公式增强默认关闭，Docling 转换中途重启会重新提交。
