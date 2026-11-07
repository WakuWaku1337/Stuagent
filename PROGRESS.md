# 智学 实施进度

当前阶段：F 子智能体与双层编排 —— 已完成（S13、S14 验收通过）
已完成对话：S01–S02（A）；S03–S04（B）；S05–S07（C）；S08–S12（D+E）；S13–S14（F，2026-11-07 本次）
下一步对话（编号+目标）：S15 整卷识别 —— OCR / 多模态 exam.recognize，整卷结构化；验收：整卷可结构化

关键文件/接口：
- server/src/agents/roles.ts：Tutor/Quizzer/Analyst/Solver 元数据（名称、职责、工具白名单）
- server/src/agents/router.ts：路由器，规则打分优先 + LLM 分类兜底（失败回退 Tutor）
- server/agent-workspace/roles/{tutor,quizzer,analyst,solver}/AGENTS.md：四角色系统提示词（Pi 按 cwd 加载）
- server/src/pi.ts：会话按 `角色:会话ID` 隔离，cwd 指向角色目录，工具白名单按角色下发
- server/src/learning/tools.ts：新增 mastery_report 工具（Analyst/Quizzer 用）
- server/src/tasks/queue.ts：SQLite 任务表 + 单 Worker 后台队列 + 看门狗超时 + 启动恢复（queued/running → 重排，attempts 上限 3）
- server/src/index.ts：GET /api/agents、/api/chat 支持 agent=auto|tutor|quizzer|analyst|solver（SSE 先发 route 事件）、/api/tasks（创建/列表/详情/取消）、WS /ws 推送任务事件
- web/src/views/TasksView.vue：后台任务页（创建、状态、WS 实时事件）；对话页气泡显示角色徽标

验收证据（2026-11-07 实测）：
- S13：四条输入分别路由到 tutor/quizzer/analyst/solver（规则命中理由可见）；回复具角色特征（出题=2 道单选、诊断=结构化报告、解题=证明+验算）；浏览器对话页气泡显示"Quizzer 出题"，且出题前查询掌握度选择 15% 的薄弱点
- S14 不阻塞：POST /api/tasks 1s 返回 202（queued）；任务执行期间 /api/chat 正常返回（14s），任务稍后 done 并返回 session_id
- S14 WebSocket：浏览器 /tasks 连接建立（connected/pong），任务 done 事件推送后列表自动刷新为"完成"
- S14 可续任务：向 DB 注入一条 status=running 的中断任务 → 重启服务 → attempts=1 自动重排 → 执行完成（done + session_id）
- S14 看门狗：TASK_TIMEOUT_MS=2000 启动，任务 2s 后被标记 status=timeout，error="超过 2000ms 未完成"
- S14 分析类任务：background analysis 输出诊断报告（Analyst 角色）

关键决策与偏离（需评审知悉）：
1. 路由器采用"关键词规则打分 + LLM 分类兜底"，非完整事件总线；符合设计 5.5.4 对单用户场景的裁剪。
2. 可续任务以"任务行持久化 + 重启重排"实现；Pi 子会话本身仍为 inMemory，重启后角色对话上下文不保留（任务结果保留）。设计中的 append-only 可回放会话日志属 P2。
3. Worker 串行处理后台任务（单用户足够）；看门狗为进程内定时器，非外部监工进程。
4. 角色切换按单条消息路由，各角色会话历史独立；跨角色共享的是画像/记忆/掌握度（SQLite），不是对话上下文。
5. WebSocket 使用 @hono/node-ws；Vite 已配置 /ws 代理。
6. setup-matt-pocock-skills 技能本会话不可用，未使用。

遗留问题与风险：
- 同一会话跨角色时上下文不连续（设计上 Tutor 可转交，后续可由 Router 汇总）
- 后台任务失败只记录 error，未做重试策略（除恢复时的 attempts）
- S15 需要 OCR/多模态通道；当前只有文本模型，需确认拍照识别方案（可用多模态模型或 OCR MCP）