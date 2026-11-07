# 智学 实施进度

当前阶段：C RAG 知识库 —— 已完成（S05、S06、S07 验收通过）
已完成对话：S01–S02（A）；S03–S04（B）；S05–S07（C，2026-11-07 本次）
下一步对话（编号+目标）：S08 记忆画像 —— SQLite 表、memory 工具、钩子注入、wrongbook.add；验收：画像可跨会话读取

关键文件/接口：
- server/src/documents/parsers.ts：PDF（pdfjs-dist 逐页+页码）、DOCX（mammoth 标题层级）、DOC（word-extractor）、TXT（UTF-8/GBK 自动识别）、MD（标题栈）
- server/src/documents/chunker.ts：语义优先切片，800 字上限、80 字重叠、超长段落窗口切分
- server/src/documents/service.ts + routes/documents.ts：POST/GET/DELETE /api/documents、reparse、index；错误码符合设计 6.8.6（409/413/415/422 等），多文件 207 部分成功
- server/src/store.ts：node:sqlite（Node 24 内置）documents/chunks 表，data/edu.db
- server/src/rag/embedding.ts：text-embedding-v4（1024 维，阿里云百炼 OpenAI 兼容端点）
- server/src/rag/rerank.ts：gte-rerank-v2 Cross-Encoder（workspace 端点）
- server/src/rag/milvus.ts：edu_chunks 集合；dense HNSW(COSINE,M16,efC200)+sparse BM25 Function(jieba+cnalphanumonly)；混合召回 + RRFRanker(k=60)
- server/src/rag/service.ts：indexDocument / searchKnowledge（Top50 召回 → RRF → 精排 Top5 → 引用）
- server/src/rag/tool.ts：Pi 自定义工具 knowledge_search（学科过滤空结果自动回退全库）
- POST /api/knowledge/search：检索调试接口
- web/src/views/DocumentsView.vue：资料库上传/状态/重新灌库/删除；web/src/views/ChatView.vue：回复内引用卡片

验收证据（2026-11-07 实测）：
- S05：math-notes.md → 7 切片（章节路径三级正确）；geometry.txt → 1 切片；chemistry.pdf → 2 切片（page=1）；docx 样卷 → 13 切片；重复上传 409 DOCUMENT_EXISTS；PDF 解析修复后 reparse 正常
- S06：edu_chunks 建集合成功（BM25 Function + HNSW 索引，local 存储模式可用）；3 文档 10 切片全部 indexed；searchKnowledge 返回带 chunk_id/章节/页码/精排分
- S07：查询"勾股定理的三边关系"→ geometry.txt 精排 0.477 居首；非流式对话返回 5 条引用（含 chunk_id、页码）；浏览器 /chat 实测回复含 [1] 标注、8 条来源卡片、9 个 KaTeX 公式；/documents 页显示 3 份资料"已入库"；web 构建通过

启动方式：
- npm run milvus:up；npm run dev；浏览器 http://localhost:5173/documents 上传资料 → http://localhost:5173/chat 提问

关键决策与偏离（需评审知悉）：
1. Embedding/Reranker 改用阿里云百炼（text-embedding-v4 1024 维 + gte-rerank-v2），替代设计中的 BGE-M3/BGE-reranker 本地部署；接口同为三段式管线（混合召回→RRF→Cross-Encoder），维度 1024 与设计一致。
2. Milvus 仍为 local 存储（阶段 A 决策），BM25 Function/HNSW 已实测可用。
3. 切片尺寸：按章节语义切分，短小节保持 100-200 字整片（不强行凑 500 字），超长段落 800 字上限+80 重叠。
4. SDK 细节：字段用 `name`、Function 用 `type`、flush 用 `collection_names`（与设计文档示例的 field_name/function_type 不同，已按实际 SDK 修正）。
5. Pi 工具：knowledge_search 注册于 createAgentSession.customTools；引用通过 SSE citations 事件推送到前端。
6. setup-matt-pocock-skills 技能本会话不可用，未使用。

遗留问题与风险：
- 引用卡片会累积模型多次检索的候选（可能包含低相关项），后续可只保留模型实际引用的编号
- 同一文档重新灌库为"先删后插"；大规模数据需改增量方案
- S08 需要 SQLite 记忆表与钩子注入；Pi 钩子（before_agent_start/turn_end）尚未接入