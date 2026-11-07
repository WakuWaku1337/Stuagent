# 智学 实施进度

当前阶段：B Pi 内核与对话 —— 已完成（S03、S04 验收通过）
已完成对话：S01、S02（阶段 A）；S03、S04（阶段 B，2026-11-07 本次）
下一步对话（编号+目标）：S05 文档解析切片 —— /api/documents 上传，PDF/Word/MD 解析与 chunk；验收：切片结果正确、带元数据

关键文件/接口：
- server/src/pi.ts：Pi 嵌入封装。ModelRuntime + models.json 自定义 provider（edupi），createAgentSession（noTools:'all'、thinkingLevel:'off'、SessionManager.inMemory()），会话按 sessionId 常驻 Map
- server/src/index.ts：Hono 路由。GET /health、GET /api/model、POST /api/chat（默认非流式；stream:true 走 SSE：delta/done/error 事件）
- server/agent-workspace/AGENTS.md：Tutor 主讲系统提示词（Pi 自动作为上下文加载，实测人设生效）
- server/.env（不入库）：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，复用本机 codex 的配置：阿里云百炼 MaaS OpenAI 兼容端点 + qwen3.8-flash
- server/data/pi-agent/（不入库）：运行时生成的 models.json（apiKey 用 $LLM_API_KEY 环境插值）与 auth.json
- web/src/views/ChatView.vue + stores/chat.ts + api/chat.ts + components/MarkdownView.vue：对话页（气泡、流式追加、停止/新会话、marked+KaTeX+DOMPurify 渲染）
- 路由：/ 首页（health 状态 + 对话入口）、/chat 对话页

验收证据（2026-11-07 实测）：
- S03：POST /api/chat 非流式返回真实回复（Tutor 人设生效）；GET /api/model 返回 provider/model/baseUrl/configured
- S04：curl SSE 逐字 delta 正常；浏览器 /chat 页发送"求根公式"问题，流式回复完整、KaTeX 渲染 16 个公式节点；第二轮追问准确复述第一问（多轮上下文生效）；vue-tsc + vite build 通过

启动方式：
- npm run milvus:up（阶段 C 才用到，可后置）
- npm run dev（server 3000 + web 5173）；浏览器 http://localhost:5173/chat

关键决策与偏离（需评审知悉）：
1. 模型 provider：复用本机已有的阿里云百炼 MaaS 端点（qwen3.8-flash，OpenAI 兼容），未装 Ollama。密钥只存 server/.env（gitignore），models.json 用环境插值不落盘明文。
2. Pi 嵌入方式：官方 SDK createAgentSession；自定义 provider 走 models.json（ModelRuntime 加载）；PI_OFFLINE=1 跳过内置 provider 的境外目录刷新。
3. 前端 SSE 用 fetch + ReadableStream 解析（POST 场景 EventSource 不适用），事件协议与设计一致。
4. 阶段 B 会话为进程内 Map + inMemory 日志，重启丢失；持久化会话属后续阶段（设计 5.5 可续任务在 P1）。
5. 阶段 A 决策延续：Milvus local 存储免 MinIO（官方镜像已下架）。
6. setup-matt-pocock-skills 技能本会话不可用，未使用。

遗留问题与风险：
- S05 需要文件解析库（pdfjs-dist/mammoth 等），npmmirror 可装
- S06 灌库前需验证 local 存储模式下 BM25 Function 与 HNSW 索引可用
- @zilliz/milvus2-sdk-node 目前以 --no-save 装在根 node_modules；S06 时正式加入 server 依赖
- 浏览器自动化工具的 click 对该页按钮偶发不触发（DOM 检查确认功能正常，人工点击不受影响）