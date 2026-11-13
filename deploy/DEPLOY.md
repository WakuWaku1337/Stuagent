# 智学 Agent（EduPi）云服务器部署指南

适用场景：**单台 Linux 云服务器（Ubuntu 优先） + 直连 IP:端口（暂不备案） + 应用连外部 Milvus 向量库**。

整套部署基于项目自带的 `docker/docker-compose.cloud.yml`（只起 `edu-agent` 应用容器，不含 Milvus/etcd，符合「应用 + 外部 Milvus」方案）。

---

## 一、服务器准备

1. **系统与规格**
   - 推荐 Ubuntu 22.04 / 24.04。
   - 因 Milvus 在外部，本机只需 2 GB+ 内存、20 GB+ 系统盘即可；若日后把 Milvus 也搬到本机，需 8 GB+ 内存。
2. **开放端口**
   - 云厂商安全组：入站放通 `TCP 3000`（应用）。
   - 系统防火墙（若启用）：`sudo ufw allow 3000`。
   - Milvus 在外部，无需在应用服务器开放 19530。
3. **安装 Docker**
   - 脚本 `deploy/deploy.sh` 会自动检测并安装（腾讯云镜像源）；也可手动：
     ```bash
     curl -fsSL https://get.daocloud.io/docker | sudo sh
     sudo systemctl enable --now docker
     sudo usermod -aG docker $USER   # 重新登录后免 sudo
     # 校验 compose 插件
     docker compose version
     ```

## 二、准备生产配置 server/.env

```bash
cp deploy/env.prod.example server/.env
```

逐项填写，**至少**以下为必填 / 关键：

| 变量 | 说明 |
| --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 对话模型接入，必填 |
| `MILVUS_ADDRESS` | 外部向量库地址，如 `10.0.0.8:19530` / `milvus.example.com:19530`，必填 |
| `MILVUS_USERNAME` / `MILVUS_PASSWORD` / `MILVUS_TOKEN` | 外部 Milvus 若开启认证则填 |
| `EDUPI_SETTINGS_SECRET` | 安全主密钥，生成：`openssl rand -hex 32`，必填且务必备份 |
| `AUTH_BOOTSTRAP_USER` / `AUTH_BOOTSTRAP_PASSWORD` | 首管账号，建议填写，部署脚本会自动创建 |

> 公网直连建议保持 `REGISTRATION_OPEN=0`（关闭公开注册），由管理员建号，避免他人消耗你的 LLM 额度。`COOKIE_SECURE=auto` 在 HTTP 下不置 Secure，登录正常。

> `server/.env` 已被 `.gitignore` 忽略，不会进版本库；compose 通过 `env_file` 注入容器，密钥不写入镜像。部署脚本会**排除** `server/.env`，服务器上的 `.env` 由运维单独维护，不会被本地覆盖。

## 三、部署（两种方式）

### 方式 A：一键脚本（推荐，在本地开发机执行）
```bash
# 默认目标 root@8.148.185.212；可用环境变量覆盖
DEPLOY_SERVER=root@8.148.185.212 APP_PORT=3000 bash deploy/deploy.sh
```
脚本会：检查 `server/.env` → 安装 Docker（如缺）→ `rsync` 代码到服务器 → `docker compose up --build` → 自动 `auth:bootstrap` 创建首管。

### 方式 B：手动在服务器执行
```bash
# 1) 把项目传到服务器（任选其一）
#    scp -r 整个项目，或 git clone，或 rsync（排除 node_modules/uploads/data）
# 2) 登录服务器后
cd /opt/edu-agent/docker
docker compose -f docker-compose.cloud.yml up -d --build   # 容器绑定 127.0.0.1:3001，由宿主机 Nginx 对外
# 3) 首管（容器内读 server/.env 的 AUTH_BOOTSTRAP_* 非交互创建）
docker exec edu-agent npm run auth:bootstrap
# 或手动指定：docker exec edu-agent npm run auth:bootstrap -- --username admin --password 'xxx'
```

## 四、验证

```bash
# 容器内健康检查（应用监听 0.0.0.0:3000）
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
# 应返回 200（登录页 HTML）
docker compose -f docker-compose.cloud.yml logs -f edu-agent
```
浏览器打开 `http://<服务器公网IP>:3000` 用首管账号登录。容器健康检查会请求 `http://127.0.0.1:3000/health`，状态应为 `healthy`。

## 五、数据持久化与备份

- **SQLite / 记忆 / 课件镜像**：命名卷 `app_data`（compose 内已声明），持久化。
- **上传文件**：bind mount `server/uploads`，落在宿主 `server/uploads`。
- **备份**：`docker exec edu-agent npm run backup`（SQLite 备份到 `data/backups`）；上传目录单独 `tar`。生产建议加每日定时任务：
  ```bash
  # crontab -e
  0 4 * * * cd /opt/edu-agent/docker && docker exec edu-agent npm run backup -- --with-uploads
  ```

## 六、升级

重新跑 `bash deploy/deploy.sh` 即可（rsync 更新代码 + `up --build`）；数据在 `app_data` 卷与 `uploads` 中持久，不受影响。

## 七、已知限制（上线前须知）

- **无 HTTPS**：直连 IP:端口为 HTTP，浏览器**麦克风/录音不可用**（需安全上下文）；语音朗读、TTS 不受影响。建议后续配 Caddy/Nginx + Let's Encrypt（需已备案域名）。
- **语音 ASR 模型**：`server/models` 由镜像 COPY 而非挂载，模型不持久；如需语音识别，需把模型下载到持久目录并另行挂载。
- **扫描件 OCR**：未部署 `docling-serve` 时依赖视觉模型兜底，公式密集页可能不准。
- **占位页**：`/privacy`、`/terms` 仍为占位视图（需运营提供正文与备案号，属上线阻断项）。
- **公开注册**：已默认建议关闭；如需开放，将 `REGISTRATION_OPEN=1` 并考虑限流与风控。

### 多用户运行检查（v0.32）

- 只运行一个 `edu-agent` 容器，不要把同一个 `app_data` 卷挂给多个应用容器。
- `server/.env` 权限必须为 `600`；`EDUPI_SETTINGS_SECRET` 单独异地备份。
- 建议配置：`REGISTRATION_OPEN=0`、`AGENT_MAX_CONCURRENT=6`、`AGENT_MAX_CONCURRENT_PER_USER=2`、`AGENT_QUEUE_WAIT_MS=15000`、`AGENT_SESSION_MAX=300`、`AGENT_SESSION_TTL_MIN=60`。
- 部署后确认 `docker compose ps` 显示 `healthy`，并执行：
  ```bash
  docker exec -w /app/server edu-agent npm run check:multiuser:all
  ```
- 浏览器/接口验收：同会话并发返回 409；单用户超并发返回 429；双 key 连续多轮固定同一 key；`/health` 直连与 Nginx 均 200。
- 当前服务器仍为 HTTP；HTTPS 未完成前只适合邀请制小范围使用。

## 八、故障排查

| 现象 | 排查 |
| --- | --- |
| 容器起不来 / 镜像 build 失败 | `docker compose logs`；确认 `server/.env` 存在、`server/models` 目录存在 |
| 页面能开但对话报错 | 查 `LLM_*` 是否填对、模型是否支持；查 `MILVUS_ADDRESS` 是否可达 |
| 资料问答不可用 | 确认外部 Milvus 地址/认证正确，应用能连通 19530 |
| 登录 Cookie 异常 | 确认 `COOKIE_SECURE=auto`（HTTP 下不置 Secure） |
| 端口不通 | 查安全组与 `ufw allow 3000`，以及 `docker ps` 端口映射 |

## 九、宿主机 Nginx 统一入口（当前生产配置）

生产服务器 `8.148.185.212` 已改为宿主机 Nginx 监听公网端口，容器只绑定回环：

| 公网端口 | 后端容器 |
| --- | --- |
| 80 | `127.0.0.1:8081` ecom-store-front |
| 3000 | `127.0.0.1:3001` edu-agent |
| 8008 | `127.0.0.1:8009` ecom-agent-gate |
| 8100 | `127.0.0.1:8101` ecom-web-admin |

配置模板在 `deploy/nginx/`，安装与 HTTPS 说明见 `deploy/nginx/README.md`。Nginx 已为 EduPi/客服 SSE 关闭缓冲，并设置 3600s 读超时。