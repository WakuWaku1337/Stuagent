# 智学 实施进度

当前阶段：阶段 I · S21 语音能力已完成（2026-11-07）
- 本地 ASR：sherpa-onnx Paraformer 中文小模型（离线），`GET /api/asr` 状态、`POST /api/asr`（WAV，8k~48kHz，≤60s）
- 前端录音：MediaRecorder + AnalyserNode 波形、计时、取消/停止；录音结束后在浏览器内重采样为 16k 单声道 WAV，识别文字进入输入框可编辑
- TTS：`GET /api/tts` 能力、`POST /api/tts`；默认浏览器 speechSynthesis（优先本地中文音色，语速可调并持久化），配置 `TTS_BASE_URL/TTS_MODEL/TTS_VOICE` 后走 OpenAI 兼容 `/audio/speech` 返回音频
- UI：输入框麦克风按钮、录音面板（波形/时长/取消）、每条回复的朗读按钮、朗读设置弹层（音色/语速/试听/停止）
- Docker：镜像包含 ASR 模型与 libgomp1；容器内 ASR 实测通过；模型文件不入 git，首次运行 `npm run asr:model`

阶段 I · S20 图片输入已完成（2026-11-07）
- 新增 media 表与 `POST /api/media/upload`、`GET /api/media/:id`：JPG/PNG/WebP、单张 ≤8MB、一次 ≤4 张、magic bytes 校验、hash 去重、immutable 缓存与 nosniff
- 前端相机/相册选图、多图预览、最长边 1600px / JPEG 0.85 压缩、上传进度与移除
- 视觉模型直读图片：Pi `session.prompt` 携带 ImageContent，模型目录增加 vision 能力标记
- 非视觉模型 OCR 兜底：自动调用同 Provider 的视觉模型识别图片文字（可用 `LLM_OCR_MODEL` 指定），OCR 文本随消息保存并可在气泡中展开
- 图片消息与附件落库；历史回放支持最近 2 条图片消息（最多 4 张、单张 ≤2MB），非视觉模型回放 OCR 文本；仅图片消息自动标题“图片提问（N 张）”

阶段 I · S19 会话管理已完成（2026-11-07）
- 新增 CONVERSATION/MESSAGE 持久化（SQLite）：首条消息自动生成标题，用户/助手消息与引用落库
- 新增会话服务与接口：GET/POST `/api/conversations`、GET/PUT/DELETE `/api/conversations/:id`、GET `/api/conversations/:id/messages`、POST `/api/conversations/:id/messages`
- 新增历史侧栏：置顶/今天/昨天/更早分组、搜索、重命名、置顶、删除、新建；桌面固定侧栏，窄屏抽屉
- 重开续聊：旧会话加载历史消息；Pi 会话缺失时用 SQLite 历史重建上下文（跨服务重启有效）
- 消息分页（`limit` + `before` 游标）；前端缓存会话列表与最近 5 个会话（各 40 条消息，12 小时 TTL）
- `/api/chat` 兼容保留：无 conversationId 时自动建会话；SSE 新增 conversation/media 事件；流式写入串行化并冲刷，修复短回复丢帧

历史：H 进阶与收尾 —— 已完成（S17、S18 验收通过）；已增加 Docker 本地部署
旧编号 S19/S20（模型设置、用量统计）已于 2026-11-07 完成，见下方验收证据
已完成对话：S01–S18 全部完成（A–H）；阶段 I S19 会话管理、S20 图片输入、S21 语音能力完成
下一步对话：S22 存储治理（用量统计、孤儿回收、按周期清理、删会话连带删除）

关键文件/接口：
- server/src/voice/asr.ts：sherpa-onnx Paraformer 加载、WAV 解析（8k~48kHz/16-bit）、16k 重采样、识别与文本清洗
- server/src/routes/voice.ts：GET/POST /api/asr、GET/POST /api/tts（浏览器模式/OpenAI 兼容服务端 TTS）
- server/scripts/fetch-asr-model.ts + server/models/README.md：ASR 模型下载（hf-mirror，约 82MB，不入库）
- web/src/composables/useVoiceRecorder.ts：getUserMedia、MediaRecorder、波形、计时、重采样上传、取消
- web/src/composables/useSpeech.ts：浏览器 TTS、音色/语速持久化、服务端 TTS 音频回退、朗读状态
- web/src/utils/audio.ts + web/src/utils/speech.ts：webm/opus → 16k WAV、Markdown 转朗读文本
- web/src/api/voice.ts：ASR 状态/上传、TTS 请求（JSON/音频双模式）
- web/src/views/ChatView.vue：麦克风按钮、录音面板、朗读按钮与设置弹层
- server/scripts/check-voice.ts + server/testdata/asr-question-16k.wav：语音端到端脚本与测试音频
- docker/Dockerfile：COPY server/models、安装 libgomp1
- server/src/media/service.ts：图片落盘（uploads/media）、magic bytes 校验、hash 去重、附件/OCR、历史图片读取
- server/src/routes/media.ts：POST /api/media/upload、GET /api/media/:id（ETag/immutable/nosniff）
- server/src/chat/handler.ts：/api/chat 与 /api/conversations/:id/messages 共用处理器（安全检查、图片/OCR、落库、SSE、引用合并、写链冲刷）
- server/src/pi.ts：`dropConversationSessions`；新 Pi 会话按 SQLite 历史回放（最近 24 条、单条 8k 上限、用户内容回放前再脱敏）；`prompt(images)` 与历史图片回放
- server/src/settings/providers.ts：模型 vision 能力（目录标记 + ID 规则 + LLM_VISION 覆盖）与同 Provider 视觉模型查找
- web/src/api/media.ts + web/src/utils/image.ts：图片上传、前端压缩（1600px/JPEG 0.85）
- web/src/stores/chat.ts：待发送图片、上传状态、附件解析、发送携带 mediaIds
- web/src/views/ChatView.vue：相机/相册按钮、缩略图预览、图片气泡、OCR 文字展开、vision/ocr 提示
- server/scripts/check-vision.ts + server/testdata/vision-question.png：图片问答端到端脚本与测试题图
- server/src/conversations/service.ts：CONVERSATION/MESSAGE 数据访问、自动标题、搜索、消息游标分页
- server/src/routes/conversations.ts：会话 CRUD、消息分页、会话内继续对话
- server/src/chat/handler.ts：/api/chat 与 /api/conversations/:id/messages 共用处理器（安全检查、落库、SSE、引用合并、写链冲刷）
- server/src/pi.ts：`dropConversationSessions`；新 Pi 会话按 SQLite 历史回放（最近 24 条、单条 8k 上限、用户内容回放前再脱敏）
- web/src/api/conversations.ts + web/src/stores/chat.ts：会话客户端、列表/最近消息缓存、发送/分页/重命名/置顶/删除状态
- web/src/components/ChatHistory.vue：历史侧栏（分组、搜索、操作菜单）
- web/src/views/ChatView.vue：桌面侧栏 + 窄屏抽屉、`?c=` URL 同步、加载更早、重命名弹窗
- server/src/settings/{providers,store,crypto}.ts：Provider/模型目录、model_settings/provider_keys 设置、AES-256-GCM 加密、多 Key 冷却与可用性
- server/src/learning/llm.ts：统一 OpenAI 兼容/Anthropic 调用、场景参数、Key 故障切换、usage 记录、连接测试
- server/src/usage/store.ts + server/src/routes/usage.ts：用量聚合、预算、CSV/JSON 导出
- server/src/routes/settings.ts：providers/model/apikey/reasoning/generation/test（含密钥更新与删除）
- server/src/pi.ts：Pi runtime 从设置生成 models.json；samplingParams、thinkingLevel、多 Key 重试、对话 usage
- web/src/views/SettingsView.vue / UsageView.vue：设置页与用量页；web/src/api/data.ts 新增设置/用量客户端
- server/src/security/guard.ts：输入注入拦截（7 类规则）、PII 脱敏（手机/身份证/银行卡/邮箱）、输出过滤（脱敏 + sk-/Bearer/AKID 密钥）、流式 StreamRedactor（24 字符尾缓存，跨分片不漏检）
- server/src/courseware/service.ts：单文件交互课件生成（LLM 出 HTML + 校验；失败回退内置 canvas 模板），离线约束（禁止外链/CDN）
- server/src/courseware/tool.ts：Pi 工具 courseware_generate（Tutor/Solver 可用）
- server/src/routes/courseware.ts：/api/courseware（列表/生成/预览 HTML/删除），HTML 带 CSP 与 nosniff
- server/src/index.ts：/api/chat 接入安全检查（400 SECURITY_BLOCKED）、输入/输出脱敏、SSE security 事件；后端托管 web/dist（SPA 回退，API 404 保持 JSON）
- server/scripts/eval-rag.ts + server/testdata/eval-rag.json：RAG 评测集（8 题）与 Hit@K/MRR/延迟统计
- server/scripts/regression.ts：全流程回归（36 项，含设置/用量 5 项、会话 7 项、图片 4 项、语音 4 项）
- server/scripts/check-security.ts：安全单测（PII/密钥/注入/流式脱敏）
- web/src/views/CoursewareView.vue：课件页（生成、列表、沙箱 iframe 预览）；路由 /courseware

验收证据（2026-11-07 实测）：
- S21 本地 ASR：sherpa-onnx Paraformer zh small（82MB）加载后，6.65s 中文题音频识别为“已知直角三角形两条直角边分别是三和四求斜边长度”；开发机首请求 3.2s（含模型加载）/解码 145ms，Docker 首请求 1.5s/解码 70~79ms
- S21 浏览器录音：Edge 假麦克风（16k WAV）实测麦克风按钮→录音面板 00:06、28 根波形柱、取消可清空；停止后识别文字进入输入框，发送后正常回答
- S21 TTS：浏览器共有 324 个系统/在线音色；默认优先本地 Huihui，切换 Kangkang 与语速 1.3x 后 localStorage 持久化；试听与单条回复朗读均使 `speechSynthesis.speaking=true`，按钮高亮；未配置服务端 TTS 时 `POST /api/tts` 返回 `{mode:'browser'}`
- S21 UI：录音面板、麦克风/朗读按钮、朗读设置弹层在 1440 与 768 宽度均正常，无横向溢出
- S21 回归与脚本：36/36 PASS（新增 asr ready、asr transcribe、asr reject invalid audio、tts mode）；`scripts/check-voice.ts` ALL PASS；Docker 重建后同样通过
- S20 图片链路：900×520 PNG（40,322 B）上传 201，GET 返回 `image/png` + `nosniff` + immutable；If-None-Match 返回 304；重复上传命中 hash 去重（同一 media_id）；伪造 PNG 返回 422 IMAGE_TYPE；一次 5 张返回 400
- S20 视觉直读：发送测试题图，模型按图作答斜边 5；浏览器实测图片气泡 260×178、无 OCR 提示，标题取自文字提问
- S20 OCR 兜底：以 `LLM_VISION=0 LLM_OCR_MODEL=qwen3.8-flash` 启动时 `/api/model` 返回 `image_mode=ocr`；同一张图 OCR 195 字并作答 5（20.3s），气泡可展开“识别文字”；仅图片消息标题为“图片提问（1 张）”
- S20 图片上下文：服务重启后对旧图片会话追问“两条直角边分别是多少”，模型回答“3 和 4”（历史图片回放生效）
- S20 前端：选图→压缩→上传进度→缩略图→移除流程通过；图片气泡与 OCR 文本正常；`vue-tsc -b && vite build` 通过
- 2026-11-07 复跑全流程回归：32/32 PASS（新增 media upload、media serve、media dedupe、media reject non-image）
- S20 图片问答脚本：`scripts/check-vision.ts` ALL PASS（上传、视觉/OCR 作答、附件落库、图片 URL 可读）
- S19 持久化：`/api/chat` 自动建会话，首条消息生成标题；会话详情消息 2 条（user/assistant），`limit=1` 返回 hasMore=true，继续对话回复 20（引用上一轮答案 2）；删除后 GET 返回 404，注入输入不产生会话
- S19 续聊：服务重启后打开旧会话，询问“最开始问的原话”，模型返回“1+1等于几？只回答数字”；跨重启上下文由 SQLite 历史回放重建
- S19 历史侧栏：搜索“勾股”命中 2 条；重命名、置顶（进入置顶分组第一）、删除并清空当前会话均通过；45 条测试会话首次加载 30 条，点“加载更早的消息”后 45 条
- S19 前端缓存：localStorage 写入会话列表快照，以及最近 2 个会话（各最多 40 条消息，12 小时 TTL）
- S19 视觉：1440 显示固定侧栏；1024/768 隐藏侧栏并显示历史按钮；抽屉宽 288px；页面 scrollWidth = innerWidth，无横向溢出
- S19 流式：短回复（1~4 字）可完整收到 delta 与 done；客户端中断后服务仍健康，已生成内容保留
- 2026-11-07 复跑全流程回归：28/28 PASS（新增 conversation persisted、pagination、continue、rename+pin、search、delete、rejected not persisted）
- S19 设置/密钥：连接测试通过（qwen3.8-flash，1614ms，返回 OK）；错误 Key 保存返回 422；有效 Key 保存后列表仅回显掩码；密钥更新/删除接口通过
- S19 故障切换：插入失效 Key 后出题，401 自动进入冷却并切换到有效 Key，出题成功；冷却 Key 由 `cooling` 状态记录，后续请求跳过
- S19 思考与参数：对话请求携带 reasoning 覆盖；生成参数含全局 temperature/top_p/max_tokens/context_length 与 chat/quiz/review/courseware 场景覆盖；Pi models.json 使用 samplingParams/thinkingLevel
- S20 用量：实测 4 次调用（3 成功 1 失败），成功率 75%，记录 prompt/completion/total/reasoning tokens、延迟、成本、key_id；`/api/usage/summary|daily|cost` 与 CSV/JSON 导出均通过
- Provider 适配：OpenAI 兼容链路用当前 MaaS 实测（测试连接 1614ms）；Anthropic 链路用本地 mock 验证 x-api-key / anthropic-version、thinking 生效且不发送 temperature（max_tokens=2048）
- 2026-11-07 复跑全流程回归：21/21 PASS（新增 settings providers、settings model、api keys masked、usage summary、usage export csv；其余 16 项保持通过）
- 前端：`vue-tsc -b && vite build` 通过；设置/用量页 1440 与 390 宽度无横向溢出、无控制台错误；Docker 重建后 0 次重启
- S17 安全：注入消息返回 400 {code:SECURITY_BLOCKED, matches:[override-instructions, prompt-exfiltration]}；手机号输入触发 input_redactions phone×1，模型只收到 138****8000（复述实验）；单测输出：138****8000 / a***@example.com / 110101********1234 / 6222********0123，sk-/Bearer 均被掩码；流式三片拼出 138****8000
- S17 课件：LLM 生成《勾股定理交互课件》（4123 字节，canvas+range，无外链），CSP 生效；浏览器打开 canvas 绘制 101,252 个非透明像素，拖动滑块画面变化；课件页 iframe（sandbox=allow-scripts）加载正常；生成失败时回退内置模板
- S18 评测：8 题 RAG 回归 Hit@1=100%、Hit@3=100%、Recall@5=100%、MRR=1.000、P50 371ms / P95 1313ms
- S18 托管：`:3000/` 与 `/chat` 返回 SPA（含 #app），`/api/not-exist` 返回 JSON 404
- S18 全流程回归：16/16 PASS（health、model、agents、documents、memory、mastery、wrongbook、reviews、courseware、tasks、RAG、注入拦截、SPA、SPA 回退、API 404、非流式对话）

启动方式：
- 开发：npm run milvus:up；npm run dev（server 3000 + web 5173）
- Docker（本地试用，2026-11-07 实测）：docker compose -f docker/docker-compose.yml up -d --build；访问 http://localhost:3000；数据挂载 server/data 与 server/uploads；容器内 Milvus 地址 milvus:19530；实测 health、模型、SPA、资料、RAG、对话（含引用）全部正常
- 回归：cd server && node --import jiti/register scripts/regression.ts；评测：scripts/eval-rag.ts；安全单测：scripts/check-security.ts；图片问答：scripts/check-vision.ts；语音：scripts/check-voice.ts
- 语音模型：npm run asr:model（下载到 server/models，约 82MB；不入库；Docker 构建前需先下载）

关键决策与偏离（需评审知悉）：
1. 安全为自研轻量策略（规则 + 脱敏 + 流式过滤），未接入 SuperAgent 安全 SDK（设计与 §4.3 均标注其为 P2 可选）。
2. 课件未移植 edulab 工程，采用"LLM 生成单文件 HTML + 校验 + 内置模板兜底"，满足离线可看与交互；3D 由 canvas 表现，非 Three.js。
3. 文档上传内容未做 PII 脱敏（仅对话链路），文档切片进入向量库前未过滤敏感信息。
4. 危险工具拦截未实现：当前工具集无 bash/edit 等系统级工具。
5. 评测集为 8 题小样本、单一标注来源，指标用于回归而非学术评测。
6. setup-matt-pocock-skills 配置已写入 AGENTS.md 与 docs/agents/*（GitHub 追踪器、默认标签、单上下文域文档）。
7. 设计文档改版后，“阶段 I · S19”指会话管理；本文旧记录中的“S19 模型设置 / S20 用量统计”是旧编号，功能均已完成，勿混淆。
8. 会话标题采用本地规则（首条用户消息压缩至 ≤24 字），不额外调用 LLM 生成摘要，避免首轮延迟与成本。
9. Pi 会话不落 JSONL：SQLite 为唯一事实源，新建 Pi 会话时回放最近 24 条消息（单条 ≤8000 字），用户历史回放前再次 PII 脱敏。
10. 图片 OCR 不引入本地 tesseract：优先用同 Provider 的视觉模型识别（可 `LLM_OCR_MODEL` 指定模型）；没有可用视觉模型时直接拒绝图片并提示切换模型，不做假 OCR。
11. 图片压缩在前端完成（最长边 1600px、JPEG 0.85）；服务端只做 magic bytes 校验、8MB/4 张上限与 hash 去重，不做二次缩放。
12. 历史回放图片有上限：最近 2 条图片消息、最多 4 张、单张 ≤2MB；非视觉模型回放保存的 OCR 文本，避免重复 OCR。
13. ASR 采用 sherpa-onnx Paraformer 中文小模型（Node N-API，预编译），未用 faster-whisper：Docker 运行时没有 Python/ffmpeg，模型也不宜在构建时联网拉取；模型经 hf-mirror 下载到 server/models，不入 git。
14. TTS 默认使用浏览器 speechSynthesis（系统 SAPI 音色，默认优先本地中文音色，语速可调并持久化），未接 edge-tts/piper：当前 MaaS 没有 TTS 接口，本地再引入一套 TTS 模型收益低；`POST /api/tts` 保留 OpenAI 兼容服务端 TTS 配置（TTS_BASE_URL/TTS_MODEL/TTS_VOICE）。
15. 录音交互为点击开始/停止 + 波形/计时/取消（非按住说话）；录音在浏览器解码后重采样为 16k 单声道 WAV，服务端接受 8k~48kHz 并交给 sherpa 重采样。
16. 在线音色会把朗读文本发送到系统语音服务；UI 明确提示，默认选择本地音色。

遗留问题与风险：
- GitHub 直连依赖 SteamTools TLS 代理 + 仓库级 CA；gh 尚未登录，triage 标签未创建；本地历史与远程初始提交不相关，尚未推送
- 扫描版 PDF 未逐页 OCR；复盘识别无人工校对界面
- 引用卡片会累积低相关项；后台任务单 Worker 串行且失败无重试
- 会话搜索为 `LIKE`（标题/消息内容），消息量很大时无 FTS 索引；上下文回放只取最近 24 条，超长会话的早期细节可能丢失
- 同一会话内不同角色仍各用独立 Pi 会话，但会通过 SQLite 历史重建共享上下文；跨会话仅共享画像/记忆/掌握度
- 图片上传后若未发送或会话被删，文件暂为孤儿，等 S22 存储治理统一回收；当前没有单张删除接口
- 图片内容本身可能含提示注入；OCR 文本已加“仅作解题材料”包裹，但未做图像级内容审核
- HEIC 等格式依赖浏览器解码，无法解码时提示改用 JPG/PNG；OCR 会额外消耗一次模型调用（实测约 20s）
- ASR 模型约 82MB 且不入库：新环境/新镜像构建前必须 `npm run asr:model`，否则 `/api/asr` 返回 503 并提示
- 中文 Paraformer 不输出标点、无热词/自定义词表；识别结果进入输入框由用户校对后发送
- TTS 音色依赖操作系统语音包；在线 Natural 音色需要网络并会把文本发给系统语音服务；服务端 TTS 仅实现 OpenAI 兼容协议，未对真实云 TTS 做联调
- 麦克风需在 localhost 或 HTTPS 下使用；录音音频不落库（隐私优先），无法回放原始录音