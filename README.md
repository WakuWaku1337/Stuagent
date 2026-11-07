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
| POST | /api/chat | 对话（`stream:true` 走 SSE：delta/citations/done/error） |
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

页面：`/` 首页、`/chat` 对话（引用卡片、KaTeX、角色徽标）、`/documents` 资料库、`/quiz` 出题、`/wrongbook` 错题本、`/mastery` 掌握度、`/exam` 模考、`/tasks` 后台任务。