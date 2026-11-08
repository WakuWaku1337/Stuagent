# 智学 实施进度

当前阶段：S23 性能优化第一批已完成（2026-11-08）；剩余全量压测与独立快模型路由

公开注册：S33 数据隔离完成后已恢复默认开放（`REGISTRATION_OPEN=1`）；如需收紧设置 `REGISTRATION_OPEN=0`

密码策略：注册、改密、管理员重置统一放宽为 6–128 位；README 已按 v0.30 重写（2026-11-08）

阶段 I · S23 性能优化第一批已完成（2026-11-08）
- 缓存：新增 SQLite `embedding_cache`、聊天答案缓存 `answer_cache`、检索语义缓存 `rag/cache.ts`；文档索引/删除时失效检索与答案缓存
- 检索：短查询跳过 Cross-Encoder；RRFRanker 结果直接使用；RAG 结果按账号语义缓存，命中直接返回
- 对话：短问题跳过路由模型直接进主讲；短问题默认低思考强度；历史回放从 24 条降到 16 条、单条截断 6000 字
- 压测：新增 `npm run bench:s23`（RAG 冷/热延迟、缓存命中；`--chat` 测 TTFT/P95）
- 实测：RAG 冷 965ms → 热 3.7ms（10/10 命中）；聊天冷 TTFT 3.2s → 缓存命中 17ms；答案缓存命中时 SSE 仍正常返回 conversation/route/citations/delta/done
- 验证：`check-isolation.ts` ALL PASS（含刚索引后的 RAG 可见性重试）；`check-auth.ts` ALL PASS；服务端类型检查无新增错误
- 剩余：独立“快模型”分级路由尚未接入（当前只做短问题路由跳过 + 低思考强度）；语义缓存目前是检索结果缓存，答案缓存为精确问题+上下文指纹；压测为小样本，未做并发/长会话压测

阶段 K · S34 账号管理与会话安全已完成（2026-11-08）
- 管理页：新增 `/admin`（侧栏「账号管理」，仅管理员可见/可进）；账号列表、建号、启停、改角色/联系方式、重置密码、临时密码展示与复制
- 会话与保护：停用账号立即撤销其全部会话；最后一名管理员不能停用或降级；管理员重置密码强制下次改密
- 审计：认证事件列表（登录、退出、建号、改密、重置、会话撤销等）
- 上线检查：新增 `/api/admin/system-check`，检查认证开关、管理员、注册入口、HTTPS/Cookie、最近备份；开发 HTTP 会显示“注意”
- 备份：新增 `npm run backup`，SQLite `VACUUM INTO data/backups/edu-*.db`，可选 `-- --with-uploads`
- 前端权限：`/admin`、`/settings`、`/mcp`、`/storage` 管理员路由守卫；普通用户侧栏只保留用量统计
- 验收：`check-admin.ts` ALL PASS（建号、临时密码、停用即失效、停用不能登录、重新启用、最后管理员保护、系统检查）；浏览器实测建号与临时密码弹层；`vue-tsc -b` 与 `npm run build` 通过
- 部署注意：HTTPS 证书、反向代理与 ICP 备案属于部署操作；当前检查在本地 HTTP 下会提示“注意”，公网部署需补齐

阶段 K · S33 多账号数据隔离已完成（2026-11-08）
- 请求上下文：新增 `learning/context.ts`（AsyncLocalStorage），`requireAuth` 注入当前 userId/learnerId/role；业务层不再使用全局 `DEFAULT_LEARNER`
- 数据库：documents/questions/exam_papers/courseware/media/visualizations/tasks/ocr_jobs 补 `learner_id`；`daily_practices` 改 `(learner_id, date)` 联合主键；documents/media hash 加账号前缀，预置可视化用 `__global__`
- 隔离范围：对话、记忆、错题、掌握度、测验、考试复盘、计划、每日练习、题库、资料/切片/OCR、媒体、可视化、课件、后台任务、用量全部按账号查询；管理员也不能读取他人内容
- RAG：Milvus 每账号独立 collection；首个账号沿用旧 `edu_chunks`，新账号 `edu_chunks_<id>`；`npm run auth:migrate` 只做检查，`-- --reindex` 才重建向量
- 权限：模型设置、MCP、存储治理后端 `requireAdmin`；侧栏隐藏、路由 `adminOnly` 拦截；普通用户只看到自己的用量
- 账号入口：S33 期间临时关闭公开注册；数据隔离完成后已恢复默认开放（`REGISTRATION_OPEN=1`），管理员仍可用 `npm run user:create` 建号、`auth:reset` 重置密码
- 验收：`check-auth.ts` ALL PASS（注册关闭时跳过注册项）；`check-isolation.ts` ALL PASS（设置权限、记忆、会话、资料、媒体、默认数据归属、RAG 全部通过）；浏览器实测普通用户侧栏无设置/MCP/存储，直接访问 /settings 被重定向；`vue-tsc -b` 与 `npm run build` 通过
- 注意：管理员账号页面仍属 S34；旧 default 数据自动归属首个管理员；迁移前建议备份 `edu.db` 与 `uploads/`

阶段 K · S32 账号认证与登录页已完成（2026-11-08）
- 后端：`users` / `sessions` / `auth_events` 表；scrypt 密码（N=32768、r=8、p=1、maxmem=64MB）；HttpOnly 会话 Cookie；登录限流与锁定；审计；首个管理员 `npm run auth:bootstrap`；管理员重置密码 `npm run auth:reset`
- 接口：`/api/auth/bootstrap|register|login|logout|me|password|sessions|sessions/:id|sessions/revoke-all`；`/api/admin/users|users/:id|users/:id/reset-password|audit`
- 前端：`/login`、`/register`、`/account`；auth store；路由守卫；401 拦截；账号菜单；SSE/WS 401 跳登录；未登录不探测业务接口
- 验收：`check-auth.ts` ALL PASS（注册、登录、me、会话、管理员权限、重置密码、强制改密、限流、退出）；`vue-tsc -b` 与 `npm run build` 通过；浏览器实测登录、注册、账号页、退出、受保护路由跳转、WebSocket 已连接
- 视觉：新增 `AuthLayout`，登录/注册复用主界面的暗色导航栏、纸面网格、宋体标题与蓝色主色；截图 `server/testdata/screens/auth-login.png`、`auth-register-form.png`、`auth-login-mobile.png`
- 注意：S32 完成时数据隔离尚未实现；该问题已由 S33 补齐。首个管理员需在真实数据目录运行 `npm run auth:bootstrap`
- 下一步：S34 管理员账号页面与上线最低检查

设计文档 v0.30：账号方案简化为用户名密码（2026-11-08；S32/S33/S34 已实施）
- 注册只填用户名、密码、手机号/邮箱（可选，不验证）；不做邮箱验证码、邮件找回、CAPTCHA、管理员 2FA、邀请码、按账号配额
- 保留：服务端会话 + HttpOnly Cookie、scrypt 密码、登录限流、数据隔离、管理员建号/停用/重置密码、HTTPS 与每日备份最低要求
- 任务编号：阶段 K · S32 用户名密码认证、S33 数据隔离与迁移、S34 账号管理与会话安全；里程碑 7 改为 S34，取消 S35
- 文档：§6.16 精简、§6.17 收敛为上线最低要求、§9.4 收敛为公网部署最低配置；§7.3 去掉 email_tokens/user_quotas/TOTP
- 下一步：未开始编码；实施顺序 S32 → S33 → S34

设计文档 v0.29（历史）：曾按公网个人网站标准扩展邮箱验证、邮件 DNS、CAPTCHA、2FA、配额与完整上线清单；因当前只需要简单登录，已在 v0.30 收回

设计文档 v0.28（历史）：初版账号方案，按本地单机口径设计；已被 v0.30 的简单账号密码方案取代
- 新增 §5.9 认证架构、§6.16 用户注册登录、§7.3 账号数据表与迁移；调整 §1.2/§1.4/§2/§3.1/§3.2/§10/§12
- 方案：服务端会话 + HttpOnly Cookie，密码用 Node `crypto.scrypt`；首个管理员 CLI 初始化；`learner_id = user_id` 实现个人数据隔离；模型密钥/MCP/存储为实例级仅管理员可操作
- 迁移要点：`daily_practices` 改联合主键、`documents` 改 `(learner_id, hash)` 唯一、Milvus 每账号独立 collection、`DEFAULT_LEARNER` 改为请求上下文

设计文档 v0.27：扫描件 OCR 切换到 Docling 主路径已完成（2026-11-08）
- 方案：Docling 作为扫描件唯一主路径，不再保留整篇自建兜底；`OCR_ENGINE=auto`（默认）走 docling-serve + 低置信/公式密集页视觉增强，`docling` 只用 Docling；旧逐页 OCR、RapidOCR 桥接与 `vision|local` 模式已删除（2026-11-08）
- 服务：compose 新增 `docling-serve`（profile `docling`，宿主 5001）；`npm run docling:up/down` 启停，`npm run docling:models` 下载公式模型到命名卷 `docling_models`。CPU 镜像压缩 2.1GB、本地展开 7.57GB，基础模型已内置；本机直连 GHCR/Quay 过慢，`docker/.env` 用南京大学镜像 `ghcr.nju.edu.cn/docling-project/docling-serve-cpu:latest`，可用官方的 `ghcr.io/docling-project/docling-serve-cpu:latest` 覆盖
- 适配：`server/src/documents/docling.ts` 提交 `/v1/convert/file/async`、轮询 `/v1/status/poll`、读取 `/v1/result`；请求 md+json、`md_page_break_placeholder`、`do_ocr`；按占位符切逐页 Markdown，逐页 confidence 取 `ocr_score`（layout 分低不再误判待校对）；成功后结果缓存 `uploads/ocr/<id>/docling.json`，重试复用；转换中途重启会重新提交
- 增强：OCR 置信度 <0.8 或单页未解码公式 ≥10 处的页面走视觉模型单页增强，engine 记为 `docling+vision`；视觉失败保留 Docling 结果。`OCR_VISION_FORMULA_MIN_MARKERS` 可调（0 关闭公式增强），`DOCLING_OCR_ENGINE`、`DOCLING_TIMEOUT_MS`、`DOCLING_POLL_MS` 可配
- 进度/前端：整篇转换期间任务显示“整篇解析中”；逐页原文图仍由 pdfjs 200 DPI 渲染供校对；旧逐页缓存与校对写回链路不变
- 验收：`check-docling.ts` 2 页样本 15.2s，p1 0.98 / p2 0.63；`check-ocr.ts` ALL PASS（p1 docling 0.98、p2 docling+vision，校对写回 5 切片并入库）；单页 PDF 走 JSON 降级，1 页 0.98；Docling 停服时任务明确失败并提示 `npm run docling:up`；旧链路删除后 `check-ocr` 仍 ALL PASS
- 108 页全链路（force 重试复用 Docling 缓存）：691s，82 页 docling + 26 页 docling+vision，0 页待校对，413 切片并 indexed；切片中 28 个含 Markdown 表格、136 个含 `[公式]`、114 个含 `[图]`
- Docker：重建镜像后 `APP_PORT=3100` 容器带 `DOCLING_URL=http://docling-serve:5001`，`check-ocr` ALL PASS；`regression.ts` ALL PASS；`vue-tsc -b` 通过
- 公式增强：模型 `ibm-granite/granite-docling-258M`（506MB）已通过 `npm run docling:models` 下载到命名卷 `docling_models`，容器重建保留；`do_formula_enrichment=true` 实测可用（公式占位 0、88 个 LaTeX 块），但 CPU 约 **82s/页**（2 页 163s）且部分 LaTeX 结构不稳，**默认关闭**，需 `DOCLING_FORMULA_ENRICHMENT=1` 显式启用；默认仍用视觉模型增强公式密集页
- 关键文件：`server/src/documents/docling.ts`、`server/src/documents/pdf-ocr.ts`、`server/scripts/check-docling.ts`、`docker/docker-compose.yml`、`web/src/views/DocumentsView.vue`

可视化改为题目内容确定性建模（2026-11-08）
- 移除 `visualize-engine.ts` 里的 `chatJson` 判定与 LLM 生成 spec；`POST /api/visualize/generate` 与对话自动可视化现在只走后端规则解析，不消耗模型调用
- 新增 `server/src/learning/visualize-modeler.ts`：函数表达式与交点/不等式/区间/参数滑块、圆锥曲线隐式方程、正方体/棱锥命名点/棱长/中点/定比分点/截面、直角三角形/矩形/圆等平面图形、常见分子式（H2O/CH4/NH3/CO2/C2H4/C2H2/C6H6/NaCl）、打印机进纸/斜面/串并联电路/透镜/水平面受力、动物/植物细胞
- 打印机进纸题会按题目生成滚轮、纸叠、摩擦片和层间摩擦箭头，不再返回无关的斜面预置图；正方体会按 `ABCD-A1B1C1D1`、`E 为 BB1 中点`、`过 A、C、E 的截面`、`棱长 2` 生成实际点/面
- 函数题按题目表达式建模：`y=x^2-4x+3` 生成二次曲线、零点和实际区间；两条函数加交点关系；不等式生成区域填充；椭圆/双曲线/抛物线用隐式方程
- 解析不到具体结构时返回 `matched: none` 并提示补充方程、点、尺寸或场景，不用固定预置图硬凑；纯主题问题才回退预置模板
- 前端 `/visualize` 文案改为“按题目内容本地解析建模”，列表标记“题目建模”，成功提示显示解析依据（如“解析到正方体棱长 2，9 个点”）；渲染器在 `labels:false` 时不再给线框点加文字
- 验收：`check-visualize.ts` ALL PASS（函数/双函数交点/正方体中点与截面/打印机进纸/分子式/无关题目拒绝/无 LLM 生成）；`check-s31.ts` ALL PASS；Edge 无头截图实际渲染打印机图、二次函数、椭圆、正方体截面；`vue-tsc -b && vite build` 通过
- 截图：`server/testdata/screens/viz-printer.png`、`viz-function.png`、`viz-conic.png`、`viz-cube.png`
- 限制：确定性解析不是通用 CAS/几何求解器，任意坐标系、复杂线面角证明、未收录分子和特殊物理装置需要补充解析规则或手动传 type+spec；等高线/三维函数仍以预置或手动 spec 为主

设计文档补做：扫描件 OCR（§6.8.8 / 第 14 章 S05）已完成（2026-11-08，以下为 v0.26 自建 OCR 记录；v0.27 已由 Docling 替换并删除旧链路，保留作历史）
- 判定：逐页提取文本 + OperatorList 大图覆盖率，正文 <30 字且整页图 ≥40% 记为需 OCR；需 OCR 页 ≥50% 判为图片型 PDF。实测 24.7MB / 108 页全位图资料：0 字、108/108 页需 OCR、判定 scanned=true；`testdata/chemistry.pdf` 等文本 PDF 仍走同步文本路径（200 parsed，2 切片）
- 渲染：`pdfjs-dist` + `@napi-rs/canvas`，默认 200 DPI（`OCR_DPI` 150–320）；页面 JPEG 落 `uploads/ocr/<id>/`，实测 1275×1651 的扫描页渲染为 3542×4587（约 0.56–0.97MB/页），原图接口可缓存读取
- 引擎：`OCR_ENGINE=auto|vision|local`。视觉模型整页输出 Markdown + LaTeX（本资料推荐）；本地 RapidOCR 经 `scripts/rapidocr_bridge.py` 接入，未安装时回退视觉模型；本地置信度低或公式密度高时升级视觉模型（`local+vision`）
- 质量分：模型自评 + 乱码/重复/“无法识别”惩罚 + 图像清晰度上限（拉普拉斯高频/灰度对比度）；实测清晰页 0.98–1.0，模糊页 0.10–0.15；默认阈值 0.8，低置信页状态 `review`，文档状态 `needs_review`
- 异步与缓存：`ocr_jobs` / `ocr_pages` 落库；逐页缓存、重启恢复 queued/running 任务；`OCR_CONCURRENCY` 默认 2、`OCR_TIMEOUT_MS` 默认 180s；进度接口返回 done/total、百分比、当前页与待校对页。实测第 2 页完成后杀掉服务再启动：running→queued 自动恢复，只补第 1 页，第 2 页 `updated_at` 未变（未重复识别）
- 校对写回：`GET /:id/ocr`、`GET /:id/ocr/pages/:page/image`、`PUT /:id/ocr/pages/:page`、`POST /:id/ocr/confirm`、`POST /:id/ocr/retry`；全部低置信页标记已校对后重新切片并灌库
- 前端：上传返回 202 `ocr_queued` 并提示“扫描件将进行 OCR，需几分钟”；列表显示待 OCR / OCR 中 / 待校对、页数进度条与校对入口；校对弹层左侧原文图、右侧 Markdown 编辑，保存草稿/标记已校对/写回重新入库；截图 `server/testdata/screens/documents-ocr-list.png`、`documents-ocr-review.png`
- 验收：`BASE_URL=http://localhost:3117 node --import jiti/register scripts/check-ocr.ts` ALL PASS（202 入队、2/2 页完成、原文图 561176 B、模糊页 0.10 待校对、写回 confirmed、5 切片、indexed 且切片含校对标记）；浏览器实测校对弹层图片 3542×4587、页 2 待校对、保存后重新入库；`vue-tsc -b && vite build` 通过
- 关键文件：`server/src/documents/pdf-ocr.ts`（判定/渲染/引擎/质量分/任务/写回）、`server/src/routes/documents.ts`（OCR 路由）、`server/src/store.ts`（ocr_jobs/ocr_pages）、`web/src/views/DocumentsView.vue`（进度与校对）、`server/scripts/{check-ocr.ts,rapidocr_bridge.py,make-scanned-pdf.mjs}`；新增依赖 `@napi-rs/canvas`

阶段 J · S17 补齐：§6.14 统一可视化引擎（交互课件 + 自动可视化合并）已完成（2026-11-08）
- 前端只保留一个入口 `/visualize`（统一可视化）；`/courseware` 重定向并保留 `?open=` 参数兼容旧链接，侧栏「交互课件」「自动可视化」两条合并为一条
- 统一渲染器：Three.js（geometry3d/function3d/terrain/biology）、function-plot（function2d/conic，含隐式曲线）、3Dmol（molecule）、内联 SVG（physics/diagram）；旧版单文件 HTML 课件只读，走沙箱 iframe
- 预置课件库 13 条 spec（`server/src/learning/visualize-presets.ts`）+ 关键词/学科匹配器；纯主题问题命中即复用固定 id `preset:<id>`，不重复建记录、不消耗模型调用
- 具体题目由 `visualize-modeler.ts` 按内容确定性建模；解析不到结构时不出图，不再调用模型判定或生成 spec
- spec 校验扩展：geometry3d `auxiliary`（9 种 kind + style/reason，逐条显隐）、function2d `functions/relations/regions/sliders`、molecule `format+data`、biology `parts`、terrain `grid|expression`、physics/diagram `elements` 词汇表
- 对话内自动判定：拍照或题目命中关键词时自动生成可视化，SSE 新增 `visualization` 事件，回答内嵌渲染器；可视化 id 落库到 `messages.visualization_id`，重开会话仍可见
- 工具合并：删除 `courseware_generate`（含 `courseware/service.ts`、`courseware/tool.ts`、`CoursewareView.vue`、`VizCanvas.vue`），`visualize_generate` 改为统一入口（可只给 question 走预置匹配，或给 type+spec 精确控制）
- 数据变更：`messages` 新增 `visualization_id` 列；预置可视化改用固定 id；清理了本次验证产生的 18 条重复预置记录（用户手工/生成/旧版课件未动）
- 新增依赖：web workspace `three@0.187`、`function-plot@1.26`、`3dmol@2.5.5`；渲染器打进 `VizRenderer` 独立 chunk（1.45 MB / gzip 391 KB），随路由懒加载
- Docker 修复（2026-11-08）：容器 SQLite 原放在 Windows bind mount（9p），`node:sqlite` 报 `disk I/O error` 无限重启；改为命名卷 `docker_app_data:/app/data`（`EDU_DATA_DIR=/app/data`），uploads 仍 bind mount。旧库先 `PRAGMA wal_checkpoint(TRUNCATE)` 再灌入卷；宿主端口支持 `APP_PORT` 覆盖（与 dev 的 3000 共存时用 3100）。实测 restarts=0、读写正常、重启后数据保留
- 首字体验修复（2026-11-08）：实测一次 chat 调用 100s（10.9k prompt、3.3k reasoning、6.5k completion），思考阶段没有 text_delta，界面长时间空白；另有首次请求撞上服务重启/主动中断时前端拿不到回复。修复：Pi 思考阶段下发 `thinking` 心跳（800ms 节流）；空回复时显示「模型正在思考」；收到 `done` 立即解除发送禁用，不再等自动可视化后处理；自动可视化现为本地规则建模，无额外模型等待
- 绘图链路修复（2026-11-08）：智能体改为手绘 ASCII 的根因是 `visualize_generate` 只收对象 spec，模型传 JSON 字符串就报「spec 必须是对象」。工具移入 `visualize-engine.ts`：spec 兼容对象/JSON 字符串；只传 question 时由 `visualize-modeler.ts` 解析具体结构建模，解析不到不出图；渲染端关系式 `f=g` 按图例标签解析，标记计算失败不再拖垮整张图
- 开发体验修复（2026-11-08）：`node --watch` 对 jiti 加载的模块不总是生效（改引擎代码不重启），server dev 脚本改为 `--watch-path=src`；同时清理了残留的孤儿 dev 进程（会占着 3000 导致新实例起不来、ASR/TTS 校验误报）
- 对话 UI（2026-11-08）：参考教材改为「参考资料」折叠区，默认收起、标题旁显示条数，展开时箭头旋转；移除重复的「输入中」三点指示，统一由空回复时的思考提示承担

历史：阶段 J · S31 3D 课件与机制收尾已完成（2026-11-07）
- 课件生成支持 2D/3D：立体几何、空间结构、分子等主题要求 canvas 3D 投影；失败回退内置 3D 模板（拖拽旋转、缩放、自动旋转、顶点/棱/面）
- `COURSEWARE_FORCE_TEMPLATE=1` 可强制模板，便于离线验收；3D 模板无任何外部脚本/CDN
- 新增长期记忆 Markdown 镜像 `data/memory/{id}.md` 与课件 HTML 镜像 `data/courseware/{id}.html`，删除时同步清理（SQLite 仍为事实源）
- 新增角色 Skills：tutor（socratic/mind/edulab）、quizzer（quiz-gen/mind）、analyst（mind）、solver（mind/edulab），Pi 可从角色 `.pi/skills` 发现
- Hooks 行为仍由代码等价实现（画像注入、工具写回、历史回放压缩）；未注册 Pi 自定义 hook 扩展
- 解题视频按设计 §3.2 不内置渲染管线，优先外部 MCP；本版本不提供视频生成

阶段 J · S30 题目驱动自动可视化已完成（2026-11-07）
- 新增 `visualizations` 表与 `/api/visualize`（列表/生成/读取/删除）；spec 校验覆盖 geometry3d、function2d/3d、conic 与通用类型
- 新增 `visualize_generate` 工具（Tutor/Solver）并注册；生成后返回 `/visualize?id=...` 链接
- 新增 `/visualize` 页面与 `VizCanvas`：函数曲线 SVG、立体几何可拖拽旋转/缩放/重置；其他类型展示 spec 预览
- 前端安全表达式求值（无 eval，支持 + - * / ^、sin/cos/sqrt/log/ln/exp 等）
- 新增 `scripts/check-visualize.ts` 隔离校验

阶段 J · S29 MCP 自选接入已完成（2026-11-07）
- 新增 `mcp_servers` 表与 MCP 服务：stdio / HTTP / SSE，env/headers AES 加密存储，接口只回键名
- 新增 `/api/mcp/servers`（列表/添加/编辑/启停/删除/连接测试）、`/api/mcp/tools`、单工具授权接口
- 连接测试发现工具并缓存；工具以 `mcp__服务__工具` 注册为 Pi customTools，Tutor/Quizzer/Analyst/Solver 已允许 `mcp__*`
- 新增 `/mcp` 管理页：添加向导、连接状态、工具授权、编辑/删除与安全提示
- 同步 `data/pi-agent/mcp.json` 供 Pi 原生 MCP 使用；新增 `scripts/check-mcp.ts` 与本地 mock MCP 服务

阶段 J · S28 难度校准与复习提醒已完成（2026-11-07）
- 新增 `recommendDifficulty`：按知识点 BKT 掌握度推荐基础（<50%）/中等（50–75%）/拔高（≥75%）；无数据默认中等
- `quiz.generate` 难度省略或 `auto` 时自动采用推荐难度，响应返回 `difficulty/recommended_difficulty/mastery`；新增 `GET /api/quiz/difficulty`
- QuizView 难度新增“推荐”选项与掌握度提示；`quiz_generate` 工具描述同步
- 复习提醒：App 启动探测到期错题，顶栏显示“待复习 N”，每天首次打开弹出应用内提醒（localStorage 按日去重）

阶段 J · S27 文件夹批量导入已完成（2026-11-07）
- 资料库支持文件夹选择（`webkitdirectory`）与拖拽文件夹，递归收集 PDF/Word/TXT/Markdown；前端按 20 个/批上传，单次最多 100 个/300MB
- 新增 `POST /api/documents/batch`（与 `/api/documents` 共用处理）：`paths` 传相对路径，后端限制 50 个/200MB，逐文件返回状态
- documents 新增 `source_path`；相对路径作为章节前缀写入切片（如 `数学 / 函数 / ...`），资料列表展示路径并支持搜索
- 新增 `scripts/check-documents.ts` 隔离校验（路径规范化、source_path、章节元数据）
- `EDU_UPLOADS_DIR` 可用于隔离测试上传目录

阶段 J · S26 每日练习已完成（2026-11-07）
- 新增 `daily_practices` 表与每日练习服务：每天一组 5 题，优先掌握度薄弱点与到期错题；题库已有题目优先复用，不足时再生成
- 新增 `GET /api/daily`、`POST /api/daily/start`、`POST /api/daily/answer`：按日幂等、逐题作答、完成时联动掌握度/错题本，并统计连续天数与 7 日记录
- QuizView 新增“每日练习”卡：今日重点、完成度、连续天数、开始/继续/已完成状态；每日作答走独立提交入口
- 新增 `scripts/check-daily.ts` 隔离数据目录校验

阶段 J · S25 回复完整性已完成（2026-11-07）
- 截断判定：读取 Pi `stopReason=length`，并检查代码围栏、括号与悬空结尾标点
- 自动续写：携带断点末尾提示从断点继续，最多 3 次；重叠片段去重拼接；续写期间继续累计 usage
- PI 会话控制：续写前 `waitForIdle`，订阅保持到续写结束，避免尾部分片与续写并发
- 手动兜底：`POST /api/conversations/:id/messages` 支持 `continue:true`（新增续写气泡）与 `regenerate:true`（替换最后一条回复）
- SSE 新增 `continuation` / `incomplete` 事件；前端最后一条回复下方显示“继续生成 / 重新生成”，截断提示保留到刷新
- 新增 `server/scripts/check-continuation.ts` 纯函数校验

阶段 J · S24 学习计划已完成（2026-11-07）
- 新增 `learning_plans` 表与计划服务：按目标/天数/每日时长生成每日任务，自动引用薄弱知识点、到期错题与同学科资料
- 新增 `GET /api/plan`、`POST /api/plan/generate`、`PUT /api/plan/:id`、`PUT /api/plan/:id/tasks/:taskId`、`POST /api/plan/:id/archive`、`DELETE /api/plan/:id`
- 新增 `plan_make` 工具（Tutor/Analyst 可用）；生成新计划自动归档旧计划，任务勾选实时计算进度，全部完成标记 completed
- 新增 `/plan` 学习计划页：目标与重点、完成度仪表盘、每日任务清单、计划依据、归档历史、生成/调整弹层；侧栏“学习”新增入口
- 新环境变量 `EDU_DATA_DIR`：数据目录可覆盖，用于隔离测试（默认仍为 server/data）

阶段 I · S22 存储治理已完成（2026-11-07）
- 新增存储服务：`GET /api/media/storage` 汇总图片/资料占用、磁盘文件、数据库体积、配额状态与 80%/95%/100% 分级告警
- 新增 `POST /api/media/cleanup`：孤儿文件预检/回收（未被消息引用的图片记录、无登记记录的上传文件）、按保留期清理、清理审计记录
- 配额：默认 1024MB（`STORAGE_QUOTA_MB`，0 关闭），超出时新上传返回 507 `STORAGE_QUOTA_EXCEEDED`（图片与资料统一）
- 删除会话时回收仅被该会话引用的图片；删除资料时连同上传的原始文件一起清理
- 周期清理：按 `STORAGE_CLEANUP_HOURS`（默认 24h）回收早于 `STORAGE_RETENTION_DAYS`（默认 30 天）的孤儿文件
- UI：`/storage` 存储治理页（用量概览、配额进度、占用构成、预检与清理、清理记录、策略），侧栏“系统”新增入口

阶段 I · S21 语音能力已完成（2026-11-07）
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

历史：H 进阶、安全与收尾 —— 已完成（S17 统一可视化与安全、S18 验收通过）；已增加 Docker 本地部署
旧编号 S19/S20（模型设置、用量统计）已于 2026-11-07 完成，见下方验收证据
已完成：S01–S22 与 S24–S31（A–H + 阶段 I 的 S19–S22 + 阶段 J 扩展批次），以及设计文档 v0.27 的 Docling 扫描件迁移；S23 性能优化与压测尚未实施
下一步：阶段 I · S23 性能优化与压测（里程碑 6：TTFT/P95 达标、语义缓存生效）；解题视频按 §3.2 外接 MCP 后置，不在本期自研

关键文件/接口：
- server/src/learning/visualize-presets.ts：13 条预置可视化 spec 与关键词/学科匹配器
- server/src/learning/visualize-engine.ts：统一生成入口（题目确定性建模 → 纯主题回退预置 → 不出图）与自动判定关键词
- server/src/learning/visualize-modeler.ts：函数/圆锥曲线/立体几何/分子/物理/生物题目的规则解析与 spec 生成
- server/src/learning/visualize.ts：spec 校验（auxiliary/functions/relations/regions/sliders/molecule/biology/terrain/elements）、统一列表/读取/删除（含 legacy 课件）、固定 id `preset:<id>` 去重
- server/src/courseware/legacy.ts：旧版单文件 HTML 课件只读访问（列表/取 HTML/删除）
- server/src/routes/visualize.ts：`/api/visualize` 与 `/api/visualize/generate`
- server/src/routes/courseware.ts：兼容门面（列表转统一、生成转引擎、`/:id` 仍返回 legacy HTML 并带 CSP）
- server/src/chat/handler.ts：回答后自动判定并落库 `messages.visualization_id`，SSE `visualization` 事件
- web/src/components/VizRenderer.vue：统一分发器 + 工具条（重置/自动旋转/辅助线/标注/全屏/截图）
- web/src/components/viz/{ThreeScene,FunctionChart,MoleculeChart,ShapeSvg,LegacyFrame}.vue：共用渲染器
- web/src/components/InlineViz.vue：对话内嵌可视化（实时事件或按 visualization_id 回捞）
- web/src/views/VisualizeView.vue：统一可视化页（题目生成 + 手工新建 + 合并列表）
- 已删除（2026-11-08 合并）：server/src/courseware/service.ts（单文件 HTML 生成）、server/src/courseware/tool.ts（courseware_generate 工具）、web/src/views/CoursewareView.vue、web/src/components/VizCanvas.vue
- server/src/learning/memory.ts：记忆写入/删除的 Markdown 镜像
- server/agent-workspace/roles/*/.pi/skills/*/SKILL.md：socratic / quiz-gen / mind / edulab 技能
- server/scripts/check-s31.ts：技能发现、3D 模板与文件镜像校验
- server/src/learning/visualize.ts：可视化类型/spec 校验/存储/删除与 visualize_generate 工具
- server/src/routes/visualize.ts：/api/visualize 系列接口
- web/src/views/VisualizeView.vue + web/src/components/viz/* + web/src/utils/{visualize,expression}.ts：统一可视化页、四类共用渲染器与安全表达式求值（原 VizCanvas.vue 已并入）
- server/scripts/check-visualize.ts：spec 校验与表达式求值校验
- server/src/mcp/service.ts：MCP 配置/密钥、stdio/HTTP/SSE 连接、工具发现/授权/调用、Pi 工具注册与 mcp.json 同步
- server/src/routes/mcp.ts：/api/mcp/servers 与工具接口
- web/src/views/McpView.vue + web/src/api/mcp.ts：MCP 管理页与客户端
- server/scripts/check-mcp.ts + scripts/mock-mcp-server.mjs：MCP 全链路隔离校验与本地 mock
- server/src/learning/quiz.ts：recommendDifficulty 与 generateQuiz 自动难度
- server/src/routes/learning.ts：GET /api/quiz/difficulty；generate 返回推荐/实际难度
- web/src/views/QuizView.vue：推荐难度选项与掌握度提示
- web/src/App.vue：到期错题探测、顶栏待复习徽标与每日应用内提醒
- server/scripts/check-difficulty.ts：掌握度阈值校验
- server/src/routes/documents.ts：/api/documents 与 /api/documents/batch（paths 相对路径、50 文件/200MB 限制）
- server/src/documents/service.ts：source_path 归一化、文件夹章节前缀、解析/重解析复用
- server/src/store.ts：documents.source_path 列与迁移
- web/src/views/DocumentsView.vue：文件夹选择/拖拽、分批上传、路径展示与搜索
- server/scripts/check-documents.ts：文件夹路径与章节元数据校验
- server/src/learning/daily.ts：每日选题（薄弱点/到期错题/题库优先）、幂等开始、逐题作答、完成结算、连续天数与历史
- server/src/routes/daily.ts：/api/daily 系列接口
- web/src/api/daily.ts + web/src/views/QuizView.vue：今日练习卡与每日作答流程
- server/scripts/check-daily.ts：每日练习隔离校验
- server/src/chat/integrity.ts：截断判定、重叠续写拼接、自动/手动续写提示词
- server/src/pi.ts：stopReason 捕获、自动续写循环（≤3）、waitForIdle 与订阅生命周期
- server/src/chat/handler.ts：continue/regenerate 分支、续写落库与替换旧回复
- server/src/conversations/service.ts：lastMessageByRole / deleteMessage
- web/src/api/chat.ts + web/src/stores/chat.ts + web/src/views/ChatView.vue：continuation/incomplete 事件、继续生成/重新生成按钮与截断标记保留
- server/scripts/check-continuation.ts：截断/拼接/提示词校验
- server/src/learning/plan.ts：计划生成（薄弱点/错题/资料依据）、查询、调整、任务勾选、进度、归档与校验
- server/src/routes/plan.ts：/api/plan 全套接口（生成/调整/任务/归档/删除）
- server/src/learning/tools.ts：plan_make 工具；server/src/agents/roles.ts：Tutor/Analyst 注册
- web/src/views/PlanView.vue：计划页（仪表盘、每日任务、依据、历史、生成/调整弹层）
- web/src/api/plan.ts：计划客户端
- server/scripts/check-plan.ts：隔离数据目录的计划闭环脚本（生成/勾选/调整/完成/归档/校验）
- server/src/storage/service.ts：存储扫描（媒体/资料/磁盘/缺失文件）、孤儿候选、清理执行、审计记录、周期任务
- server/src/storage/quota.ts：配额配置（STORAGE_QUOTA_MB/RETENTION_DAYS/CLEANUP_HOURS）、分级告警与上传前校验
- server/src/storage/refs.ts：消息附件引用集、会话媒体 ID 收集
- server/src/storage/paths.ts：uploads/media 路径统一出口
- server/src/routes/media.ts：GET /api/media/storage、POST /api/media/cleanup、上传配额校验
- server/src/media/service.ts：removeMedia/releaseUnreferencedMedia；会话删除后释放未引用图片
- server/src/conversations/service.ts + server/src/routes/conversations.ts：删除会话时收集附件并返回回收统计
- server/src/documents/service.ts + server/src/routes/documents.ts：删除资料时移除上传文件；资料上传配额校验
- server/src/store.ts：storage_cleanups 审计表
- server/src/index.ts：启动周期清理（setInterval，unref）
- web/src/views/StorageView.vue：存储治理页（配额轨道、占用构成、预检/确认清理、记录与策略）
- web/src/api/storage.ts：存储统计与清理客户端
- server/scripts/check-storage.ts：级联删除、资料文件清理、保留期清理、配额守卫端到端脚本
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
- server/scripts/regression.ts：全流程回归（40 项，含设置/用量 5 项、会话 7 项、图片 4 项、存储 4 项、语音 4 项）
- server/scripts/check-security.ts：安全单测（PII/密钥/注入/流式脱敏）
- web/src/views/CoursewareView.vue：课件页（生成、列表、沙箱 iframe 预览）；路由 /courseware

验收证据（2026-11-08 实测 · §6.14 统一可视化）：
- 单入口：侧栏只剩「统一可视化」一条；`/courseware` 自动重定向到 `/visualize`，`?open=<旧课件id>` 仍可定位到 legacy 项
- 预置命中不耗模型：`POST /api/visualize/generate {"question":"水分子的空间构型"}` 连续 3 次返回同一 id `preset:water-molecule`，列表只 1 条（合并前每次新建记录，已修）
- 预置匹配器：「正方体截面」命中 cube-section，「今天天气不错」不命中（check-s31 断言）
- Three.js：正方体与截面 canvas 截图 dataURL 34,890 字符，点「辅助线/截面」后变为 31,630（截面平面确实被显隐）；工具条 6 个按钮（重置视角/自动旋转/辅助线/标注/全屏/截图）齐全；截图提示「截图已下载」
- function-plot：二次函数与直线交点渲染出 1 个区域填充 path + 4 个标记点（2 交点 + 2 零点），图例两条函数可勾选显隐，无报错
- 3Dmol：水分子 preset 渲染出 WebGL canvas，无控制台错误
- SVG 物理：斜面受力 preset 渲染 5 条线、3 条带箭头受力线、6 段标注
- 对话自动判定：问「斜面受力分析…不用画图」，模型未调工具时 SSE 发出 `visualization` 事件（matched=preset）；模型自己调 `visualize_generate` 时按链接复用同一条，不重复生成
- 持久化：`messages.visualization_id` 落库，重开会话 `/chat?c=...` 仍内嵌渲染出受力图（5 线/3 箭头）并带「在统一可视化中打开」链接
- 回归与校验：`regression.ts` ALL PASS、`check-s31.ts` 15/15 ALL PASS、`check-visualize.ts` ALL PASS；`vue-tsc -b && vite build` 通过；825px 宽度 `scrollWidth == innerWidth` 无横向溢出，控制台无错误
- 依赖体积：`VizRenderer` 独立 chunk 1.45 MB（gzip 391 KB），随 `/visualize` 与 `/chat` 路由懒加载

验收证据（2026-11-07 实测）：
- S31 3D 课件：强制模板生成“正方体截面 · 3D 交互课件”；浏览器 canvas 非白像素 25,723，拖拽后像素哈希变化（旋转生效），无 `script[src]`/外链，缩放滑块存在
- S31 机制：`check-s31.ts` 8/8 PASS（四个角色的 SKILL.md 发现、3D 模板、记忆 Markdown 镜像、课件 HTML 镜像与删除清理；脚本原名 check-s30.ts）
- S31 存储：记忆写入生成 `data/memory/{id}.md`，删除同步移除；课件生成 `data/courseware/{id}.html`，删除同步移除
- S31 Docker：镜像重建后全量回归 45/45 PASS；`/api/courseware` 返回 3D 课件，HTML 含“3D 交互课件”；`:3000` 正常
- S30 可视化 API：function2d（x^2-4，[-6,6]）与 geometry3d（正方体 8 点/12 棱/2 面）创建均 201；列表返回 2 条；浏览器函数曲线 SVG path 6668 字符；几何体 12 条棱、2 个面，拖动后坐标变化（旋转生效）
- S30 UI：/visualize 在 1440/500 宽度正常，无控制台错误；函数页显示表达式与区间，几何页显示点数/棱数
- S30 隔离校验：`scripts/check-visualize.ts` 11/11 PASS（表达式、创建、几何、校验、工具、删除）
- S29 MCP 连接：本地 mock stdio 服务连接 687ms，发现 echo / sum 两个工具；工具调用 `echo:hello` 正确；禁用 echo 后调用返回 MCP_TOOL_DISABLED
- S29 MCP 智能体：对话中 Solver 实际调用 `mcp__mock__sum(a=2,b=3)` 并返回 5；Tutor 会话可见 `mcp__mock__sum` 且不可见已禁用的 echo
- S29 MCP 管理页：卡片显示已连接/本地 stdio/工具 2/2，工具授权勾选可实时落库；1440/500 宽度正常，无控制台错误
- S29 隔离校验：`scripts/check-mcp.ts` 9/9 PASS（加密、连接发现、调用、授权、Pi 工具注册、mcp.json 同步/删除）
- S28 难度校准：勾股定理掌握度 99.9% → 推荐拔高；无记录知识点 → 中等；低/中/高掌握度分别推荐基础/中等/拔高（check-difficulty 4/4 PASS）；自动难度生成实际返回 `difficulty=拔高`、2 道题
- S28 复习提醒：页面加载后顶栏显示“待复习 6”，并弹出“今日复习提醒：有 6 道错题到期”；同日去重；无控制台错误
- S27 文件夹导入：API `POST /api/documents/batch` 上传 2 个文件并携带 `paths=["数学/函数/a.txt","数学/函数/b.txt"]`，均 parsed；文档 `source_path` 正确，切片章节为 `数学 / 函数`；删除后文档与文件清理
- S27 前端：资料页显示“导入文件夹”按钮、隐藏 `webkitdirectory` 输入与拖拽区域；浏览器模拟选择 2 个文件后提示“2 个文件已接收”，列表刷新；无控制台错误
- S27 隔离校验：`scripts/check-documents.ts` 7/7 PASS（路径规范化、source_path、章节元数据、Markdown）
- S26 每日练习：题库 30 题环境下开始今日练习生成 5 题（薄弱点+错题优先），重复开始幂等复用；浏览器作答 1 题后进度 1/5，剩余题目完成后 5/5、正确率 60%、连续 1 天；每日历史记录 1 条
- S26 隔离校验：`scripts/check-daily.ts` 14/14 PASS（空状态、开始/幂等、逐题完成、完成后拒绝再答、连续天数、历史）
- S26 回归：`scripts/regression.ts` 42/42 PASS（新增 daily endpoint）
- S25 自动续写：本地 mock OpenAI（每次 finish_reason=length）实测 3 次 continuation + incomplete 事件；最终 answer 2487 字符、包含 4 段模型输出；落库 2 条消息（user + assistant）
- S25 手动继续：对已有回答调用 `continue:true` 流式接口，SSE 正常 delta/done，消息总数 2→3，且没有新增 user 消息
- S25 重新生成：调用 `regenerate:true`，旧 assistant 被替换，消息总数保持 3；旧回答不残留
- S25 前端：浏览器触发截断后显示“输出可能被截断 / 继续生成 / 重新生成”；点击继续生成后消息行 2→3，点击重新生成后保持 3 行
- S25 纯函数：`scripts/check-continuation.ts` 10/10 PASS（围栏/括号/冒号、重叠拼接、提示词）
- S24 计划生成：目标“两周补完函数基础，期末数学提高15分”生成 7 天计划，引用 8 个薄弱点、6 道到期错题与同学科资料；调整为 14 天后 50 项任务、进度归零；任务勾选后进度 0%→3%，全部完成时 status=completed；归档后 GET 返回空计划并进入历史
- S24 计划校验：空目标 / 天数 0 / 每日 5 分钟 / 编辑已归档计划分别返回 PLAN_GOAL_REQUIRED / PLAN_DAYS_RANGE / PLAN_MINUTES_RANGE / PLAN_ARCHIVED；check-plan.ts 13/13 PASS
- S24 计划 UI：390/500 与桌面宽度无横向溢出；计划页显示目标、重点、仪表盘、14 天任务、依据与历史；勾选任务实时更新进度；调整弹层预填并经 UI 保存成功（目标改为提高20分）
- S24 回归：`scripts/regression.ts` 41/41 PASS（新增 plan endpoint）；开发实例 3100 实测
- S22 用量统计：`GET /api/media/storage` 返回配额 1024MB、已用 21.7MB（2.1%）、资料 4 份（2 PDF / 1 MD / 1 TXT）、磁盘 4 个文件；清理前另有 3 条孤儿图片（113,474B）被识别
- S22 清理：预检返回 3 个可回收文件 / 271KB；执行后移除图片记录 2 个、资料文件 1 个，释放 271KB，孤儿归零，`storage_cleanups` 新增一条记录并在 UI 清理记录中可见
- S22 删会话级联：上传 40,322B PNG 并写入带附件的测试会话；`DELETE /api/conversations/:id` 返回 `media_removed=1`、`bytes_freed=40322`，随后 `GET /api/media/:id` 返回 404，磁盘文件同步删除
- S22 资料清理：上传 27B TXT 后文件存在，`DELETE /api/documents/:id` 后上传文件消失，磁盘文件数由 5 降到 4，无新增未跟踪文件
- S22 按保留期清理：构造 2,048B 孤儿文件并将 mtime 回拨 3 天；`mode=retention&olderThanDays=1` 预检命中 1 项且不删除，执行后文件被移除并记录释放 2,048B
- S22 配额：以 `STORAGE_QUOTA_MB=1` 启动测试实例，配额状态 `exceeded`（2167.5%）；图片上传返回 507 `STORAGE_QUOTA_EXCEEDED`，唯一 TXT 资料上传同样返回 507
- S22 配额分级：按当前 21.68MB 占用实测 27MB→warning 80.3%、22.5MB→warning 94.2%、22.1MB→critical 98.5%、21MB→exceeded 103.2%、0→unlimited
- S22 UI：`/storage` 在 1440/768/390 宽度下 `scrollWidth = innerWidth`；预检列表、确认弹层（3 个文件 / 271KB）、执行结果与清理记录均正常；768 宽度指标卡为 2×2；无控制台错误
- S22 回归：`scripts/regression.ts` 40/40 PASS（开发实例 3100 与 Docker 3000 各跑一次）；`scripts/check-storage.ts` 9/9 PASS（统计、引用、级联、资料文件、保留期预检/执行、配额、审计）
- S22 Docker：镜像重建后 `/api/media/storage` 与 `/storage` 正常，容器内路径为 `/app/server/uploads`；日志输出“周期清理已启用：每 24 小时回收早于 30 天的孤儿文件”
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
- Docker（本地试用，2026-11-08 更新）：`docker compose -f docker/docker-compose.yml up -d --build`；访问 http://localhost:3000，与 dev 冲突时 `APP_PORT=3100 ... up -d edu-agent`；SQLite/记忆/课件在命名卷 `app_data`（`/app/data`），uploads 仍挂载 `server/uploads`；容器内 Milvus 地址 milvus:19530；实测 health、SPA、会话读写、旧课件 HTML、重启数据保留正常
- 回归：cd server && node --import jiti/register scripts/regression.ts；评测：scripts/eval-rag.ts；安全单测：scripts/check-security.ts；图片问答：scripts/check-vision.ts；语音：scripts/check-voice.ts；存储治理：scripts/check-storage.ts（建议先启动服务，BASE_URL 可覆盖）
- 存储治理配置：STORAGE_QUOTA_MB（默认 1024，0 关闭）、STORAGE_RETENTION_DAYS（默认 30）、STORAGE_CLEANUP_HOURS（默认 24，0 关闭）
- 语音模型：npm run asr:model（下载到 server/models，约 82MB；不入库；Docker 构建前需先下载）

关键决策与偏离（需评审知悉）：
1. 安全为自研轻量策略（规则 + 脱敏 + 流式过滤），未接入 SuperAgent 安全 SDK（设计与 §4.3 均标注其为 P2 可选）。
2. 课件未移植 edulab 工程；2026-11-08 按 §6.14 合并为统一可视化引擎后，不再由 LLM 生成单文件 HTML，也不再让模型生成 spec，改为「按题目内容确定性建模 → 纯主题回退预置 → 解析不到不出图」，由 Three.js/function-plot/3Dmol/SVG 共用渲染器渲染；旧的单文件 HTML 课件保留为只读 legacy 项（沙箱 iframe + CSP），不再生成新的 HTML 课件。
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
17. 存储配额只限制“新上传”（图片/资料统一返回 507），不回溯删除已有文件；默认 1024MB，`STORAGE_QUOTA_MB=0` 关闭；告警阈值为 80%/95%/100%。
18. 孤儿定义：未被任何消息 attachments 引用的 media 行，以及 uploads 中无 DB 记录的文件；清理永不删除被引用图片。按保留期清理只回收超过保留期的孤儿，避免误删刚上传但尚未发送的图片。
19. 会话删除仅在图片不再被其他消息引用时才物理删除；资料删除直接移除上传原始文件。周期清理任务随服务启动注册，首次执行在间隔到期后（默认 24h），不在启动瞬间扫描。
20. 2026-11-08 按设计文档（13.4 任务表 + 第 14 章）重排编号：S23 归「性能优化与压测」（尚未实施），原 S23–S30 八项已完成扩展顺延为 S24–S31。对照：学习计划 S23→S24、回复完整性 S24→S25、每日练习 S25→S26、文件夹导入 S26→S27、难度校准与复习提醒 S27→S28、MCP S28→S29、自动可视化 S29→S30、3D 课件/技能/存储镜像 S30→S31；`scripts/check-s30.ts` 同步更名 `check-s31.ts`。git 历史只到 S21（e52ee3b），S22 之后的实现尚未提交；本次重排只改文档与脚本名，不改写历史。文档 13.3 路线图把 J 标为「性能优化压测」，与 13.4/第 14 章将 S23 归入阶段 I 自相矛盾；本表以任务表为准（S23 属阶段 I，阶段 J 为扩展批次），建议把 13.3 的 J 节点改名为「J 扩展与体验收尾」。

设计文档功能审计（2026-11-07，对照 §3.1/§5.8.2/§6.1–§6.14）：
- 已覆盖：S01–S22、S24–S31；P0/P1 主链路全部落地，P2 安全、统一可视化（§6.14 已合并落地）、MCP 已完成，回归 45/45 PASS。
- 已完成｜扫描件 OCR（§6.8 / 设计文档 v0.27）：Docling 主路径 + 低置信/公式密集页视觉增强已落地（2026-11-08）。
- 待做｜性能优化与压测（S23，§6.15 + 第 14 章 S23）：语义缓存、模型分级路由、上下文精简、Cross-Encoder 裁剪与 TTFT/P95 压测尚未实施，对应里程碑 6（延迟达标）。P0 提速措施（流式、快模型、精简上下文）自 S04 起已在执行。
- 已完成｜学习计划（S24）、回复完整性（S25）、每日练习（S26）、文件夹导入（S27）、难度校准与复习提醒（S28）、MCP（S29）、自动可视化（S30）、3D 课件/技能/存储镜像（S31）。
- 未实现（主动裁剪）｜解题视频（§3.1 P2）：§3.2 明确完整视频管线不在本期自研，优先外部 MCP；本版本不提供视频生成。
- 机制差异｜Hooks（§6.4）：画像注入、工具写回、历史回放压缩由代码等价实现，未注册 Pi 自定义 hook 扩展；MCP 服务由自研 SDK 客户端直接注册为 customTools，未使用 Pi 内置 MCP 扩展。
- 机制差异｜自动可视化其他类型（2026-11-08 更新）：molecule 已用 3Dmol、geometry3d/function3d/terrain/biology 已用 Three.js、function2d/conic 已用 function-plot、physics/diagram 用内联 SVG 词汇表；仍未引入 GeoGebra 与外部预置 3D 模型库（biology 用球体+标注近似细胞结构），edulab 工程未移植，预置库改为自研 13 条 spec。
- 存储策略｜§7.2：SQLite 仍为事实源，长期记忆与课件额外镜像为 Markdown/HTML 文件，兼顾查看与迁移。

遗留问题与风险：
- GitHub 直连依赖 SteamTools TLS 代理 + 仓库级 CA；gh 尚未登录，triage 标签未创建；本地历史与远程初始提交不相关，尚未推送
- 复盘识别暂无人工校对界面（扫描件 OCR 已有逐页校对；复盘题图识别仍未接入）
- 扫描件 OCR 依赖 docling-serve：未启动时扫描件上传直接失败并提示 `npm run docling:up`；CPU 版 108 页实测约 317s、峰值内存约 4.3GB，长文档需排队等待
- 公式增强默认关闭：`granite-docling-258M` 可下载，但 CPU 约 82s/页且 LaTeX 偶有结构错乱；默认靠视觉模型补公式密集页（≥10 处占位），整本书可能触发较多视觉调用（可用 `OCR_VISION_FORMULA_MIN_MARKERS` 调整）
- Docling 转换任务不跨服务重启续跑：只在成功后写 `docling.json` 缓存，服务中途重启会重新提交整篇转换
- 国内直连 GHCR/Quay 很慢：本机 `docker/.env` 使用南京大学镜像；换环境可改 `DOCLING_IMAGE`
- OCR 页面原图按 200 DPI 保存（模糊扫描页实测约 0.56–0.97MB/页），大批量扫描件会明显增加 uploads 占用；删除资料会同步清理 OCR 原图与 Docling 缓存
- 参考资料会累积低相关项；后台任务单 Worker 串行且失败无重试
- 会话搜索为 `LIKE`（标题/消息内容），消息量很大时无 FTS 索引；上下文回放只取最近 24 条，超长会话的早期细节可能丢失
- 同一会话内不同角色仍各用独立 Pi 会话，但会通过 SQLite 历史重建共享上下文；跨会话仅共享画像/记忆/掌握度
- 媒体暂无单张删除接口；未发送的图片可在存储治理页立即回收，或等周期清理（默认保留 30 天）
- 存储清理为物理删除且不可撤销；UI 已提供预检与确认，但仍无法撤销误清理
- 配额按数据库登记的逻辑大小统计；未登记孤儿单独列在“可回收文件”中，不计入配额占比
- 周期清理只在当前服务进程内运行；本地单实例场景足够，多实例部署会重复扫描
- 图片内容本身可能含提示注入；OCR 文本已加“仅作解题材料”包裹，但未做图像级内容审核
- HEIC 等格式依赖浏览器解码，无法解码时提示改用 JPG/PNG；OCR 会额外消耗一次模型调用（实测约 20s）
- ASR 模型约 82MB 且不入库：新环境/新镜像构建前必须 `npm run asr:model`，否则 `/api/asr` 返回 503 并提示
- 中文 Paraformer 不输出标点、无热词/自定义词表；识别结果进入输入框由用户校对后发送
- TTS 音色依赖操作系统语音包；在线 Natural 音色需要网络并会把文本发给系统语音服务；服务端 TTS 仅实现 OpenAI 兼容协议，未对真实云 TTS 做联调
- 麦克风需在 localhost 或 HTTPS 下使用；录音音频不落库（隐私优先），无法回放原始录音

待做：阶段 I · S23 性能优化与压测（设计文档 13.4 / 13.5 里程碑 6 / 第 14 章 S23 / §6.15）
- 前置：S22 存储治理（已完成）
- 目标：响应延迟达标、缓存生效
- 步骤：
  1. 语义缓存（相似问题命中）、prompt 精确缓存与 embedding 缓存
  2. 模型分级路由（快模型默认、思考强度调低）与上下文精简（RAG Top 3–5、历史摘要截断）
  3. 简单查询跳过 Cross-Encoder，减少 agent 层数，工具并行调用
  4. 配置就近节点与连接池，用 §6.10 用量数据压测 TTFT 与端到端 P50/P95
- 产出：缓存与路由模块、性能压测报告
- 验收：TTFT/P95 达标，缓存命中可秒回
- 贯穿性要求：P0 提速措施（流式、快模型、精简上下文）自 S04 起即执行，S23 只做集中优化与压测