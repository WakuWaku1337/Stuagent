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