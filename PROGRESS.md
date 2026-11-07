# 智学 实施进度

当前阶段：H 进阶与收尾 —— 已完成（S17、S18 验收通过）；已增加 Docker 本地部署
已完成对话：S01–S18 全部完成（A–H，2026-11-07）
下一步对话：无（设计文档 18 次对话已走完）；可选增强见"遗留问题与风险"

关键文件/接口：
- server/src/security/guard.ts：输入注入拦截（7 类规则）、PII 脱敏（手机/身份证/银行卡/邮箱）、输出过滤（脱敏 + sk-/Bearer/AKID 密钥）、流式 StreamRedactor（24 字符尾缓存，跨分片不漏检）
- server/src/courseware/service.ts：单文件交互课件生成（LLM 出 HTML + 校验；失败回退内置 canvas 模板），离线约束（禁止外链/CDN）
- server/src/courseware/tool.ts：Pi 工具 courseware_generate（Tutor/Solver 可用）
- server/src/routes/courseware.ts：/api/courseware（列表/生成/预览 HTML/删除），HTML 带 CSP 与 nosniff
- server/src/index.ts：/api/chat 接入安全检查（400 SECURITY_BLOCKED）、输入/输出脱敏、SSE security 事件；后端托管 web/dist（SPA 回退，API 404 保持 JSON）
- server/scripts/eval-rag.ts + server/testdata/eval-rag.json：RAG 评测集（8 题）与 Hit@K/MRR/延迟统计
- server/scripts/regression.ts：全流程回归（16 项）
- server/scripts/check-security.ts：安全单测（PII/密钥/注入/流式脱敏）
- web/src/views/CoursewareView.vue：课件页（生成、列表、沙箱 iframe 预览）；路由 /courseware

验收证据（2026-11-07 实测）：
- S17 安全：注入消息返回 400 {code:SECURITY_BLOCKED, matches:[override-instructions, prompt-exfiltration]}；手机号输入触发 input_redactions phone×1，模型只收到 138****8000（复述实验）；单测输出：138****8000 / a***@example.com / 110101********1234 / 6222********0123，sk-/Bearer 均被掩码；流式三片拼出 138****8000
- S17 课件：LLM 生成《勾股定理交互课件》（4123 字节，canvas+range，无外链），CSP 生效；浏览器打开 canvas 绘制 101,252 个非透明像素，拖动滑块画面变化；课件页 iframe（sandbox=allow-scripts）加载正常；生成失败时回退内置模板
- S18 评测：8 题 RAG 回归 Hit@1=100%、Hit@3=100%、Recall@5=100%、MRR=1.000、P50 371ms / P95 1313ms
- S18 托管：`:3000/` 与 `/chat` 返回 SPA（含 #app），`/api/not-exist` 返回 JSON 404
- S18 全流程回归：16/16 PASS（health、model、agents、documents、memory、mastery、wrongbook、reviews、courseware、tasks、RAG、注入拦截、SPA、SPA 回退、API 404、非流式对话）

启动方式：
- 开发：npm run milvus:up；npm run dev（server 3000 + web 5173）
- Docker（本地试用，2026-11-07 实测）：docker compose -f docker/docker-compose.yml up -d --build；访问 http://localhost:3000；数据挂载 server/data 与 server/uploads；容器内 Milvus 地址 milvus:19530；实测 health、模型、SPA、资料、RAG、对话（含引用）全部正常
- 回归：cd server && node --import jiti/register scripts/regression.ts；评测：scripts/eval-rag.ts；安全单测：scripts/check-security.ts

关键决策与偏离（需评审知悉）：
1. 安全为自研轻量策略（规则 + 脱敏 + 流式过滤），未接入 SuperAgent 安全 SDK（设计与 §4.3 均标注其为 P2 可选）。
2. 课件未移植 edulab 工程，采用"LLM 生成单文件 HTML + 校验 + 内置模板兜底"，满足离线可看与交互；3D 由 canvas 表现，非 Three.js。
3. 文档上传内容未做 PII 脱敏（仅对话链路），文档切片进入向量库前未过滤敏感信息。
4. 危险工具拦截未实现：当前工具集无 bash/edit 等系统级工具。
5. 评测集为 8 题小样本、单一标注来源，指标用于回归而非学术评测。
6. setup-matt-pocock-skills 配置已写入 AGENTS.md 与 docs/agents/*（GitHub 追踪器、默认标签、单上下文域文档）。

遗留问题与风险：
- GitHub 直连依赖 SteamTools TLS 代理 + 仓库级 CA；gh 尚未登录，triage 标签未创建；本地历史与远程初始提交不相关，尚未推送
- 扫描版 PDF 未逐页 OCR；复盘识别无人工校对界面
- 引用卡片会累积低相关项；后台任务单 Worker 串行且失败无重试
- 跨角色对话上下文不共享（画像/记忆/掌握度共享）