#!/usr/bin/env bash
# 智学 Agent 一键部署脚本（在本地开发机执行，通过 SSH 推送并远程启动）
#
# 前置条件：
#   1. 本机能 SSH 到目标服务器。
#   2. 目标服务器已安装 Docker（脚本会 best-effort 自动安装）。
#   3. 服务器上的 /opt/edu-agent/server/.env 已配置好；本脚本不会覆盖它。
#
# 用法：
#   bash deploy/deploy.sh
#   或覆盖变量：
#   DEPLOY_SERVER=root@8.148.185.212 SSH_KEY=~/.ssh/aliyun_8.148.185.212.pem bash deploy/deploy.sh

set -euo pipefail

DEPLOY_SERVER="${DEPLOY_SERVER:-root@8.148.185.212}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/edu-agent}"
APP_PORT="${APP_PORT:-3000}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/aliyun_8.148.185.212.pem}"

LOCAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_USER="${DEPLOY_SERVER%%@*}"
if [ "$DEPLOY_USER" = "root" ]; then
  SUDO=""
else
  SUDO="sudo "
fi

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
if [ -f "$SSH_KEY" ]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

echo "▶ 本地项目根: $LOCAL_ROOT"
echo "▶ 目标服务器: $DEPLOY_SERVER:$DEPLOY_DIR"

# 1. 确保服务器有 Docker（best-effort）
echo "▶ 检查服务器 Docker..."
ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" "
  if ! command -v docker >/dev/null 2>&1; then
    echo '  - 未检测到 Docker，尝试安装...'
    curl -fsSL https://get.daocloud.io/docker | ${SUDO}sh
    ${SUDO}systemctl enable --now docker
    echo '  - Docker 已安装'
  fi
  docker --version
"

# 2. 同步代码（排除依赖/运行态/密钥；server/.env 由服务器自行维护）
echo "▶ 同步代码到服务器..."
ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" "mkdir -p '$DEPLOY_DIR/server/models'"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude node_modules --exclude '*/node_modules' \
  --exclude server/uploads --exclude server/data --exclude '*/data' \
  --exclude server/.env --exclude server/models \
  --exclude .git --exclude '*.log' --exclude .workbuddy --exclude .scratch \
  --exclude web/dist --exclude '*.docx' --exclude deploy \
  "$LOCAL_ROOT/" "$DEPLOY_SERVER:$DEPLOY_DIR/"

# 3. 远程构建并启动（cloud compose 不含 Milvus，应用连外部向量库）
echo "▶ 远程 docker compose up --build..."
ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" "cd '$DEPLOY_DIR/docker' && ${SUDO}docker compose -f docker-compose.cloud.yml up -d --build && ${SUDO}docker compose -f docker-compose.cloud.yml ps"

# 4. 首次初始化管理员（已有管理员会报错，可忽略）
echo "▶ 初始化首个管理员（若已存在会跳过）..."
ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" "cd '$DEPLOY_DIR/docker' && ${SUDO}docker exec edu-agent npm run auth:bootstrap" || echo "  （已有管理员或未配置 AUTH_BOOTSTRAP_*，跳过）"

# 5. 健康检查
echo "▶ 健康检查..."
sleep 3
ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" "curl -fsS http://127.0.0.1:3001/health && echo && curl -fsS http://127.0.0.1:${APP_PORT}/health && echo" || {
  echo "✗ 健康检查失败，请查看：ssh $DEPLOY_SERVER 'cd $DEPLOY_DIR/docker && ${SUDO}docker compose -f docker-compose.cloud.yml logs --tail=100 edu-agent'"
  exit 1
}

echo ""
echo "✅ 部署完成！访问：  http://<服务器公网IP>:${APP_PORT}"
echo "   查看日志：  ssh $DEPLOY_SERVER 'cd $DEPLOY_DIR/docker && ${SUDO}docker compose -f docker-compose.cloud.yml logs -f edu-agent'"
echo "   重置管理员：ssh $DEPLOY_SERVER 'cd $DEPLOY_DIR/docker && ${SUDO}docker exec edu-agent npm run auth:reset -- --username admin'"