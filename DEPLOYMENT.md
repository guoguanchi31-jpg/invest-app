# 国内云部署

本方案适用于腾讯云轻量应用服务器、腾讯云 CVM、阿里云轻量应用服务器和阿里云 ECS。推荐 Ubuntu 22.04/24.04、2 核 4 GB、40 GB 系统盘。

## 架构

- `web`：Nginx，提供 React 静态文件、HTTPS 和 API 反向代理
- `backend`：FastAPI，仅在 Docker 内部网络监听
- `db`：PostgreSQL 16，仅在 Docker 内部网络监听
- `certbot`：按需签发和续期 Let's Encrypt 证书

网页和 API 使用同一个域名，例如 `https://finance.example.com`。移动端将该地址配置为 `VITE_API_URL`。

## 上线前准备

1. 完成域名实名认证，并将域名 A 记录指向云服务器公网 IP。
2. 中国大陆服务器绑定域名通常需要 ICP 备案；移动应用公开分发还需确认 App 备案要求。
3. 云安全组只开放：
   - `22/tcp`：仅允许可信 IP
   - `80/tcp`：HTTP 和证书验证
   - `443/tcp`：HTTPS
4. 不要开放 PostgreSQL 的 `5432` 端口。

## 安装 Docker

把项目放到服务器，例如 `/opt/invest-app`，然后执行：

```bash
cd /opt/invest-app
sudo ./deploy/scripts/bootstrap-ubuntu.sh
```

脚本会安装 Docker Engine 和 Docker Compose 插件。若当前用户被加入 `docker` 用户组，需要退出 SSH 后重新登录。

## 创建生产环境变量

```bash
./deploy/scripts/init-env.sh finance.example.com admin@example.com
```

脚本会创建权限为 `600` 的 `.env`，并随机生成：

- PostgreSQL 密码
- App 登录密码
- 令牌签名密钥

首次登录前查看或修改 App 密码：

```bash
grep '^APP_PASSWORD=' .env
```

不要提交 `.env`，也不要把它上传到聊天、工单或公开日志。

## 首次部署

```bash
./deploy/scripts/deploy.sh
```

确认 DNS 已经解析到当前服务器后启用 HTTPS：

```bash
./deploy/scripts/enable-https.sh
```

验证：

```bash
docker compose ps
curl -fsS https://finance.example.com/healthz
```

更新后还需通过网页域名检查账本代理（不要使用后端直连地址）：

```bash
docker compose exec -T backend python verify_ledger_endpoint.py \
  --url https://finance.example.com
```

该只读检查使用容器内的登录签名配置，确认 `/ledger` 返回 JSON、`/ledger/export` 返回含方向与历史汇率的 CSV；返回前端 HTML 时会报错。不会输出令牌或账本明细。

## 迁移现有 SQLite 数据

首次部署会创建空的 PostgreSQL 数据库。如果需要迁移当前 `backend/invest.db`，执行：

旧版流水没有保存发生时汇率。迁移前先检查待补录记录：

```bash
backend/venv/bin/python backend/migrate_transaction_fx.py \
  --sqlite backend/invest.db \
  --export legacy-transaction-fx.csv
```

在 CSV 的 `exchange_rate_to_base` 列填写每笔流水发生时相对 CNY 的汇率，再应用：

```bash
backend/venv/bin/python backend/migrate_transaction_fx.py \
  --sqlite backend/invest.db \
  --apply legacy-transaction-fx.csv
```

本位币流水会自动按汇率 1 完成升级；缺少历史汇率的外币流水不会按 1 猜测，后端会在补录完成前拒绝启动。

完成汇率补录后再迁移到 PostgreSQL：

```bash
./deploy/scripts/migrate-sqlite.sh backend/invest.db --confirm-replace
```

该命令会先备份 PostgreSQL，再短暂停止网页和 API，用 SQLite 内容替换 PostgreSQL 数据，最后重新启动服务。
迁移包含 `investment_trades` 买卖记录；脚本逐表核对源和目标记录数，任一不一致会回滚，不提交部分数据。目标数据库须先通过最新版后端初始化表结构。

## 更新

拉取新代码后重复执行：

```bash
./deploy/scripts/deploy.sh
```

只要数据库容器正在运行，脚本就会在更新前自动备份。

## 备份与恢复

应用右上角“备份与恢复”可下载完整 JSON，或选择 JSON 文件，查看各表恢复前后的记录数后确认整体覆盖。恢复时若当前账本已变动，需要重新预览。恢复前副本保存在 `recovery_backups` Docker 卷中，成功后可从弹窗下载；SQLite 本地运行时保存在 `DB_DIR/backups`。此功能与下面的 PostgreSQL 运维备份并行使用。

CSV 导出保留全部流水、收支方向、原币金额和历史汇率；CSV 导入用于收入与支出，逐笔确认疑似重复，排除转账、期初、调整及已撤销记录。完整迁移请使用 JSON 或数据库备份。早于账户建账日期的补录只进入历史收支统计，不重复增减当前余额。

投资更正采用“撤销后重新录入”：按录入顺序从最后一笔有效交易开始撤销，恢复原现金、数量与成本；升级前缺少成本快照的交易不能自动撤销。转账撤销同时回滚两端，并保留原记录和撤销原因。

手动备份：

```bash
./deploy/scripts/backup-postgres.sh
```

备份默认保存在 `backups/`，保留 14 天。建议额外同步到腾讯云 COS 或阿里云 OSS。

恢复会覆盖当前数据库，并在操作前再创建一次备份：

```bash
./deploy/scripts/restore-postgres.sh backups/invest-YYYYMMDD-HHMMSS.sql.gz --confirm-restore
```

建议使用服务器 `crontab -e` 添加：

```cron
0 3 * * * cd /opt/invest-app && ./deploy/scripts/backup-postgres.sh >> /var/log/invest-backup.log 2>&1
20 3 * * * cd /opt/invest-app && ./deploy/scripts/renew-certs.sh >> /var/log/invest-certbot.log 2>&1
```

## 构建移动端

网页使用同域 API，不需要设置 `VITE_API_URL`。iOS/Android 原生包必须使用公网 HTTPS 地址：

```bash
cd frontend
VITE_API_URL=https://finance.example.com npm run mobile:sync
```

之后分别使用 Android Studio 或 Xcode 完成签名和发布。

## 常用运维命令

```bash
docker compose ps
docker compose logs -f --tail=200 backend
docker compose logs -f --tail=200 web
docker compose restart backend
docker compose exec web nginx -t
```

若 Docker 官方软件源在服务器网络中不可达，应按照对应云厂商文档配置 Docker CE 软件源或镜像加速器，再重新运行安装脚本。
