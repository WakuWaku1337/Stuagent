# 智学 Agent（EduPi）

本地优先、单用户的高中学习智能体。以 Pi Coding Agent 为内核，Vue3 前端 + Node（Hono）本地服务。

当前进度见 [PROGRESS.md](./PROGRESS.md)，设计文档见 [智学Agent项目设计文档.md](./智学Agent项目设计文档.md)。

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
npm run asr:model      # 首次启用语音输入：下载本地 ASR 模型（约 82MB，写入 server/models，不入库）
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
| POST | /api/chat | 对话（`stream:true` 走 SSE：conversation/media/route/delta/citations/continuation/incomplete/done/error）；支持 `mediaIds` 图片输入；无 conversationId 时自动建会话 |
| POST | /api/conversations/:id/messages | 在指定会话继续对话；`continue:true` 从断点续写、`regenerate:true` 重新生成上一条回复 |
| POST | /api/media/upload | 上传图片（multipart `file`，最多 4 张、单张 ≤8MB，仅 JPG/PNG/WebP） |
| GET | /api/media/:id | 读取图片（immutable 缓存、nosniff） |
| GET | /api/media/storage | 存储用量、配额状态、孤儿文件与清理记录 |
| POST | /api/media/cleanup | 孤儿回收 / 按保留期清理（`dryRun` 预检） |
| GET | /api/asr | 语音识别状态（模型是否就绪） |
| POST | /api/asr | 语音转文字（multipart `audio`，16-bit PCM WAV，8k~48kHz，≤60s） |
| GET | /api/tts | TTS 模式（浏览器 / 服务端） |
| POST | /api/tts | 朗读文本（未配置服务端 TTS 时返回 `{mode:'browser'}`，否则返回音频） |
| GET/POST | /api/conversations | 历史会话列表（`q` 搜索、`limit/offset` 分页）/ 新建会话 |
| GET/PUT/DELETE | /api/conversations/:id | 会话详情与消息（`limit/before` 分页）/ 重命名与置顶 / 删除 |
| GET | /api/plan | 当前学习计划、完成统计与归档历史 |
| POST | /api/plan/generate | 按目标/天数/每日时长生成计划（自动归档旧计划） |
| PUT | /api/plan/:id | 调整计划参数并重算每日任务 |
| PUT | /api/plan/:id/tasks/:taskId | 勾选/取消计划任务，自动计算进度 |
| POST/DELETE | /api/plan/:id/archive · /api/plan/:id | 归档计划 / 删除计划 |
| GET | /api/daily | 今日练习状态、题目、连续天数与推荐重点 |
| POST | /api/daily/start · /api/daily/answer | 开始/继续今日练习 / 提交单题（完成时联动掌握度与错题本） |
| GET | /api/conversations/:id/messages | 消息分页（`limit`、`before` 游标） |
| POST/GET | /api/documents | 上传（multipart，支持多文件与 `paths` 相对路径）/ 文档列表 |
| POST | /api/documents/batch | 文件夹批量导入（`paths` 保留相对路径，逐文件返回状态） |
| GET/DELETE | /api/documents/:id | 文档详情与切片 / 删除（含向量） |
| POST | /api/documents/:id/reparse / index | 重新解析 / 重新灌库 |
| GET | /api/documents/:id/ocr | 扫描件 OCR 进度、逐页识别文本与置信度、待校对页 |
| GET | /api/documents/:id/ocr/pages/:page/image | 该页原文图（200 DPI，用于人工校对） |
| PUT | /api/documents/:id/ocr/pages/:page | 保存校对文本 / 标记该页已校对 |
| POST | /api/documents/:id/ocr/confirm · retry | 校对通过后重新切片灌库 / 重跑 OCR |
| POST | /api/knowledge/search | 混合检索 + 精排 + 引用 |
| GET/POST | /api/memory | 长期记忆列表 / 写入 |
| GET | /api/wrongbook | 错题列表（`?due=1` 只看待复习） |
| POST | /api/wrongbook/:id/review | SM-2 复习（quality 0-5） |
| GET | /api/mastery | BKT 掌握度 |
| POST | /api/quiz/generate · /api/quiz/answer | 出题 / 答题判分（难度省略时按掌握度推荐） |
| GET | /api/quiz/difficulty | 按知识点掌握度推荐出题难度 |
| GET/POST | /api/mcp/servers | MCP 服务列表 / 添加（stdio、HTTP、SSE；env/headers 加密） |
| PUT/DELETE | /api/mcp/servers/:id | 编辑/启停 / 删除 MCP 服务 |
| POST | /api/mcp/servers/:id/test | 连接测试并发现工具 |
| GET | /api/mcp/tools | 已发现且已授权的 MCP 工具 |
| PUT | /api/mcp/servers/:id/tools/:toolName | 单工具授权开关 |
| POST | /api/bank/extract | 从资料提取题库 |
| POST | /api/exam/start · /api/exam/:id/submit | 模考开始 / 交卷分析 |
| GET | /api/agents | 子智能体列表（Tutor/Quizzer/Analyst/Solver） |
| POST | /api/tasks · GET /api/tasks/:id | 后台任务（quiz/analysis），202 入队；WS `/ws` 推送进度 |
| POST | /api/reviews/recognize | 整卷识别（拍照 PNG/JPG、PDF、DOCX、文本） |
| GET | /api/reviews · /api/reviews/:id · /api/reviews/compare | 考试记录 / 详情 / 趋势对比 |
| POST | /api/reviews/:id/analyze | 生成复盘报告（判分、错因、BKT、错题联动） |
| GET/POST | /api/visualize | 统一可视化列表（含旧版课件）/ 按 spec 生成 |
| POST | /api/visualize/generate | 按题目内容本地解析建模（函数/方程/几何/分子/物理场景），不调用对话模型 |
| GET/DELETE | /api/visualize/:id | 统一可视化对象 / 删除（课件与生成结果同一入口） |
| GET | /api/courseware/:id | 旧版单文件课件 HTML（CSP 沙箱，只读兼容） |
| GET | /api/settings/providers | Provider 与模型目录 |
| GET/PUT | /api/settings/model | 当前模型 / 切换 Provider 与模型 |
| GET/PUT | /api/settings/apikey · /api/settings/keys | 密钥列表（掩码）/ 保存、更新、删除 |
| PUT | /api/settings/reasoning · /api/settings/generation | 思考强度 / 生成参数与预算 |
| POST | /api/settings/test | 测试模型连接与密钥有效性 |
| GET | /api/usage/summary · /api/usage/daily · /api/usage/cost | 用量汇总 / 每日明细 / 成本 |
| GET | /api/usage/export?format=csv|json | 导出用量明细 |

页面：`/` 首页、`/plan` 学习计划（目标拆解、每日任务勾选、调整与归档）、`/chat` 对话（历史会话侧栏、重开续聊、拍照/上传图片问答、语音输入与朗读、参考资料折叠、KaTeX、角色徽标、截断续写）、`/documents` 资料库、`/quiz` 出题与每日练习、`/wrongbook` 错题本、`/mastery` 掌握度、`/exam` 模考、`/tasks` 后台任务、`/review` 考试复盘、`/visualize` 统一可视化（交互课件与自动可视化合并，`/courseware` 自动跳转）、`/settings` 模型设置、`/usage` 用量统计、`/storage` 存储治理、`/mcp` MCP 扩展。

技术栈前端：Vue3 + Vite + Element Plus + ECharts（按需加载），统一水墨蓝主题与移动端抽屉导航。

安全：对话接口内置注入拦截、手机号/身份证/银行卡/邮箱脱敏、密钥过滤，流式输出同样生效。

资料库：支持多文件与文件夹批量导入（`webkitdirectory` 或拖拽文件夹），相对路径写入 `source_path` 并作为切片章节前缀；单次最多 50 个文件 / 200MB，前端文件夹上限 100 个 / 300MB。

扫描件：自动判定图片型 PDF（逐页正文长度 + 整页大图覆盖），按 200 DPI 渲染后逐页 OCR；视觉模型直接输出 Markdown + LaTeX（复杂版面/公式推荐），也可装本地 RapidOCR 走离线路径（`OCR_ENGINE=auto|vision|local`，`scripts/rapidocr_bridge.py`）。多页异步执行，`GET /api/documents/:id/ocr` 显示进度；逐页缓存、服务重启可续。按模型自评 + 乱码/重复 + 图像清晰度逐页打分，低于 0.8 标记待校对；资料库校对弹层左侧原文图、右侧 Markdown，全部校对后写回并重新切片入库。相关配置：`OCR_DPI`（默认 200）、`OCR_CONCURRENCY`（默认 2）、`OCR_CONFIDENCE_THRESHOLD`（默认 0.8）、`OCR_TIMEOUT_MS`、`OCR_LOCAL_PYTHON`。

出题与复习：难度默认“推荐”，按知识点 BKT 掌握度选择基础/中等/拔高；错题到期时顶栏显示“待复习 N”，每天首次打开会弹出复习提醒。

MCP：支持 stdio 本地进程与 HTTP/SSE 远程服务，连接测试后自动发现工具；工具以 `mcp__服务__工具` 注册给 Tutor/Quizzer/Analyst/Solver，可逐项授权。env 与 headers 加密保存，接口只返回键名。

统一可视化：交互课件与自动可视化已合并为一个入口。生成可视化时由后端直接解析题目内容，不调用对话模型：函数表达式与交点/不等式/区间/滑块、圆锥曲线方程、正方体/棱锥的命名点/棱长/中点/截面、三角形/矩形/圆等平面图形、常见分子式、打印机进纸/斜面/电路/透镜/细胞等场景分别走确定性建模；解析不到具体结构时不出图，纯主题问题才回退预置模板。渲染器共用：立体几何/三维函数/地形/细胞结构用 Three.js，函数与圆锥曲线用 function-plot（多函数叠加、交点与零点标记、不等式区域填充、参数滑块、图例显隐），化学分子用 3Dmol，受力/电路/示意用内联 SVG。工具条提供旋转缩放、重置视角、辅助线/截面显隐、标注、自动旋转、全屏与截图；辅助元素附带添加理由。回答内嵌可视化，并把 `visualization_id` 落库，重开会话仍然可见。旧的单文件 HTML 课件保留为只读项（沙箱 iframe + CSP），不再生成新的 HTML 课件。长期记忆镜像到 `server/data/memory/*.md`。

解题视频：按设计 §3.2 不在本期自研渲染管线；如需视频，可通过 `/mcp` 接入外部解题视频 MCP 服务。

回复完整性：读取 `finish_reason=length` 并检查代码围栏/括号闭合，自动携带断点续写最多 3 次；仍未完成时 SSE 发出 `incomplete` 事件，前端显示“继续生成 / 重新生成”。

图片：前端压缩到最长边 1600px（JPEG 0.85）后上传，文件存于 `server/uploads/media`；视觉模型直接读图；非视觉模型自动用同 Provider 的视觉模型做 OCR（可用 `LLM_OCR_MODEL` 指定 OCR 模型），`LLM_VISION=0/1` 可覆盖视觉能力判断。图片消息与 OCR 文本随会话持久化，重开可续聊。

语音：浏览器录音（波形/时长/取消），重采样为 16k 单声道 WAV 后 `POST /api/asr`；识别使用本地 sherpa-onnx Paraformer 中文模型（先运行 `npm run asr:model`），音频不出本机。TTS 默认使用浏览器 `speechSynthesis`（系统音色、语速可调，可正文朗读单条回复）；如配置 `TTS_BASE_URL` / `TTS_MODEL` / `TTS_VOICE`，`POST /api/tts` 会改用 OpenAI 兼容 `/audio/speech` 返回音频。麦克风需在 localhost 或 HTTPS 下使用。

## 质量校验

```bash
cd server
node --import jiti/register scripts/regression.ts   # 全流程回归（45 项）
node --import jiti/register scripts/eval-rag.ts     # RAG 评测（Hit@K / MRR / 延迟）
node --import jiti/register scripts/check-security.ts  # 安全策略单测
node --import jiti/register scripts/check-vision.ts # 图片问答端到端（上传→读图/OCR→作答）
node --import jiti/register scripts/check-voice.ts  # 语音端到端（ASR→文本、TTS 模式）
node --import jiti/register scripts/check-storage.ts # 存储治理（级联、保留期清理、配额）
node --import jiti/register scripts/check-plan.ts   # 学习计划（生成、勾选、调整、归档、校验）
node --import jiti/register scripts/check-continuation.ts # 截断判定、续写拼接与提示词
node --import jiti/register scripts/check-daily.ts  # 每日练习（生成、作答、完成、连续天数）
node --import jiti/register scripts/check-documents.ts # 文件夹导入相对路径与章节元数据
node --import jiti/register scripts/check-ocr.ts    # 扫描件 OCR（判定→进度→原文图→校对写回→重新入库）
node --import jiti/register scripts/check-difficulty.ts # 掌握度 → 出题难度校准
node --import jiti/register scripts/check-mcp.ts    # MCP 服务接入、工具发现/授权/调用与配置同步
node --import jiti/register scripts/check-visualize.ts # 可视化 spec 校验与表达式求值
node --import jiti/register scripts/check-s31.ts    # 统一可视化引擎（题目确定性建模、spec 校验、统一列表/删除）、SKILL.md 与记忆镜像
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

- 访问 http://localhost:3000 （API 与前端同端口，WebSocket 走同一端口 `/ws`）；与 `npm run dev` 的 3000 冲突时用 `APP_PORT=3100 docker compose ... up -d edu-agent`，改访问 3100
- 应用配置读取 `server/.env`（compose `env_file`）；容器内 Milvus 地址为 `milvus:19530`
- 数据持久化：SQLite 与记忆/课件镜像放命名卷 `app_data`（容器内 `/app/data`，由 `EDU_DATA_DIR` 指定），`server/uploads` 以 bind mount 挂载原始文件。**不要把 SQLite 放回 Windows bind mount**：9p 无可靠文件锁，`node:sqlite` 会以 `disk I/O error` 崩溃循环
- 旧数据迁移：先让宿主机停写并 checkpoint WAL，再灌入卷，例如
  `docker run --rm -v docker_app_data:/data -v "D:\stu\server\data:/src:ro" docker.m.daocloud.io/library/node:24-bookworm-slim sh -c "cp -a /src/edu.db /src/memory /src/courseware /src/pi-agent /data/"`
- 语音识别模型不打入 git：构建镜像前先在宿主机运行 `npm run asr:model`，`server/models` 会 COPY 进镜像；运行时需要 `libgomp1`（Dockerfile 已安装）
- 镜像基于 `node:24-bookworm-slim`（`node:sqlite` 需要 Node ≥ 22.5），构建时 npm 走 npmmirror