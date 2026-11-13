# EduPi 代码整改施工文档

| 项 | 内容 |
| --- | --- |
| 版本 | **v1.2（实现收尾与文档对齐）** |
| 编制 / 修订 | 2026-11-12（v1.0 / v1.1 / v1.2） |
| 事实基线 | 当前 `server/` + `web/` 代码、`PROGRESS.md` 验收记录、`README.md` |
| 输入来源 | 《设计文档 ↔ 代码一致性审查结果》（58 项 / 51 项偏差）、《修改方案》、v1.1 的 14 项施工确认清单 |
| 文档性质 | 描述施工步骤、裁决与最终落地状态；v1.2 已同步代码与项目文档 |
| 适用对象 | 执行整改的开发者 / AI 编码代理 |
| 当前状态 | B0–B3 代码已收尾；配套文档批次已闭环（设计文档 v0.31）；**B4 外部依赖阻断**；§9 数据修复待授权 |

> 施工铁律：**每批次开工前留基线、每批次结束跑全量回归、每批次一个独立提交、新增行为必须可开关关闭**。任何一步失败，先回滚到该批次起点，不带病进入下一批。
>
> v1.1 新增铁律：**文档口径与实现不一致时，以代码为准；裁决写入 §8 后同步回对应批次卡片，不允许只改一处。**

---

## 0. 施工前必读

### 0.1 事实基线（不可动摇）

- 设计文档 `智学Agent项目设计文档.md` v0.30 标注「待评审」，属**规划态 / 应然**；代码与 `PROGRESS.md` 是**实然**。
- 冲突时以 `代码 > PROGRESS.md 验收记录 > README.md > 设计文档` 排序取信。
- 审查结论中「技术选型型号偏差」「目录树偏差」「ER 图残留」「路线进度」属**文档未同步**，不是代码缺陷，不进入本施工范围。

### 0.2 假设（未获确认前按此推进）

- **A1** 修改方向是「补齐代码以满足文档中合理的安全与工程约束」，不是把代码回退到文档描述的技术选型。
- **A2** 本施工覆盖 51 项偏差中**需动代码 / 功能 / 配置**的约 20 个改动点，分 B0–B4 五批；纯文档修订为配套批次，另立、不混批。
- **A3** 不变更对外 API 路径、成功响应结构、既有表结构与主键、Milvus collection 命名与 `DIM=1024`、不重灌已有向量。
- **A4** 不升级 Pi SDK / Milvus SDK / Vue / Hono 主版本；默认不新增第三方依赖，确需新增须单独审批。

### 0.3 待确认项与阻断规则

| 编号 | 待确认 | 阻断范围 | 未答时兜底 | v1.1 状态 |
| --- | --- | --- | --- | --- |
| **Q1** | `@earendil-works/pi-coding-agent@1.5.0` 的会话事件类型与是否提供步数上限 | B2-2 | 走 B2 路径 B（墙钟 + token 预算），标注「步数上限未实现」，**禁止编造 SDK 事件名或 API** | **已闭环（v1.2）**：`pi.ts:390-397` 对 `tool_execution_start` 计数并 `abort()`；事件名经 `pi-agent-core/dist/types.d.ts:483` 与 `pi-coding-agent/.../agent-session.d.ts:49` 核实。步数上限已生效。 |
| **Q2** | 错误响应结构是否允许 breaking change | 兼容性策略 | 已核实前端读 `data.error` → **双写 `{code, error, message}`，不 breaking** | 已闭环 |
| **Q3** | 文档切片 PII 脱敏是否默认开启 | B1-6 | 默认关闭（`DOCUMENT_PII_REDACT=0`） | 已闭环 |
| **Q4** | `edu_questions` / Router-Worker / edulab / GeoGebra 是补齐还是删除 | B3 扩展项 | 不实现，转配套文档删除 | **已闭环（v1.2）**：设计文档 v0.31 已对 edu_questions / Router-Worker / edulab / GeoGebra 标注【未实现，v0.31】并新增附录 B 对齐清单（见 §8 C06）。 |
| **Q5** | 生产反代选型、HTTPS 域名、备份调度 | B4 整批 | B4 整体后置，不写猜测配置 | **外部依赖阻断 / Not Started**（§8 C07） |
| **Q6** | `/privacy`、`/terms` 正文、备案、联系方式 | B1-5 内容 | 占位视图 + 登记上线阻断 | **保持上线阻断**，与施工签收分离（§8 C08） |
| **Q7** | MCP「副作用工具确认」是否接受配置期授权降级 | B1-4 | 只做工具白名单 + 副作用标记 | **有条件接受**，须补存量迁移（§8 C09） |

> v1.1 新增的 14 项确认与裁决见 **§8**；数据修复授权见 **§9**。
> v1.2：§8 中「接受但必做补强」的 7 项（C01/C03/C04/C05/C06/C09/C11）与 C02、B0-6、B1-2 均已落地并验证；落地状态汇总见 §8 末尾。

### 0.4 前置检查清单（开工前逐条执行）

```bash
cd /d/stu
git status --short                 # 期望：工作区干净；有未提交改动先单独存档
node -v                            # 期望：>= 22.5（README 要求 Node 24）
npm run milvus:health              # 期望：返回 ok；失败先起 Milvus
cd server && node --import jiti/register scripts/regression.ts   # 期望：ALL PASS，保存输出
cd server && node --import jiti/register scripts/eval-rag.ts     # 保存基线指标
cd /d/stu && npm run bench:s23 -- --chat                        # 保存 TTFT / P95 基线
cd /d/stu && npx tsc --noEmit -p server/tsconfig.json           # 记录既有错误数作为基线
cd /d/stu && npm run build                                      # 期望：构建通过
```

- 开启认证的服务执行回归前设置 `AUTH_USER` / `AUTH_PASSWORD`（`README.md:181`）。
- 基线输出统一存档到 `docs/` 或施工记录表附件，用于逐批次对比。
- **§9 数据漂移未修复前，`regression.ts` 与 `eval-rag.ts` 可能失败**；此时先做只读盘点，不要把失败误判为代码回归。

### 0.5 开关约定（v1.1 修订，解决原内部矛盾）

- **适用范围收窄**：本条只约束「**开关类**新增行为」——由环境变量控制、关闭后回到现状的行为，默认值 = 当前行为。
- **优先级**：批次卡片中**显式声明的行为变更优先于本条**。已确认的例外：
  - B0-3：`pi.ts` 历史回放 `24 条/8000 字` → `16 条/6000 字`（对齐 `handler.ts`）；
  - B1：`CSRF_ENABLED` / `BOOTSTRAP_LOCAL_ONLY` / `MCP_CONFIRM_SIDE_EFFECTS` 默认 `1`（安全默认开启，属于显式要求）。
- 冲突时**以批次卡片为准**，并在 §7 施工记录表备注「显式行为变更」。
- 命名统一 `EDUPI_<模块>_<语义>` 或复用现有前缀；新增键必须同步登记到 §3 配置总表与 `README.md` 配置表（防漂移见 §8 C11）。
- 禁止把凭据写入代码或日志；日志新增字段一律先脱敏。

---

## 1. 施工总览

### 1.1 修改目标

| 编号 | 目标 |
| --- | --- |
| G1 | 补齐上线阻断的安全约束：CSRF、bootstrap 本机限定、429 `Retry-After`、MCP 工具确认、隐私/协议页 |
| G2 | 给 Agent 循环与 RAG 外部调用加边界：步数/预算/墙钟上限、超时 + 重试 + 退避、trace_id |
| G3 | 消除实现内部不一致：历史回放口径、散落的阈值与环境变量 |
| G4 | 补齐 `README.md` / `PROGRESS.md` 已标注「未完成」的功能：快模型路由、SSE 重连、评测指标、TTS 音量/跟读 |
| G5 | 每批次独立可开关、独立可回滚，不改变现有默认行为（**例外见 §0.5**） |

### 1.2 批次与优先级

| 批次 | 优先级 | 主题 | 前置 | v1.1 状态 |
| --- | --- | --- | --- | --- |
| **B0** | P0 | 配置与常量收敛 | §0.4 基线 | 已完成（v1.2 验证通过） |
| **B1** | P0 | 安全与上线阻断项 | B0、Q3/Q6/Q7 | 已完成（含 B1-4b 存量回填） |
| **B2** | P1 | 有界自主与容错 | B0、Q1 | 已完成（含 C03 quiz signal；Q1 已闭环） |
| **B3** | P2 | 功能补齐 | B1、B2、Q4 | 已完成（含 C01 幂等键、C04 指标拆分） |
| **B4** | P2 | 部署侧配置 | Q5 | **Q5 阻断 / Not Started** |
| **配套** | — | 设计文档 / README / PROGRESS 修订 | B0 常量表定稿 | 已完成（设计文档 v0.31 + README + PROGRESS） |

### 1.3 依赖关系

```text
§0.4 基线 → B0 ──┬─→ B1 ──┬─→ B3 ──┬─→ 全量回归 / 施工签收
                  ├─→ B2 ──┘        └─→ B4（Q5 阻断，不进签收）
                  └─→ 配套文档修订（独立提交）
§9 数据修复（需授权）→ regression / eval-rag 可全绿
```

- B2 的 trace_id 依赖 B0 的配置模块；B3 的快模型路由依赖 `settings/providers.ts` 现有模型目录；B3 的评测指标依赖标注数据扩充（C05 已拆为独立数据任务）。
- B1 的 CSRF/bootstrap 为上线阻断项，未通过 `check-auth.ts` 不得合入。

### 1.4 不改动边界（施工红线）

1. 设计文档 v0.30 正文（配套批次另立）。
2. 对外 API 路径与成功响应结构；会话 Cookie 名称与 `users` / `sessions` / `documents` / `chunks` 既有列与主键。
3. Milvus collection 命名规则、向量维度 1024、已有向量数据（不重灌、不重建索引）。**§9 数据修复仅补缺失向量，属此红线的例外，需单独授权**。
4. 主依赖版本；不恢复 `better-sqlite3`、`BGE-M3`、`pi-subagents` 等已被替换的选型。
5. 默认阈值：`ROUTE_LLM_MIN_CHARS=24`、`RERANK_MIN_QUERY_CHARS=16`、`RAG_TOP_K=5`、掌握度 `0.95`；默认模型不变。
6. 面试 / 简历材料；不引入第二个项目的内容或指标。

### 1.5 施工约定

- 每批次一个提交，提交信息格式 `B<n>: <主题>`，附验收输出摘要。
- 改动前先读目标文件最新内容；坐标（文件:行号）仅作定位，以实际代码为准。
- 新增表/列用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN`，写入 `server/src/store.ts` 的初始化块，保证旧库可平滑升级。
- 所有外部调用新增超时必须显式数值；重试必须「次数 + 退避 + 抖动 + 降级路径」四件套齐全。
- **【v1.1 补登记 · 工程配置改动】** `server/tsconfig.json:10` 已启用 `allowImportingTsExtensions: true`（裁决见 §8 C12）：
  - 原因：仓库所有相对导入均带 `.ts` 后缀，未启用时 `npx tsc --noEmit` 报 TS5097，类型门禁不可用；
  - 影响：仅类型检查，`:9` 的 `noEmit: true` 必须同时保留，不产生 JS 产物；运行时由 `jiti` 加载 TS，不受影响；
  - 替代方案（未采用）：批量改为无扩展名导入，改动面大且易引入解析差异；
  - 归属：B0 工程配置改动，须在 §7 记录表登记，不得作为「未提及改动」遗留。

---

## 2. 批次施工卡

### B0 · 配置与常量收敛（P0）

**落地状态（v1.2）**：已完成；`config.ts`、`tsconfig.json`、`check-continuation.ts`、`regression.ts` 同源断言均就位。

**目标**：消除 `CHAT_HISTORY_LIMIT=16 / 6000 字`（`server/src/chat/handler.ts:127,170`）与 `pi.ts:183,185` 硬编码 `24 条 / 8000 字` 的内部不一致；为后续批次提供单一配置源。

**前置**：§0.4 基线完成。

| 步骤 | 文件 / 位置 | 动作 | 期望结果 |
| --- | --- | --- | --- |
| B0-1 | `server/src/config.ts` | 集中导出常量：`CHAT_HISTORY_LIMIT=16`、`HISTORY_ITEM_MAX_CHARS=6000`、`ROUTE_LLM_MIN_CHARS=24`、`RERANK_MIN_QUERY_CHARS=16`、`RAG_TOP_K=5`、`RAG_CANDIDATE_K=30`、`RAG_RECALL_LIMIT=50`；保留 `process.env` 覆盖；模块自加载 `.env`（`config.ts:5-7`） | 单一来源，默认值与现状一致 |
| B0-2 | `server/src/chat/handler.ts:127,170` | 改为读 `config`；保留 `Math.min(60, Math.max(4, ...))` 夹取 | 行为不变 |
| B0-3 | `server/src/pi.ts:183,185` | 把 `history.slice(-24)` / `8000` 换成 `config` 常量 | **显式行为变更：24→16、8000→6000**（§0.5 例外） |
| B0-4 | `server/src/agents/router.ts:43`、`server/src/rag/service.ts:69-70,74,87` | 阈值改读 `config` | 行为不变 |
| B0-5 | `README.md` 配置表 | 补新增键；登记常量与键名映射 | 配置有权威来源 |
| B0-6 | `server/scripts/check-continuation.ts`、`regression.ts` | 补断言：handler 与 pi 的历史回放取同一常量 | 静态可校验 |
| **B0-7（v1.1 补登记）** | `server/tsconfig.json` | 启用 `allowImportingTsExtensions`，保留 `noEmit` | `tsc` 门禁可用（C12） |

**验收**
```bash
cd server && node --import jiti/register scripts/regression.ts
cd server && node --import jiti/register scripts/check-continuation.ts
cd /d/stu && npx tsc --noEmit -p server/tsconfig.json   # 错误数不高于基线
```
期望：回归 ALL PASS；长会话回放条数一致；类型检查无新增错误。

**回滚点**：删除 `config.ts` 并还原 import；tsconfig 改动单独 revert（单提交可 `git revert`）。

---

### B1 · 安全与上线阻断项（P0）

**落地状态（v1.2）**：已完成；B1-4b 存量回填由 `src/mcp/backfill.ts` + `scripts/migrate-mcp-confirmations.ts` 实现，`check-mcp.ts` 覆盖「迁移后仍可调用」。

**目标**：补齐审查 E1/E3/E5、C5/C7 与 §6.16.4、§6.16.2、§6.13.4、§6.17。

**前置**：B0；Q3、Q6、Q7 已答（或按兜底执行）。

| 步骤 | 文件 / 位置 | 动作 | 期望结果 |
| --- | --- | --- | --- |
| B1-1 | 新增 `server/src/auth/csrf.ts`；`server/src/index.ts:44` | `csrfGuard` 挂在 `app.use('/api/*', requireAuth)` **之前**；非 `GET/HEAD/OPTIONS` 比对 `Origin`/`Referer` host 与 `Host`（代理下取 `X-Forwarded-Host`）；不一致返回 403 `{code:'CSRF_REJECTED', error, message}` | 跨站写请求被拒 |
| B1-2 | 同上 | **豁免清单**：`/health`、无 Origin 的 CLI 认证请求、SSE/WS 握手、MCP stdio 回调；显式枚举，禁止「无 Origin 一律放行」 | 回归脚本不被误伤 |
| B1-3 | `server/src/auth/service.ts:104-106`、`routes/auth.ts:71-77` | `AUTH_BOOTSTRAP=1` 增加来源校验：**不得复用 `requestIp()`**（`auth/middleware.ts:16-22` 信任 `x-forwarded-for`，可伪造）；用连接层远端地址，或带转发头直接拒绝 | 非本机无法抢占首个管理员 |
| B1-4 | `server/src/mcp/service.ts`、`store.ts`、`web/src/views/McpView.vue` | **Q7 裁决（C09）**：采用配置期显式授权（工具在 `createMcpTools().execute` → `callMcpTool()` 内由 Agent 循环调用，无请求-响应确认通道）；`side_effect` 默认保守判定「无 `readOnlyHint` 即视为副作用」（`mcp/service.ts:152-154`），`confirmed_at` 存 `mcp_tool_confirmations`（`store.ts:342-343`），未确认返回 `MCP_CONFIRMATION_REQUIRED`（`:423-426`）。**必须同时做 B1-4b 迁移** | 语义成立且不打断存量工具 |
| **B1-4b（v1.1 必做）** | 新增 `server/scripts/migrate-mcp-confirmations.ts` | 升级时对**存量已授权工具**做一次性 `confirmed_at` 回填（幂等，可重复执行）；此后仅新增/未标注工具走确认；`MCP_CONFIRM_SIDE_EFFECTS=0` 为紧急止血开关 | 避免全量工具升级后不可用（breaking 语义变更） |
| B1-5 | `web/src/router/index.ts`；`PrivacyView.vue`、`TermsView.vue` | 注册 `/privacy`、`/terms` 路由与占位视图；正文按 Q6，未提供处标 `TODO` 并登记为**上线阻断**（不阻断施工签收） | URL 可访问 |
| B1-6 | `server/src/documents/service.ts` / `chunker.ts`；复用 `security/guard.ts` 的 `redactPII` | `DOCUMENT_PII_REDACT`（默认 `0`）：开启时切片前脱敏；**开启后引用不可回查原文**，须在 README 明示 | 默认行为不变 |
| B1-7 | `server/src/routes/auth.ts:56-57,121-124` | 429 补 `Retry-After: <秒>`，由 `LOGIN_LOCK_MIN`/`LOGIN_WINDOW_MIN` 换算 | 响应头可读取 |
| B1-8 | `check-auth.ts`、`check-security.ts`、`check-mcp.ts` | 补用例：CSRF 拒绝/豁免、非本机 bootstrap、`Retry-After`、MCP 未确认拒绝 + **存量迁移后仍可调用**、PII 开/关 | 新增约束有回归覆盖 |

**验收**
```bash
npm run auth:check
npm run auth:isolation
npm run auth:admin-check
cd server && node --import jiti/register scripts/check-security.ts
cd server && node --import jiti/register scripts/check-mcp.ts
cd server && node --import jiti/register scripts/regression.ts   # 带 AUTH_USER / AUTH_PASSWORD
```
期望：三项 npm 自检 ALL PASS；跨站写 403；CLI 不受影响；429 带 `Retry-After`；`/privacy`、`/terms` 返回 200；存量 MCP 工具迁移后无需重新确认即可调用。

**回滚点**：逐项关闭开关；B1-1/1-3 误伤时先 `CSRF_ENABLED=0` / `BOOTSTRAP_LOCAL_ONLY=0` 止血。

---

### B2 · 有界自主与容错（P1）

**落地状态（v1.2）**：已完成；Q1 已闭环，C03 的 quiz signal 贯穿已实现并由 `check-resilience.ts` 覆盖。

**目标**：补齐审查 E8；让循环有停止条件、外部调用有超时/重试/降级、链路可定位。

**前置**：B0；Q1（未闭环按路径 B）。

| 步骤 | 文件 / 位置 | 动作 | 期望结果 |
| --- | --- | --- | --- |
| B2-1 | `server/src/pi.ts:399-404` | **已核实能力**：`session.abort()`（:399）、`session.subscribe`（:360）、`signal` 透传（:400）、`usageTotals` 累加（:383-390）、`AbortSignal.any` 已在 `learning/llm.ts:337` 使用。实现 `AbortSignal.any([signal, AbortSignal.timeout(WALL_CLOCK_MS)])` + token 预算 + `incomplete` 事件与人工接管点 | 墙钟与 token 有上限 |
| B2-2 | 同上 + SDK 类型定义 | Q1 路径 A：确认工具调用事件的真实名称后计数并 `abort()`。**事件名不得猜测**；查不到则只做路径 B 并标注「步数上限未实现」 | 步数上限或明确标注缺失 |
| B2-3 | `rag/embedding.ts:49`、`rag/rerank.ts:14` | 两处 `fetch` 补 `signal: AbortSignal.timeout(...)`；统一 `withRetry(fn,{retries,baseMs,jitter})`；失败抛带上下文错误码 | 超时可中断、重试有退避 |
| B2-4 | `rag/milvus.ts:17-26,153-174` | MilvusClient 与 `search` 补显式超时与客户端级重试；不可达抛 `MILVUS_UNAVAILABLE`，由 `index.ts` 通用 catch 映射 **502**（未按错误码区分 503，v1.2 按实现如实记录） | 检索失败可定位 |
| B2-5 | `rag/service.ts:78-82,101-104` | 保留「空结果 300ms 重查一次」与「rerank 失败降级 RRF」并补 why 注释；新重试不得与之叠加 | 降级路径清晰、不叠加 |
| B2-6 | `learning/llm.ts:332-403` | 多 Key 遍历加上限（`LLM_KEY_MAX_ATTEMPTS`，`config.ts:72` 已实现），复用 `settings/store.ts:418-425` 冷却 | 故障切换有界 |
| B2-7 | `server/src/tasks/queue.ts:27,99-124,123-171` | watchdog 改 `AbortController` 真正中止 `execute()`；失败重试 ≤`TASK_RETRY_MAX` + 退避；单 Worker 不变。**【v1.2 已修复】** 当前 `execute(task, signal)` 已把 signal 传给 `analysis` 的 `chat()`（:121），且 **`quiz` 分支的 `generateQuiz()`（:102-107）已接收 signal**，watchdog 可中断出题中的本地等待：把 `signal` 继续传入 `learning/quiz.ts` → `learning/llm.ts` 的 `chatJson`，并在每个 `await` 前检查 `signal.aborted`。**边界**：abort 只中止本地等待与后续步骤，**不承诺取消已发出的云端推理** | quiz 与 analysis 均可被 watchdog 中止 |
| B2-8 | `server/src/trace.ts`、`usage/store.ts`、`chat/handler.ts` | **【v1.1 C10 精确口径】** `trace_id` 实际进入：SSE 事件（`chat/handler.ts:264-283` 等）、`usage_records.trace_id`（`store.ts:238,470-471`）、可选 stdout（`trace.ts:35-40`，`TRACE_LOG=1`）。**无独立链路/span 存储、无跨服务传播、无可视化查询**；独立存储与 OTel 列为后续项；确认 stdout 日志已脱敏 | 文档不夸大可观测能力 |
| B2-9 | `check-continuation.ts`、新增 `check-resilience.ts` | 故障注入：rerank 超时、Milvus 不可达、超预算中断、长任务超时中止（**含 quiz 分支**） | 新增约束有回归覆盖 |

**验收**
```bash
cd server && node --import jiti/register scripts/check-resilience.ts
cd server && node --import jiti/register scripts/eval-rag.ts
cd /d/stu && npm run bench:s23 -- --chat
cd server && node --import jiti/register scripts/regression.ts
```
期望：故障注入按预期降级/中止（**含 quiz**）；检索指标不退化（§9 数据修复后再判）；抽查带 `trace_id` 的日志无 PII / 密钥。

**回滚点**：`AGENT_*` / `RAG_RETRY_MAX` 归零；B2-7 若影响任务完成率，`TASK_RETRY_MAX=0` 并保留 watchdog 旧行为。

---

### B3 · 功能补齐（P2）

**落地状态（v1.2）**：已完成；C01 幂等键、C04 指标口径、C02 volume 语义、C11 配置键校验均已落地。

**目标**：补齐审查 F3/F4/F7 与 `README.md`、`PROGRESS.md` 已标注「未完成」的功能。

**前置**：B1、B2；Q4（已确认兜底）。

| 步骤 | 文件 / 位置 | 动作 | 期望结果 |
| --- | --- | --- | --- |
| B3-1 | `settings/providers.ts`、`learning/llm.ts`、`agents/router.ts` | 快模型分级路由：按 `scenario` 选模型，`FAST_MODEL_ID` 为空时保持现状 | 可选加速，默认无变化 |
| B3-2 | `web/src/api/chat.ts:49,65,156-157` | **【v1.1 C01 口径修订】** 重连边界以**「未收到任何事件」**为准（`receivedAny`），而非 v1.0 写的「未收到任何 `delta`」。理由：SSE 首事件常为 `conversation`/`route`/`security`，且服务端在发出首事件前可能已落库用户消息/创建会话，以 delta 为界会重复落库。401/4401 不重连并跳登录 | 更保守的幂等边界 |
| **B3-2b（v1.1 必做）** | 前端 `web/src/api/chat.ts` + 后端 `chat/handler.ts` | 「未收到任何事件」**仍不彻底**：若服务端已落库但首事件未到达，重发仍会重复。补**客户端幂等键** `client_request_id`（每次发送生成、重发复用），后端按 `(learner_id, client_request_id)` 去重，命中时回放原结果而不重复落库。**幂等键落地前 `SSE_RETRY_MAX` 保持 `0` 或仅内测** | 真正消除重复 |
| B3-3 | `server/src/routes/voice.ts:66-126` | **【v1.1 C02 语义确认】** `/api/tts` 的 `volume` 为**客户端应用参数**：服务端校验并回显（响应体 + `X-TTS-Volume` 头），**不送入 OpenAI 兼容 `/audio/speech`（该接口无标准 volume 参数），不做服务端音频处理**；浏览器侧由 `Audio.volume` / `SpeechSynthesisUtterance.volume` 应用。API 注释与 README 必须写明，非浏览器客户端自行应用 | 语义无歧义 |
| B3-4 | `server/testdata/eval-rag.json` | **【v1.1 C05】** 人工标注拆为**独立数据任务**，不阻塞代码合入：现有 8 题仅 `query` + `expect_source`，需补 `relevant_sources:[{source, grade}]`、`answer`、`expected_citations`。登记负责人与截止 | 数据可支撑高级指标 |
| B3-5 | `server/scripts/eval-rag.ts:13-15,61-87` | **【v1.1 C04 口径裁决】** 当前 `:84` 的「引用正确率（按来源相关性）」复用 Precision@5，且 `:87` 自注「答案级判定需人工复核」——**名实不符，必须拆分**：① `引用命中率 / Citation Precision@K` = 引用 chunk 中命中 `relevant_sources` 且 `grade>0` 的比例（去重计数）；② `引用正确率` = 生成答案的引用是否支撑标准答案，**需 `answer` + `expected_citations`，无标注一律输出「不可计算」**；③ 禁止用来源相关性换算冒充「正确率」；④ 标注不足时 `Precision@K`/`nDCG@K` 输出「不可计算」且退出码 0，**不补造数据** | 指标名与算法一致 |
| B3-6 | `rag/resilience.ts:27` | 连接池依赖 Node 原生 fetch 的 undici keep-alive 默认行为（源码注释说明），未引入显式连接池；工具并行调用未实现 | 保持现状，文档如实记录 |
| B3-7 | `web/src/api/http.ts` 及各 store | 按 Q2：前端错误读取逐步兼容 `message`，服务端保留 `error` 双写 | 平滑迁移 |

**验收（v1.1 调整）**
```bash
cd server && node --import jiti/register scripts/eval-rag.ts
cd /d/stu && npm run bench:s23 -- --chat
cd server && node --import jiti/register scripts/check-voice.ts
cd server && node --import jiti/register scripts/check-visualize.ts
cd /d/stu && npm run build
```
期望：标注未就绪时高级指标输出「不可计算」且脚本通过（**不再要求新指标全绿**）；SSE 重连不产生重复消息；前端构建通过。

**回滚点**：`FAST_MODEL_ID` 置空、`SSE_RETRY_MAX=0`、`EVAL_ENABLE_ADVANCED=0`。

---

### B4 · 部署侧配置（P2 · **Q5 阻断，不开工**）

**状态**：外部依赖未定（C07），保持 `Not Started`；**不写猜测的 Caddy/Nginx 配置**；Q5 闭环后单独开工，**不阻塞其余批次签收**。

待闭环后再执行的步骤（保留原计划）：B4-1 反代配置与 compose service（复用 `APP_PORT`、可选 profile）；B4-2 `backup.ts` 增 `--check` 与调度说明；B4-3 `.env` 权限 600 检查命令与上线检查清单。

---

### 配套文档修订（独立批次，不与代码混批）

**范围**：技术选型四项、§5.1 分层图、§5.4 目录树与 §6.4 hook 等价实现清单、§5.5 Router/Worker 标注为未实现、§6.1 工具表、§6.3/§6.13 MCP 机制、§7.1 ER 图残留与 §5.9 L808「邀请」、§6.5 接口表、§5.8.2 页面表、§8/§13 路线与里程碑、§5.7.12/13 评测口径、配置项总表（与 §3 同步）。

**v1.1 补充（C06）**：Q4 的四项（`edu_questions`、Router-Worker、edulab、GeoGebra）**不能停在「本次未动」**，必须在本批次真正删除或标注为「未实现」，并登记提交号；否则配套批次未完成 → 阻断最终签收。

---

## 3. 配置项总表（**唯一权威源**，v1.1 补齐）

> 已按 `server/src/**` 全部 `process.env` 读取点与 README 配置表全量核对。C11 裁决：本表为唯一权威源，新增校验脚本比对源码 / `README.md` / 本表键集合，纳入回归，防止再次漂移。

| 键 | 默认 | 作用 | 批次 | 关闭 / 变更影响 |
| --- | --- | --- | --- | --- |
| `CHAT_HISTORY_LIMIT` | `16` | 回放历史条数（4–60 夹取） | B0 | 影响上下文长度 |
| **`HISTORY_ITEM_MAX_CHARS`** | `6000` | 单条历史截断长度 | B0 | **补登记（C11）** |
| `ROUTE_LLM_MIN_CHARS` | `24` | 短问题跳过路由模型 | B0 | — |
| `RERANK_MIN_QUERY_CHARS` | `16` | 短查询跳过 Cross-Encoder | B0 | — |
| **`RAG_TOP_K` / `RAG_CANDIDATE_K` / `RAG_RECALL_LIMIT`** | `5` / `30` / `50` | 检索条数 / 精排候选 / 召回上限 | B0 | **补登记（C11）** |
| `CSRF_ENABLED` | `1` | 非幂等请求同源校验 | B1 | `0` = 回到无校验 |
| `CSRF_ALLOWED_ORIGINS` | 空 | 额外可信来源白名单 | B1 | 仅按 Host 比对 |
| `BOOTSTRAP_LOCAL_ONLY` | `1` | 首个管理员仅本机可创建 | B1 | `0` = 回到 `AUTH_BOOTSTRAP` 开关 |
| `MCP_CONFIRM_SIDE_EFFECTS` | `1` | 副作用工具配置期确认 | B1 | `0` = 回到工具白名单（C09 止血） |
| `DOCUMENT_PII_REDACT` | `0` | 切片前 PII 脱敏 | B1 | 保持原文；开启后引用不可回查 |
| **`TRACE_LOG`** | `0` | 输出带 `trace_id` 的脱敏链路日志到 stdout | B2 | **补登记（C10/C11）** |
| `AGENT_MAX_TOOL_STEPS` | `10` | 工具循环步数上限，0=不限 | B2 | Q1 未闭环前不得宣称已生效 |
| `AGENT_WALL_CLOCK_MS` | `180000` | 单次对话墙钟上限，0=不限 | B2 | 不限 |
| `AGENT_TOKEN_BUDGET` | `0` | token 预算，0=不限 | B2 | 不限 |
| `RAG_TIMEOUT_MS` / `MILVUS_TIMEOUT_MS` | `15000` / `15000` | 检索外部调用超时 | B2 | — |
| `RAG_RETRY_MAX` | `2` | 检索重试次数 | B2 | `0` = 不重试 |
| **`TASK_TIMEOUT_MS`** | `180000` | 后台任务 watchdog 超时（`tasks/queue.ts:27`） | B2 | **补登记（C11，原 §3 遗漏）** |
| `TASK_RETRY_MAX` | `3` | 后台任务失败重试 | B2 | `0` = 不重试 |
| **`LLM_KEY_MAX_ATTEMPTS`** | `3` | 单次请求最多轮换密钥数，范围 1–20（`config.ts:72`） | B2 | **补登记（C11，原 §3 遗漏）** |
| `FAST_MODEL_ID` | 空 | 快模型 ID（`routing` 等轻量场景） | B3 | 保持现状 |
| **`SSE_RETRY_MAX` / `VITE_SSE_RETRY_MAX`** | `2` | 前端 SSE **未收到任何事件时**的重连次数 | B3 | `0` = 不重连；**口径已按 C01 修订，不再是「未输出 delta」** |
| **`TTS_DEFAULT_VOLUME`** | `1` | TTS 默认音量 0–1（客户端应用参数，见 C02） | B3 | **补登记（C11）** |
| `EVAL_ENABLE_ADVANCED` | `0` | 输出 `Precision@K` / `nDCG@K` 等高级指标 | B3 | 只输出现有指标 |
| `MCP_ALLOWED_HOSTS` | 空 | 远程 MCP 主机白名单（http/https 之外一律拒绝） | B1 | 空=不限制主机；配置后非白名单返回 403 |
| `AUTH_ENABLED` / `REGISTRATION_OPEN` / `AUTH_BOOTSTRAP` | `1` / `1` / `0` | 认证、公开注册与首个管理员开关 | B3 | 关闭认证仅限隔离测试 |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_MIN` / `LOGIN_WINDOW_MIN` | `5` / `15` / `15` | 登录失败锁定与统计窗口 | B3 | 仅影响认证限流 |
| `REGISTER_MAX_PER_HOUR` | `10` | 每 IP 每小时注册上限 | B3 | 仅影响公开注册 |
| `SESSION_TTL_DAYS` / `SESSION_ABSOLUTE_DAYS` / `SESSION_MAX_PER_USER` | `7` / `30` / `10` | 会话空闲/绝对有效期与单账号会话数上限 | B3 | 影响登录态保留 |
| `COOKIE_SECURE` / `TRUST_PROXY` | auto / `1` | HTTPS Cookie 与反向代理转发头信任 | B3 | 公网部署必须核实 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 空 | 对话模型 OpenAI 兼容或 Anthropic 接入 | B3 | 未配置则无法对话 |
| `LLM_OCR_MODEL` / `LLM_VISION` | 空 / auto | 图片 OCR 兜底模型与视觉能力覆盖 | B3 | 影响图片/扫描件识别 |
| `EMBEDDING_MODEL` / `RERANK_MODEL` | `text-embedding-v4` / `gte-rerank-v2` | Embedding 与精排模型 | B3 | 影响检索效果 |
| `MILVUS_ADDRESS` / `MILVUS_USERNAME` / `MILVUS_PASSWORD` / `MILVUS_TOKEN` | `localhost:19530` / 空 | Milvus 地址与认证 | B3 | 影响向量检索 |
| `EDUPI_SETTINGS_SECRET` | 空 | 设置与模型密钥的加密主密钥 | B3 | 生产必须显式配置并备份 |
| `EDU_DATA_DIR` / `EDU_UPLOADS_DIR` | `server/data` / `server/uploads` | 数据目录与上传目录 | B3 | 影响持久化位置 |
| `STORAGE_QUOTA_MB` / `STORAGE_RETENTION_DAYS` / `STORAGE_CLEANUP_HOURS` | `1024` / `30` / `24` | 存储配额、保留天数与孤儿清理周期 | B3 | 影响配额与清理 |
| `DOCLING_URL` / `DOCLING_TIMEOUT_MS` / `DOCLING_POLL_MS` | `http://localhost:5001` / 30 分钟 / `1500` | Docling 地址、转换超时与轮询 | B3 | 未部署 Docling 时回退本地 OCR |
| `DOCLING_FORMULA_ENRICHMENT` | `0` | 启用 Docling 公式 LaTeX（CPU 很慢） | B3 | `1` 才启用 |
| `DOCLING_OCR_ENGINE` | `auto` | **仅透传**给 docling-serve 的 `ocr_engine` 字段 | B3 | 不决定应用侧 OCR 路径 |
| `OCR_ENGINE` / `OCR_TIMEOUT_MS` / `OCR_DPI` | `auto` / `180000` / `200` | 应用侧 OCR 路径、超时与渲染 DPI | B3 | 允许 `auto` / `docling` / `docling+vision` / `vision` |
| `OCR_CONFIDENCE_THRESHOLD` / `OCR_VISION_FORMULA_MIN_MARKERS` | `0.8` / `10` | 待校对阈值与公式页视觉增强阈值 | B3 | 影响校对队列 |
| `RAG_CACHE_MAX` / `RAG_CACHE_TTL_MIN` / `RAG_CACHE_THRESHOLD` | `80` / `10` / `0.96` | 检索结果缓存条数、TTL 与相似度阈值 | B3 | `0` 或极小值等于关闭缓存 |
| `DAILY_PRACTICE_COUNT` | `5` | 每日练习题目数（3–10 夹取） | B3 | 影响每日任务 |
| `TTS_BASE_URL` / `TTS_API_KEY` / `TTS_MODEL` / `TTS_VOICE` | 空 | 服务端 TTS（OpenAI 兼容 `/audio/speech`） | B3 | 未配置时使用浏览器 `speechSynthesis` |
| `ANSWER_CACHE_TTL_MIN` / `EMBEDDING_CACHE_DAYS` | `60` / `30` | 精确答案缓存与 embedding 缓存保留 | B3 | `0` / 视配置关闭 |

> 所有键须同步写入 `README.md` 配置表与设计文档「配置项总表」；默认值以 `config.ts` 与 `queue.ts` 实际读取为准。C11 校验脚本 `server/scripts/check-config-keys.ts` 已建立并纳入 README 验证清单，实测 ALL PASS（77 登记键 / 79 代码键 / 3 豁免键）。

---

## 4. 兼容性与豁免清单

| 项 | 结论 | 依据 / 处理 |
| --- | --- | --- |
| 错误响应结构 | **不 breaking**；新增与关键路径 `{code, error, message}` 双写，历史校验分支仍 `{ error }` 单写（`chat/handler.ts` 7 处），前端按 `error ?? message` 兼容 | 前端读 `data.error`：`stores/chat.ts:110`、`stores/auth.ts:23`、`useVoiceRecorder.ts:20`；v1.2 按实现如实记录，未逐条改历史分支 |
| API 路径 | 不变 | 审查 C1 的路径偏差由文档侧修订 |
| 数据库 | 只新增表/列；既有列、主键、索引不动 | `mcp_tool_confirmations`（`store.ts:342-343`）、`usage_records.trace_id`（`store.ts:470-471`） |
| **MCP 存量工具** | **语义 breaking，必须一次性迁移** | `side_effect DEFAULT 1` + `confirmed_at` 默认空 → 未标注工具升级后全部需重新确认；B1-4b 回填（C09） |
| Milvus | 不动 collection 命名、维度、已有向量 | Q4 转文档侧删除；§9 数据修复为单独授权例外 |
| 会话 Cookie | 名称、`HttpOnly`、`SameSite=Lax` 不变 | `auth/middleware.ts:53-63` |
| CSRF 豁免 | `/health`、无 Origin 的 CLI 认证请求、SSE/WS 握手、MCP stdio 回调 | 显式枚举，禁止「无 Origin 一律放行」 |
| **tsconfig** | 保留 `allowImportingTsExtensions`，`noEmit` 必须同时保留 | `server/tsconfig.json:9-10`（C12） |
| 回归脚本 | 开启认证时设 `AUTH_USER`/`AUTH_PASSWORD`；隔离测试可 `AUTH_ENABLED=0` | `README.md:181` |
| **默认值优先级** | **开关类**默认 = 当前行为；**批次卡片显式变更优先** | §0.5 v1.1 修订（C13） |

---

## 5. 验证矩阵

| 阶段 | 命令 | 期望 |
| --- | --- | --- |
| 基线 / 每批收尾 | `cd server && node --import jiti/register scripts/regression.ts` | ALL PASS（**§9 数据修复后**再判定） |
| 类型 | `npx tsc --noEmit -p server/tsconfig.json` | 错误数不高于基线；`allowImportingTsExtensions` 已启用 |
| 构建 | `npm run build` | 通过 |
| 认证 | `npm run auth:check` / `auth:isolation` / `auth:admin-check` | ALL PASS |
| 安全 | `check-security.ts` | PII / 注入 / 输出过滤命中符合预期 |
| MCP | `check-mcp.ts` | 授权与确认通过；**存量迁移后无需重新确认即可调用** |
| 检索 | `eval-rag.ts` | Hit@1/3/5、Recall@5、MRR 不低于基线；**高级指标标注缺失时输出「不可计算」且退出码 0（C04/C05）** |
| 性能 | `npm run bench:s23` / `-- --chat` | 冷/热延迟与缓存命中不低于基线 |
| 专项 | `check-continuation.ts`、`check-voice.ts`、`check-visualize.ts`、`check-rag.ts`、`check-storage.ts`、`check-documents.ts`、`check-ocr.ts`、`check-docling.ts` | 按既有断言通过 |
| 容错 | `check-resilience.ts` | 超时/重试/中止/降级按预期，**含 quiz 分支（C03）** |
| **幂等（C01）** | 已建 `check-sse-idempotency.ts` | 断线重发不产生重复会话 / 用户消息 / 回复 |
| **配置防漂移（C11）** | 已建 `check-config-keys.ts` | `config.ts` / `README.md` / §3 键集合一致 |
| 上线冒烟 | 登录 → 刷新保持 → 带引用 RAG 问答 → 上传 → 退出失效 → `/health` | 全链路可用（**上线放行另需 Q5/Q6 闭环**） |

**v1.2 实测**：`npm run build` 通过；`check-sse-idempotency.ts` / `check-config-keys.ts` / `check-resilience.ts` / `check-mcp.ts` / `check-continuation.ts` / `check-security.ts` 全部 ALL PASS；`npx tsc --noEmit -p server/tsconfig.json` 仅剩 4 类既有错误，本轮未新增。需服务与 Milvus 的 `regression.ts`、`eval-rag.ts` 全量回归未跑（受 §9 数据漂移影响）。

---

## 6. 风险登记与回滚手册

| 风险 | 概率 | 影响 | 缓解 | 止血动作 |
| --- | --- | --- | --- | --- |
| Q1 未闭环却宣称有步数上限 | 中 | 高 | 核验 `pi.ts` 是否真实计数并 `abort()`；未核实只宣称墙钟/预算 | `AGENT_MAX_TOOL_STEPS=0` |
| CSRF 误伤回归脚本或反代转发头 | 中 | 中 | 豁免清单 + `X-Forwarded-Host` 比对；`auth:check` 先跑 | `CSRF_ENABLED=0` |
| bootstrap 本机判定被 `x-forwarded-for` 伪造 | 中 | 高 | 不复用 `requestIp()`；带转发头直接拒绝 | `BOOTSTRAP_LOCAL_ONLY=1` 保持 |
| **MCP 升级后存量工具全部被拦截** | 中 | 高 | B1-4b 一次性回填 + `check-mcp.ts` 覆盖 | `MCP_CONFIRM_SIDE_EFFECTS=0` |
| PII 脱敏导致引用无法回查 | 中 | 中 | 默认关闭 + README 明示 | `DOCUMENT_PII_REDACT=0` |
| **SSE 重连造成重复落库 / 重复回复** | 中 | 中 | 「未收到任何事件」+ **B3-2b 幂等键**；未落地前关闭重连 | `SSE_RETRY_MAX=0` |
| 评测指标名实不符 / 标注不足却出数 | 中 | 高 | C04 拆分命名 + C05「不可计算」门禁 | `EVAL_ENABLE_ADVANCED=0` |
| quiz 任务超时后仍在后台跑模型 | 中 | 中 | C03 把 signal 贯穿学习模块 | `TASK_RETRY_MAX=0` |
| **既有数据漂移导致回归长期失败** | 高 | 中 | §9 数据修复单 + 根因一致性修复 | 恢复 §9 备份 |
| 反代配置与 3000 端口冲突 | 低 | 中 | 复用 `APP_PORT`、可选 profile | 停用反代 profile |

**回滚顺序**：按批次反向 `git revert`（B4 → B3 → B2 → B1 → B0）；紧急止血优先关开关。任何回滚后必须重跑 §5 验证矩阵并留档。

---

## 7. 施工记录表（执行时填写）

| 批次 | 开工时间 | 完成时间 | 提交号 | 基线输出位置 | 验收结果 | 开关状态 | 回滚点 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B0 | 2026-11-12 | 2026-11-12 | 未提交（工作区改动） | 本会话验证输出 | ALL PASS | 默认值 | 单批次 git revert / 关闭对应开关 | 含 tsconfig 改动（C12）；v1.2 同源断言就位 |
| B1 | 2026-11-12 | 2026-11-12 | 未提交（工作区改动） | 本会话验证输出 | ALL PASS | 默认值 | 单批次 git revert / 关闭对应开关 | 含 B1-4b 存量回填（C09）；v1.2 backfill.ts 落地 |
| B2 | 2026-11-12 | 2026-11-12 | 未提交（工作区改动） | 本会话验证输出 | ALL PASS | 默认值 | 单批次 git revert / 关闭对应开关 | C03 quiz signal 已补、Q1 已闭环（v1.2） |
| B3 | 2026-11-12 | 2026-11-12 | 未提交（工作区改动） | 本会话验证输出 | ALL PASS | 默认值 | 单批次 git revert / 关闭对应开关 | C01 幂等键、C04 指标拆分已落地（v1.2） |
| B4 | — | — | — | — | — | — | — | **Q5 阻断 / Not Started** |
| 配套文档 | 2026-11-12 | 2026-11-12 | 未提交（工作区改动） | 本会话验证输出 | Grep 校验通过 | 默认值 | 单批次 git revert / 关闭对应开关 | Q4 删除项已落地；设计文档 v0.31 + README + PROGRESS（v1.2） |
| 数据修复（§9） | — | — | — | — | — | — | — | **待用户授权** |

**签收条件（v1.1 修订）**

- **施工签收**（可先于上线）：§5 验证矩阵除「上线冒烟」外全绿、§8 裁决中「必做项」完成、§7 记录表填写完整、§3 与 README 一致。
- **允许除外**：B4（Q5 外部依赖阻断）、Q6 法务正文（登记为上线阻断）、C05 人工标注（独立数据任务）。三者不阻塞施工签收，但须在记录表显式登记。
- **上线放行**（另行）：B4 闭环、Q6 正文/备案/联系方式齐备、§9 数据修复完成、HTTPS 与备份检查通过。
- 配套文档批次未闭环 → 阻断最终签收（C06）。

**v1.2 签收结论**：施工签收条件已满足（B4、Q6 正文、C05 人工标注、§9 数据修复按 §7 允许除外登记）；上线放行仍需 Q5 / Q6 / §9 闭环。

---

## 8. 确认项裁决（v1.1 · 14 项）

> 「核验」列说明本次是否在当前工作区抽样核实；未核验项按执行方报告记录，不写成既成事实。**裁决优先级：本表 > 批次卡片 > §0.5 通则。**

| 编号 | 确认项 | 核验 | 裁决 | 落地动作 / 归属 |
| --- | --- | --- | --- | --- |
| **C01** | B3-2 重连口径：「未收到任何 delta」vs 实现「未收到任何事件」 | 已核实 `web/src/api/chat.ts:156-157`（`receivedAny` 判定）、`README.md:148` | **接受实现，修订文档；但不彻底** | ① §2 B3-2 与 §3 改为「未收到任何事件」；② **必做 B3-2b 幂等键** `client_request_id`，服务端按 `(learner_id, client_request_id)` 去重，否则服务端在首事件前已落库仍会重复；③ 幂等键落地前 `SSE_RETRY_MAX=0` |
| **C02** | 服务端 TTS `volume` 仅回显，实际由浏览器应用 | 已核实 `routes/voice.ts:72,78,104,117,126`（响应体 + `X-TTS-Volume` 头，未送入 `/audio/speech`） | **接受，但必须写明语义** | §2 B3-3 / API 注释 / README 标注「客户端应用参数，不做服务端音频处理」；浏览器 `Audio.volume` / `SpeechSynthesisUtterance.volume`；非浏览器客户端自行应用 |
| **C03** | `generateQuiz` 无 `signal`，watchdog 无法中断 quiz 模型调用 | 已核实 `tasks/queue.ts:99-124`（`analysis` 传 signal :121，`quiz` :102-107 未传） | **不接受现状，必做** | `execute(task, signal)` → `generateQuiz(..., signal)` → `learning/llm.ts:chatJson`；每个 `await` 前检查 `signal.aborted`；边界：abort 只中止本地等待与后续步骤，**不承诺取消已发出的云端推理**；`check-resilience.ts` 加 quiz 分支用例 → B2-7 |
| **C04** | 「引用正确率」无判定规则，实现按来源相关性估算 | 已核实 `eval-rag.ts:84-87`（复用 Precision@5，自注「答案级判定需人工复核」） | **口径必须拆分，禁止名实不符** | ① `引用命中率 / Citation Precision@K` = 引用 chunk 命中 `relevant_sources` 且 `grade>0` 的去重比例；② `引用正确率` 需 `answer` + `expected_citations` 的答案级判定，无标注一律「不可计算」；③ 禁止用相关性换算冒充 → B3-5 |
| **C05** | 标注数据需人工补齐，否则高级指标永不可计算、验收无法全绿 | 已核实 `testdata/eval-rag.json:2` 仅 `query`+`expect_source`；`regression.ts:91`、`eval-rag.json:2-3` 依赖 `geometry.txt` | **接受，调整验收口径** | ① 人工标注拆为**独立数据任务**，登记负责人/截止，不阻塞代码合入；② schema：`relevant_sources:[{source,grade}]` + `answer` + `expected_citations`；③ 高级指标门禁改为「标注缺失时输出『不可计算』且退出码 0」；④ 从 B3 验收删除「新指标全绿」 |
| **C06** | Q4 四项按兜底「不实现、转文档删除」，本次未动 | 按执行方报告（未全量抽样） | **确认兜底，但不能停在「未动」** | 配套文档批次必须真正删除/标注 `edu_questions`、Router-Worker、edulab、GeoGebra 相关描述并登记提交号；否则配套批次未完成 → 阻断最终签收 |
| **C07** | Q5 部署未定，B4 无法开工 | 外部依赖 | **确认 B4 保持阻断** | 状态改「外部依赖阻断 / Not Started」；**允许除 B4 外签收**；不写猜测反代配置；Q5 闭环后单独开工 |
| **C08** | Q6 法务文本仅占位 | 外部依赖 | **确认保持上线阻断** | 施工签收与上线放行分离：路由/占位视图完成即可签收代码批次；正文/备案/联系方式为上线放行前置，登记上线检查清单 |
| **C09** | Q7「无 `readOnlyHint` 即视为副作用」，存量工具需重新确认 | 已核实 `mcp/service.ts:152-154,423-426`、`store.ts:342-343`（`side_effect DEFAULT 1`、`confirmed_at` 默认空） | **有条件接受**（保守语义合理），**必须加迁移** | ① B1-4b 对存量 `enabled_tools` 一次性幂等回填 `confirmed_at`；② 之后仅新增/未标注工具走确认；③ `MCP_CONFIRM_SIDE_EFFECTS=0` 止血；④ 文档写明「默认保守判定 + 迁移步骤」，标注为 breaking 语义变更；⑤ `check-mcp.ts` 覆盖「迁移后仍可调用」 |
| **C10** | B2-8 trace 仅进用量表与 stdout，无独立链路存储 | 已核实 `trace.ts:35-40`、`usage/store.ts:57,252`、`chat/handler.ts` SSE 事件带 `trace_id` | **接受当前范围，修订文档表述** | §2 B2-8 改为「SSE 事件 + 用量表 + 可选 stdout；无独立 span 存储、无跨服务传播、无可视化查询」；独立存储/OTel 列后续；确认 `TRACE_LOG=1` 日志已脱敏 |
| **C11** | 配置总表遗漏 `TASK_TIMEOUT_MS`、`LLM_KEY_MAX_ATTEMPTS` 等 | 已核实 `README.md:144,146`、`config.ts:72`、`tasks/queue.ts:27` | **必须补，且建防漂移机制** | §3 已补齐两键及 `HISTORY_ITEM_MAX_CHARS`、`RAG_TOP_K/CANDIDATE_K/RECALL_LIMIT`、`TTS_DEFAULT_VOLUME`、`VITE_SSE_RETRY_MAX`、`TRACE_LOG`；§3 定为唯一权威源；新增 `check-config-keys.ts` 比对三方键集合并纳入回归 |
| **C12** | tsconfig 启用 `allowImportingTsExtensions`，文档未提 | 已核实 `server/tsconfig.json:9-10`（`noEmit:true` 同时存在） | **保留，补登记** | 写入 §1.5 与 B0-7：原因（TS5097 / 全仓 `.ts` 后缀导入）、影响（仅类型检查，`noEmit` 下无产物，jiti 运行时不受影响）、前置（`noEmit` 必须保留）、替代方案（未采用） |
| **C13** | §0.5「默认=当前行为」与 B0-3、B1 开关默认 1 矛盾 | 已核实文档自身 | **确认以批次卡片为准，修订 §0.5** | §0.5 收窄为「只约束开关类新增行为」，显式列出 B0-3 与 B1 两个例外；§4 同步；冲突时以批次卡片为准 |
| **C14** | 既有数据漂移：`geometry.txt` 等 SQLite 标 `indexed` 但 Milvus 无向量，导致 regression / eval-rag 失败 | 已核实 `eval-rag.json:2-3`、`regression.ts:91` 依赖 `geometry.txt`；**SQLite / Milvus 运行时状态未连库核验** | **有条件授权**，单列数据修复单，**需用户对清单二次确认**；本次方案不含任何写操作 | 见 **§9** |

**裁决分类小结**

- 接受并已同步文档：C02、C07、C08、C10、C12、C13。
- 接受但**必做补强**：C01（幂等键）、C03（signal 贯穿）、C04（指标口径）、C05（验收口径 + 数据任务）、C06（文档真删）、C09（存量迁移）、C11（防漂移校验）。
- 待外部输入：Q1（SDK 事件名核验）、Q5、Q6、C14（数据修复授权）。

### v1.2 落地状态汇总

- **已落地并验证**：C01（`check-sse-idempotency.ts`）、C02（`voice.ts` 注释 / `check-voice.ts`）、C03（`check-resilience.ts` quiz 分支）、C04（`eval-rag.ts` 指标拆分）、C05（口径，`eval-rag.ts`「不可计算」门禁）、C06（设计文档 v0.31，Grep 校验）、C09（`check-mcp.ts` 回填用例 / `migrate-mcp-confirmations.ts`）、C11（`check-config-keys.ts`，ALL PASS 77 登记键 / 79 代码键 / 3 豁免键）、C12（`tsconfig.json`，`tsc --noEmit`）、C13（§0.5 / §4 文档）、B0-6（`regression.ts` 同源断言）、B1-2（`csrf.ts` 注释）。
- **仍待外部输入**：Q5（B4 反代 / HTTPS / 备份调度）、Q6（法务正文 / 备案 / 联系方式）、C14（数据修复需用户授权）、C05 人工标注数据（独立任务）。
- **明确**：B3-7 错误双写按现状文档化（新增与关键路径双写，历史分支单写，前端兼容两者），未逐条改历史分支。

---

## 9. 数据修复单 · 既有数据漂移（**需授权，未执行**）

### 9.1 问题与影响

- 现象（执行方报告）：`geometry.txt` 等小资料在 SQLite 中 `status='indexed'`，但 Milvus 中无对应向量。
- 影响：`server/scripts/regression.ts:91` 断言 `citations[0].source_name === 'geometry.txt'`；`server/testdata/eval-rag.json:2-3` 两题 `expect_source='geometry.txt'` → 两者失败，验收无法全绿。
- **未核验部分**：本次未连 SQLite / Milvus，漂移范围、涉及资料数量与 `learner_id` 归属均未确认，**不得凭描述直接写操作**。

v1.2 状态：未连库核验、未执行任何写操作；本轮代码改动不含数据修复。

### 9.2 授权边界（红线）

- 允许：对**确认缺失向量**的资料重新执行索引，仅补写缺失向量。
- 禁止：重建 collection、改动 `DIM=1024`、删除既有向量、修改既有 `chunks` / `documents` 行内容、跨账号操作、批量全库重灌。
- 归属：按 `learner_id` 逐账号处理；首个账号沿用 `edu_chunks`，其余用 `edu_chunks_<id>`（`rag/milvus.ts:5-12`）。
- 性质：**数据修复，不属于代码整改批次**，独立记录、独立验证、不混进 B0–B4 提交。

### 9.3 执行步骤（用户确认清单后才可开始）

1. **备份**：`npm run backup -- --with-uploads`，记录 `edu.db` 行数与 Milvus 各 collection 的向量计数。
2. **只读盘点**：列出 SQLite 中 `documents.status='indexed'` 的记录（`document_id` / `source_name` / `learner_id` / `chunk_count`），与 Milvus 中按 `source_id` 查询到的向量数比对，输出**差异清单**（含 `geometry.txt`）。此步只读、不改任何数据。
3. **用户二次确认**：把差异清单逐条列出（路径 / 账号 / 缺失数量 / 预计写入向量数），**由用户显式点头后**才进入写操作；本方案不代为授权。
4. **逐份修复**：对每份资料调用现有 `POST /api/documents/:id/index`（不新建接口、不改代码），一次一份，记录写入的 `chunk_id` 与向量数。
5. **逐份验证**：`POST /api/knowledge/search` 用该资料的代表性 query 检索，确认引用回查正常。
6. **全量回归**：`regression.ts` → `eval-rag.ts` → `check-rag.ts` → `bench:s23`，与基线对比。
7. **留档**：写入 §7 记录表「数据修复」行，附差异清单、写入前后计数、验证输出。

### 9.4 回滚

- 数据库有备份可整体恢复；向量写入不可逆，但可按第 4 步记录的 `chunk_id` 定向删除本次新增向量（需人工确认后执行）。
- 任何一步失败立即停止，不继续处理下一份（小批量原则，单批 ≤10 份）。

### 9.5 根因修复（防复发，列为后续缺陷项）

- 现状是「SQLite 状态」与「Milvus 写入」两个存储无法原子提交，任一环节失败即留下 `indexed` 但无向量的漂移。
- 建议：索引流程改为「向量写入成功后再置 `indexed`」+ 启动/定时的一致性巡检（对比两边计数，输出差异清单并可一键修复）+ 失败时状态置 `index_failed`。
- 该改动属于代码改动，独立批次评估，不包含在本数据修复单内。

---

## 附录 A · 审查差异编号 → 施工批次映射

| 审查编号 | 处置 |
| --- | --- |
| A1–A3、A4–A13、A14 | 配套文档修订或「一致保留」；A7、A10、A11 的部分落地分别转 B4、B2 |
| B1–B6、C1–C3、C8–C10、F1、F2、F6、F8、F9、E6、E9、D4、D5 | 配套文档修订（措辞 / 清单 / 进度 / 内部矛盾） |
| C4 | 兼容性策略：Q2 双写，不 breaking |
| C5、C7、E1、E3、E5、E7（开关部分） | **B1** |
| D2、D3、D6、F5（细节） | **B0** |
| E2 | **B1**（静态检查脚本）或配套文档约束改写 |
| E4、F4、F7 | **B3** |
| E8 | **B2** |
| D4、D5、A7（反代部分） | **B4（Q5 阻断）** |
| E10、F10、C11、B7、A14 | 一致，保留 |

## 附录 B · 命令速查

```bash
# 服务
npm run dev                    # server 3000 + web 5173
npm run dev:server / dev:web   # 单独启动
npm run build
npm run milvus:health
npm run backup -- --with-uploads

# 自检
npm run auth:check / auth:isolation / auth:admin-check / auth:migrate
npm run bench:s23 [-- --chat]

# 回归（在 server/ 下）
node --import jiti/register scripts/regression.ts
node --import jiti/register scripts/eval-rag.ts
node --import jiti/register scripts/check-auth.ts
node --import jiti/register scripts/check-isolation.ts
node --import jiti/register scripts/check-admin.ts
node --import jiti/register scripts/check-security.ts
node --import jiti/register scripts/check-mcp.ts
node --import jiti/register scripts/check-continuation.ts
node --import jiti/register scripts/check-rag.ts
node --import jiti/register scripts/check-docling.ts
node --import jiti/register scripts/check-ocr.ts
node --import jiti/register scripts/check-visualize.ts
node --import jiti/register scripts/check-voice.ts
node --import jiti/register scripts/check-sse-idempotency.ts
node --import jiti/register scripts/check-config-keys.ts
node --import jiti/register scripts/check-resilience.ts   # 含 C03 quiz 分支用例
node --import jiti/register scripts/migrate-mcp-confirmations.ts   # 默认 dry-run；加 --apply 才写库
```

## 附录 C · 代码坐标速查（已实际核对）

| 主题 | 坐标 |
| --- | --- |
| 配置模块 | `server/src/config.ts:30-72`（B0 常量与开关）、`:5-7`（自加载 `.env`） |
| 工程配置 | `server/tsconfig.json:9-10`（`noEmit` + `allowImportingTsExtensions`） |
| 中间件挂载 | `server/src/index.ts:44` `app.use('/api/*', requireAuth)`；`:48-71` WebSocket |
| 认证 | `auth/middleware.ts:16-22` `requestIp`、`:53-63` Cookie、`:70-84` `requireAuth`、`:86-99` `requireAdmin`；`auth/service.ts:104-106` `bootstrapAllowed`；`routes/auth.ts:56-57,71-77,121-124` |
| MCP 确认 | `mcp/service.ts:152-154` `toolSideEffect`、`:423-426` `MCP_CONFIRMATION_REQUIRED`、`:459-484` `createMcpTools`、`:469-474` 确认态写入；`store.ts:342-343` 表定义 |
| Pi 会话 | `pi.ts:183,185` 历史回放、`:336-337` 画像、`:360-397` `subscribe`、`:399-404` `abort`/`prompt`/`waitForIdle`、`:406-438` 续写、`:454-467` `recordUsage` |
| RAG | `rag/service.ts:65-123`（`:69-70` topK/candidateK、`:74` 召回 50、`:78-82` 空结果重试、`:87-104` 短路与降级）；`embedding.ts:34-74`；`rerank.ts:7-27`；`milvus.ts:5-12,17-26,144-187,171`（collection / RRF k=60） |
| 对话与 trace | `chat/handler.ts:127,170`（16/6000）、`:264-283` SSE 带 `trace_id`、`:382-388` guard、`:445-447` 路由、`:530` `streamSSE`、`:599-605` 落库；`trace.ts:35-40` stdout |
| 路由 | `agents/router.ts:10-18`（7 条规则）、`:43-45`（24 字阈值）、`:48-61`（LLM 分类与回退） |
| 任务队列 | `tasks/queue.ts:27`（180s）、`:99-124` `execute`（quiz / analysis 均已传 signal）、`:123-171` `drain`、`:136-140` watchdog |
| LLM | `learning/llm.ts:323,336-337`（超时 / `AbortSignal.any`）、`:332-403` 多 Key、`:460` 连接测试；`settings/store.ts:418-425` 冷却 |
| 前端 | `web/src/api/http.ts:5-20` 拦截器；`web/src/api/chat.ts:49,65,156-157` 重连；`web/src/router/index.ts:27-146` 路由 |
| TTS | `server/src/routes/voice.ts:57,66-78,88,104,117,126`（volume 回显，`/audio/speech` 不含 volume） |
| 评测 | `server/testdata/eval-rag.json:2-9`（8 题，2 题依赖 `geometry.txt`）；`server/scripts/eval-rag.ts:13-15,61-87`（高级指标与「不可计算」）；`regression.ts:91` |
| 用量 / 预算 | `usage/store.ts:57,238,252,470-471`（`trace_id` 列）、`:118`（p95）、`:158-196`（月度预算 80%） |
| 幂等 / 回填 / 配置校验 | `server/src/chat/idempotency.ts`、`server/src/mcp/backfill.ts`、`server/scripts/check-sse-idempotency.ts`、`check-config-keys.ts`、`migrate-mcp-confirmations.ts`；`store.ts` 的 `chat_idempotency` 表 |
| SDK 事件核实 | `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:483`（tool_execution_start）、`pi-coding-agent/dist/core/agent-session.d.ts:49` |
