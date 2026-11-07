# 智学 实施进度

当前阶段：D 记忆错题 + E 出题模考 BKT —— 已完成（S08–S12 验收通过）
已完成对话：S01–S02（A）；S03–S04（B）；S05–S07（C）；S08–S12（D+E 并行，2026-11-07 本次）
下一步对话（编号+目标）：S13 子智能体 —— Tutor/Quizzer/Analyst/Solver 封装、提示词与路由；验收：任务可正确分派

关键文件/接口：
- server/src/store.ts：新增 learners / memories / questions / wrong_records / mastery / quiz_sessions / quiz_answers 表（node:sqlite，data/edu.db）
- server/src/learning/bkt.ts：标准 BKT（P(L0)=0.3, P(T)=0.1, P(S)=0.1, P(G)=0.2，阈值 0.95）
- server/src/learning/memory.ts：记忆读写/检索 + profileContext()（画像、薄弱点、记忆）
- server/src/learning/wrongbook.ts：错题收录 + SM-2 简化调度（quality 0-5，next_review）
- server/src/learning/questions.ts：题目/题库存取、随机抽题
- server/src/learning/quiz.ts：LLM 出题（单选）、题库提取、开卷/模考会话、判分、BKT 更新、错题联动
- server/src/learning/tools.ts：Pi 工具 memory_write / memory_recall / wrongbook_add / wrongbook_due / mastery_update / quiz_generate
- server/src/routes/learning.ts：/api/memory、/api/wrongbook、/api/mastery、/api/quiz/generate|answer|sessions、/api/bank、/api/bank/extract、/api/exam/start|:id|submit
- server/src/pi.ts：每轮对话注入画像（等价 before_agent_start），工具白名单含知识检索 + 6 个学习工具
- web/src/views：QuizView（出题答题）、WrongbookView（错题/复习）、MasteryView（ECharts）、ExamView（计时模考）；首页六个入口

验收证据（2026-11-07 实测）：
- S08：记忆写入 API；对话中 agent 主动调用 memory_write 写入 3 条（目标/薄弱点）；**新会话** mem-b 未被告知即可回答"立体几何/空间向量最薄弱"（画像跨会话注入生效）；重启后 memories=3 仍在
- S09：答错自动收录（wrong_record_id 返回）；浏览器错题本 3 条 → 点"记住了"提示 1 天后再见，next_review/interval 更新；due 计数正常；重启后 wrong_records=3
- S10：/api/quiz/generate 生成 2 道勾股定理单选（A-D）；浏览器 /quiz 生成 3 题、答题后即时反馈"回答正确 + 掌握度 69.3% + 解析"
- S11：/api/bank/extract 从 math-notes.md 提取 7 题；浏览器 /exam 3 题倒计时 09:58 → 交卷 66.7 分，失分分布按知识点展示，错题卡片红标
- S12：BKT 实测 0.3 → 答对 0.6927 → 答错 0.2978；/mastery 返回 percent/mastered；浏览器掌握度页 ECharts canvas 渲染 + 薄弱点列表（勾股定理 49%）
- 对话工具闭环：用户口述错题 → agent 调 wrongbook_add → 错题本 3→4 条，题干/答案/错因正确
- 全部重启后数据仍在（SQLite 持久化）

启动方式：
- npm run milvus:up（RAG 需要）；npm run dev
- 页面：/chat 对话、/documents 资料库、/quiz 出题、/wrongbook 错题本、/mastery 掌握度、/exam 模考

关键决策与偏离（需评审知悉）：
1. 掌握度按知识点存储（设计 ER 图中 MASTERY 以 question_id 关联；BKT 本质按知识点追踪，故主键为 (learner_id, knowledge_point)，并保留对/错计数）。
2. 画像注入：在 chat() 每轮将 profileContext（学生信息 + 前5薄弱点 + 近10条记忆）拼到用户输入前，等价于 before_agent_start 注入；未启用 Pi 扩展运行时。
3. 出题/题库提取用 LLM（同一 qwen 端点）生成单选（A-D），判分确定性，便于 BKT 与错题联动；题库提取从文档切片生成（无 OCR）。
4. SM-2 采用简化版：quality≥3 间隔乘 ease，否则 1 天；ease 范围 1.3–3.0。
5. 模考会话题目 ID 持久化在 quiz_sessions.question_ids，重启后可恢复。
6. setup-matt-pocock-skills 技能本会话不可用，未使用。

遗留问题与风险：
- 模考未做"考试记录列表"页面（当前只展示本次结果）；设计中的 EXAM_PAPER 系列表属阶段 G 的考试复盘，本阶段用 quiz_sessions 承载模考
- 出题质量依赖模型输出 JSON 稳定性，已做容错解析
- S13 子智能体：需要把当前单 Tutor + 工具模式扩展为四角色路由