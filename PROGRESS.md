# 智学 实施进度

当前阶段：G 考试复盘 —— 已完成（S15、S16 验收通过）
已完成对话：S01–S02（A）；S03–S04（B）；S05–S07（C）；S08–S12（D+E）；S13–S14（F）；S15–S16（G，2026-11-07 本次）
下一步对话（编号+目标）：S17 课件与安全 —— edulab 交互课件、安全 SDK（防注入/脱敏）；验收：课件可看、安全策略生效

关键文件/接口：
- server/src/learning/exams.ts：整卷识别（文本/图片）、EXAM 表读写、复盘分析（逐题判分、错因归类、BKT 与错题联动、报告生成）、趋势对比
- server/src/learning/vision.ts：多模态识别（图片 → JSON），模型 qwen3.8-flash 支持图片输入
- server/src/routes/reviews.ts：POST /api/reviews/recognize（multipart：图片/PDF/DOCX/文本）、GET /api/reviews、GET /api/reviews/compare、GET /api/reviews/:id、POST /api/reviews/:id/analyze
- server/src/store.ts：exam_papers / exam_questions / exam_reviews 表
- server/src/learning/tools.ts：新增 exam_analyze / exam_compare 工具（Analyst）
- web/src/views/ReviewView.vue：上传整卷（拍照/PDF/Word/文本）、考试记录、报告、逐题明细、ECharts 趋势图；路由 /review

验收证据（2026-11-07 实测）：
- S15 文本整卷：exam-1.md 识别 7 题、总分 50、得分 38，题型/知识点/学生答案/正确答案/老师批注错因全部结构化；exam-2.md 识别 6 题 48/50
- S15 拍照整卷：Edge 生成试卷截图 exam-photo.png → 视觉模型识别 2 题、14/20，勾叉批注转为 error_reason
- S16 复盘：exam-1 得分率 76%，失分知识点 2 个，新增错题 2 道，7 个知识点 BKT 更新（薄弱项 15%）；报告含总体/失分分布/错因/建议；exam-2 复盘 96%
- S16 趋势：3 次考试 76% → 96% → 70%，weakest 知识点累计失分排序；浏览器复盘页显示考试列表、报告、逐题明细与趋势图（canvas）
- Analyst 工具：对话"对比最近几次考试趋势"路由到 Analyst，输出趋势诊断（含"立体几何无数据"盲区提示）

关键决策与偏离（需评审知悉）：
1. OCR 采用多模态大模型（qwen3.8-flash 视觉输入）直接识别整卷，未引入独立 OCR MCP；PDF 走文本解析（扫描版 PDF 需先转图片）。
2. 判分以老师批改/卷面得分为准；错因优先采用卷面批注，缺失时由 LLM 在五类中归因。
3. 竞赛/考试选择题与解答题的 is_correct 以 got_score < full_score 判定失分；部分得分（如 8/14）也计入错题本。
4. 复盘报告与趋势结论由 LLM 基于统计事实生成，报告中的数字均来自数据；统计兜底模板在 LLM 失败时使用。
5. 未实现设计 7.1 的 EXAM_REVIEW.loss_analysis 独立字段文本化（以 JSON 存入 loss_analysis 列）。
6. setup-matt-pocock-skills 技能本会话不可用，未使用。

遗留问题与风险：
- 扫描版 PDF 未做逐页转图 OCR（可后续用 pdfjs 渲染 + 视觉模型）
- 识别结果无人工校对界面（当前直接落库，可加"编辑题目"能力）
- S17 需要 edulab/安全 SDK 的接入方案（课件可先做 HTML iframe 托管，安全做输入/输出策略）