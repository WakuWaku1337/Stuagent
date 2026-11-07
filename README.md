# 智学 Agent（EduPi）

本地优先、单用户的高中学习智能体。以 Pi Coding Agent 为内核，Vue3 前端 + Node（Hono）本地服务。

当前进度见 [PROGRESS.md](./PROGRESS.md)，设计文档见 `C:\Users\13421\Doubao\chats\2026-11-04\new-chat\智学Agent项目设计文档.md`。

## 目录

```
├── docker/          # Milvus Standalone（etcd + Milvus，local 存储免 MinIO）
├── server/          # Node + Hono 后端（内嵌 Pi，阶段 B 接入）
└── web/             # Vue3 + Vite 前端
```

## 快速开始

```bash
npm install
npm run milvus:up      # 启动 Milvus（19530），健康检查：npm run milvus:health
npm run dev            # 并行启动 server(3000) 与 web(5173)
```

浏览器访问 http://localhost:5173 ，首页展示后端 `/health` 联通状态。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 并行启动前后端 |
| `npm run dev:server` | 仅后端（node --watch + jiti 直跑 TS） |
| `npm run dev:web` | 仅前端（Vite） |
| `npm run build` | 构建前端 |
| `npm run milvus:up / milvus:down` | 启停 Milvus |
| `npm run milvus:health` | Milvus 健康检查（9091/healthz） |
| `node --import jiti/register scripts/check-rag.ts all` | RAG 自检：建集合 → 灌库 → 检索（在 server 目录运行） |

## 接口速览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /health | 健康检查 |
| GET | /api/model | 当前模型与配置状态 |
| POST | /api/chat | 对话（`stream:true` 走 SSE：conversation/media/route/delta/citations/done/error）；支持 `mediaIds` 图片输入；无 conversationId 时自动建会话 |
| POST | /api/media/upload | 上传图片（multipart `file`，最多 4 张、单张 ≤8MB，仅 JPG/PNG/WebP） |
| GET | /api/media/:id | 读取图片（immutable 缓存、nosniff） |
| GET/POST | /api/conversations | 历史会话列表（`q` 搜索、`limit/offset` 分页）/ 新建会话 |
| GET/PUT/DELETE | /api/conversations/:id | 会话详情与消息（`limit/before` 分页）/ 重命名与置顶 / 删除 |
| GET | /api/conversations/:id/messages | 消息分页（`limit`、`before` 游标） |
| POST | /api/conversations/:id/messages | 在指定会话继续对话（SSE，原上下文续聊） |
| POST/GET | /api/documents | 上传（multipart，支持多文件）/ 文档列表 |
| GET/DELETE | /api/documents/:id | 文档详情与切片 / 删除（含向量） |
| POST | /api/documents/:id/reparse / index | 重新解析 / 重新灌库 |
| POST | /api/knowledge/search | 混合检索 + 精排 + 引用 |
| GET/POST | /api/memory | 长期记忆列表 / 写入 |
| GET | /api/wrongbook | 错题列表（`?due=1` 只看待复习） |
| POST | /api/wrongbook/:id/review | SM-2 复习（quality 0-5） |
| GET | /api/mastery | BKT 掌握度 |
| POST | /api/quiz/generate · /api/quiz/answer | 出题 / 答题判分 |
| POST | /api/bank/extract | 从资料提取题库 |
| POST | /api/exam/start · /api/exam/:id/submit | 模考开始 / 交卷分析 |
| GET | /api/agents | 子智能体列表（Tutor/Quizzer/Analyst/Solver） |
| POST | /api/tasks · GET /api/tasks/:id | 后台任务（quiz/analysis），202 入队；WS `/ws` 推送进度 |
| POST | /api/reviews/recognize | 整卷识别（拍照 PNG/JPG、PDF、DOCX、文本） |
| GET | /api/reviews · /api/reviews/:id · /api/reviews/compare | 考试记录 / 详情 / 趋势对比 |
| POST | /api/reviews/:id/analyze | 生成复盘报告（判分、错因、BKT、错题联动） |
| GET/POST | /api/courseware | 交互课件列表 / 生成（单文件 HTML，离线可用） |
| GET | /api/courseware/:id | 课件 HTML（CSP 沙箱） |
| GET | /api/settings/providers | Provider 与模型目录 |
| GET/PUT | /api/settings/model | 当前模型 / 切换 Provider 与模型 |
| GET/PUT | /api/settings/apikey · /api/settings/keys | 密钥列表（掩码）/ 保存、更新、删除 |
| PUT | /api/settings/reasoning · /api/settings/generation | 思考强度 / 生成参数与预算 |
| POST | /api/settings/test | 测试模型连接与密钥有效性 |
| GET | /api/usage/summary · /api/usage/daily · /api/usage/cost | 用量汇总 / 每日明细 / 成本 |
| GET | /api/usage/export?format=csv|json | 导出用量明细 |

页面：`/` 首页、`/chat` 对话（历史会话侧栏、重开续聊、拍照/上传图片问答、引用卡片、KaTeX、角色徽标）、`/documents` 资料库、`/quiz` 出题、`/wrongbook` 错题本、`/mastery` 掌握度、`/exam` 模考、`/tasks` 后台任务、`/review` 考试复盘、`/courseware` 交互课件、`/settings` 模型设置、`/usage` 用量统计。

技术栈前端：Vue3 + Vite + Element Plus + ECharts（按需加载），统一水墨蓝主题与移动端抽屉导航。

安全：对话接口内置注入拦截、手机号/身份证/银行卡/邮箱脱敏、密钥过滤，流式输出同样生效。

图片：前端压缩到最长边 1600px（JPEG 0.85）后上传，文件存于 `server/uploads/media`；视觉模型直接读图；非视觉模型自动用同 Provider 的视觉模型做 OCR（可用 `LLM_OCR_MODEL` 指定 OCR 模型），`LLM_VISION=0/1` 可覆盖视觉能力判断。图片消息与 OCR 文本随会话持久化，重开可续聊。

## 质量校验

```bash
cd server
node --import jiti/register scripts/regression.ts   # 全流程回归（32 项）
node --import jiti/register scripts/eval-rag.ts     # RAG 评测（Hit@K / MRR / 延迟）
node --import jiti/register scripts/check-security.ts  # 安全策略单测
node --import jiti/register scripts/check-vision.ts # 图片问答端到端（上传→读图/OCR→作答）
```

## 生产构建

```bash
npm run build        # 构建 web/dist
npm run dev:server   # :3000 同时托管 API 与前端 SPA
```

## Docker 部署（推荐本地试用）

```bash
# 首次或代码更新后：构建镜像并启动（etcd + Milvus + 应用）
docker compose -f docker/docker-compose.yml up -d --build

# 查看状态 / 日志
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs -f edu-agent

# 停止
docker compose -f docker/docker-compose.yml stop edu-agent
```

- 访问 http://localhost:3000 （API 与前端同端口，WebSocket 走同一端口 `/ws`）
- 应用配置读取 `server/.env`（compose `env_file`）；容器内 Milvus 地址为 `milvus:19530`
- 数据持久化：`server/data`（SQLite、模型配置）与 `server/uploads`（原始文件）以 bind mount 挂载，重建容器不丢数据
- 镜像基于 `node:24-bookworm-slim`（`node:sqlite` 需要 Node ≥ 22.5），构建时 npm 走 npmmirror