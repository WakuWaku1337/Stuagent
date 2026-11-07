# 智学 实施进度

当前阶段：A 环境与骨架 —— 已完成（S01、S02 验收通过）
已完成对话：S01 环境搭建、S02 工程骨架（2026-11-07，本次）
下一步对话（编号+目标）：S03 接入 Pi —— 后端内嵌 Pi，封装 /api/chat（非流式）+ provider/key 配置；验收：接口可完成对话

关键文件/接口：
- docker/docker-compose.yml：etcd（quay.io/coreos/etcd:v3.5.18）+ Milvus Standalone v2.5.4，gRPC 19530、健康检查 9091/healthz
- docker/milvus.yaml：从镜像提取的完整默认配置，仅改 common.storageType: local（见下方决策）
- server/src/index.ts：Hono 服务，端口 3000，GET /health
- web/：Vite + Vue3 + TS + Pinia + Vue Router + Axios，端口 5173，/api 与 /health 代理到 3000
- 根 package.json：npm workspaces（server、web），npm run dev（concurrently 并行启动）

验收证据（2026-11-07 实测）：
- S01：curl http://localhost:9091/healthz → OK；docker ps 两容器 healthy；Node SDK（@zilliz/milvus2-sdk-node）getVersion → pkg/v2.5.4，checkHealth → isHealthy:true；19530 TCP 可达
- S02：curl :3000/health → {"status":"ok",...}；浏览器打开 http://localhost:5173 首页显示"后端已联通"及 health JSON（Vite 代理生效）

启动方式：
- npm install
- npm run milvus:up（镜像已在本机；重启机器后需先启动 Docker Desktop）
- npm run dev（server 3000 + web 5173）
- npm run milvus:health 检查 Milvus

关键决策与偏离（需评审知悉）：
1. 免 MinIO：MinIO 官方镜像 2026-09-11 从 Docker Hub 下架（bitnami/minio 同步消失），quay.io/minio/minio 转私有不可拉。改用 Milvus 2.5 原生 common.storageType=local（数据落 /var/lib/milvus 卷），单用户本地场景功能等价、运维更简。设计文档 5.7.5 的"etcd+MinIO+Milvus 三件套"相应简化为两容器。BM25/RRF/HNSW 能力不受影响（S06 需实测确认 local 模式下 Function/索引正常）。
2. 镜像源：Docker Hub 直连被墙；milvusdb/milvus 走 docker.m.daocloud.io 成功；etcd 走 quay.io 直连成功。daocloud 不支持 quay.io 前缀、封禁 minio 仓库。
3. Node 实测 v24.14.0；npm registry 已为 npmmirror。
4. 设计文档引用的 setup-matt-pocock-skills 技能在本会话不可用，未使用。

遗留问题与风险：
- 阶段 B 需确定模型 provider（云端 API Key 或本地 Ollama，本机 Ollama 未安装，S01 中为可选项）
- S06 灌库前需验证 local 存储模式下 BM25 Function 与 HNSW 索引可用
- @zilliz/milvus2-sdk-node 目前以 --no-save 装在根 node_modules 供验证用；S06 时正式加入 server 依赖