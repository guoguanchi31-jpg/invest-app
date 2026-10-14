# 国内云部署

本方案适用于腾讯云轻量应用服务器、腾讯云 CVM、阿里云轻量应用服务器和阿里云 ECS。推荐 Ubuntu 22.04/24.04、2 核 4 GB、40 GB 系统盘。

## 架构

- `web`：Nginx，提供 React 静态文件、HTTPS 和 API 反向代理
- `backend`：FastAPI，仅在 Docker 内部网络监听
- `db`：PostgreSQL 16，仅在 Docker 内部网络监听
- `certbot`：按需签发和续期 Let's Encrypt 证书

Docker Compose 是当前完整且推荐的主部署方式，后端固定为单 worker，并负责每日
资产快照。仓库中的 Vercel 配置仅保留无状态 API 兼容入口：不会自动迁移数据库，
也不会启动进程内定时任务，因此不能单独承担完整生产运行。

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

脚本会安装 Docker Engine、Docker Compose 插件和运维备份所需的 Python 3。
已有服务器须具备 Python 3.10+。若当前用户被加入 `docker` 用户组，需要退出 SSH 后重新登录。

## 创建生产环境变量

```bash
./deploy/scripts/init-env.sh finance.example.com admin@example.com
```

脚本会创建权限为 `600` 的 `.env`，并随机生成：

- PostgreSQL 密码
- 默认家庭管理员的登录密码
- 令牌签名密钥

生产容器设置 `APP_ENV=production`。后端会拒绝缺少或强度不足的
`APP_PASSWORD`、`APP_AUTH_SECRET`，不会回退到本地开发默认值。

首次登录前查看或修改默认家庭、管理员账号和密码：

```bash
grep -E '^APP_(FAMILY_NAME|USERNAME|USER_NAME|PASSWORD)=' .env
```

首次启动后，这四项会用于创建默认家庭和管理员账号。后续成员账号请由管理员在应用的“家庭与成员”中创建；数据库已存在用户后，修改 `APP_PASSWORD` 不会重置其密码。

## 家庭账号与权限

- 每位成员使用独立账号登录，可在页面顶部切换“家庭”和“个人”数据范围。
- 普通成员可查看家庭汇总，但只能修改自己名下的账户、流水和持仓；管理员可维护全部成员数据。
- 管理员可在“家庭与成员”中改名、调整角色、重置密码，以及停用或恢复登录。停用登录不会删除成员及历史账目。
- 关键财务变更会记录实际操作人、时间和更正原因。
- JSON 备份使用成员稳定标识恢复归属；跨环境缺失的成员会恢复为待开通登录状态，并在恢复预览中展示映射。

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

后端容器在启动 Uvicorn 前执行 `python migrate.py`。迁移按版本记录，并在
PostgreSQL 上使用 advisory lock；`/healthz` 仅在数据库可连接且结构版本匹配时
返回成功，`/livez` 只表示进程仍可响应。

当前数据库结构版本为 11。重复执行 `python migrate.py` 是幂等的，失败时当前
事务回滚且不会登记成功版本；发布后可在 `/healthz` 的 `snapshot_job` 查看最近
一次开始、成功和失败的脱敏摘要。

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
迁移前会先对 SQLite 执行幂等的家庭账号结构升级，并包含家庭、成员登录关系及 `investment_trades` 买卖记录；脚本逐表核对源和目标记录数，任一不一致会回滚，不提交部分数据。目标数据库须先通过最新版后端初始化表结构。

## 更新

拉取新代码后重复执行：

```bash
./deploy/scripts/deploy.sh
```

只要数据库容器正在运行，脚本就会在更新前自动备份。

## 备份与恢复

应用右上角“备份与恢复”可下载当前家庭的完整 JSON。家庭管理员可选择 JSON 文件，查看各表恢复前后的记录数后确认覆盖当前家庭账本；其他家庭的数据不会被修改。恢复时若当前账本已变动，需要重新预览。恢复前副本保存在 `recovery_backups` Docker 卷中，成功后可从弹窗下载；SQLite 本地运行时保存在 `DB_DIR/backups`。此功能与下面的 PostgreSQL 运维备份并行使用。

当前结构版本为 schema 12，更新时先执行迁移。schema 9 新增账户历史基线和审计
载荷版本；schema 10 将可无歧义识别的历史紧凑日期转换为 ISO，并拒绝需要猜测的
存量格式；schema 11 追加命令指纹版本、数据范围元数据和旧快照兼容治理；
schema 12 将默认支出分类“购物”兼容迁移为“服饰”。
迁移不自动修改余额、`balance_applied` 或补造期初流水，且可重复执行。
当前 JSON 格式版本为 v8。金额、价格、数量和汇率以十进制字符串保存，保证
PostgreSQL `NUMERIC` 的精度可往返；v1-v7 仍可兼容导入。恢复前副本按
`family-{id}` 隔离。旧版根目录副本只有在文件内容能唯一证明属于当前家庭时才可
下载，不能仅凭管理员角色或文件名访问。

单家庭恢复先关闭只读连接并持久化恢复前副本，再获取家庭事务锁和复核指纹。
所有在线写入遵守同一家庭锁；恢复重新分配财务记录 ID，并重建外键、审计及转账引用。
审计内已知结构使用新 ID；无法识别的版本或结构明确保留为历史载荷。
恢复保留账单导入去重标识，不获取全库财务表排他锁或重置序列。前端会清理旧 ID
相关草稿与筛选，并刷新成员和账户；同一恢复请求的原键重试不会再次覆盖账本。

CSV 导出保留全部流水、收支方向、原币金额和历史汇率；CSV 导入用于收入与支出，逐笔确认疑似重复，排除转账、期初、调整及已撤销记录。完整迁移请使用 JSON 或数据库备份。早于账户建账日期的补录只进入历史收支统计，不重复增减当前余额。

投资更正采用“撤销后重新录入”：按录入顺序从最后一笔有效交易开始撤销，恢复原现金、数量与成本；升级前缺少成本快照的交易不能自动撤销。转账撤销同时回滚两端，并保留原记录和撤销原因。

手动备份：

```bash
./deploy/scripts/backup-postgres.sh
```

备份默认保存在 `backups/`，保留 14 天。输出文件名带 UTC 时间和随机后缀，权限
为 `600`。备份先在临时目录完成导出、压缩和完整性检查，再原子发布并 fsync；
失败不会把部分文件当成成功备份。`backup-status.json` 记录最近尝试状态、成功时间、
文件大小与 SHA-256。并发备份被拒绝；只有备份及已配置镜像都成功后才清理旧备份。

可用 `--retention-days 30` 调整本机保留时间。可选镜像目标应是已挂载的异机、
加密存储目录，例如：

```bash
./deploy/scripts/backup-postgres.sh --mirror-dir /mnt/invest-backup
```

镜像先复制到临时文件，校验 SHA-256 后发布。镜像失败返回非零状态并保留本机副本；
镜像端保留周期由该存储独立设置。仅传入另一条本机路径不会自动提供异地或加密保障。

检测最近一次是否成功、是否超过 26 小时以及本机/镜像是否损坏：

```bash
python3 deploy/scripts/postgres_backup.py check --max-age-hours 26
```

健康时输出 JSON 并返回 0；未成功、仍在运行、超期、文件损坏或镜像缺失均返回非零。
把该退出状态接入现有监控告警即可；脚本自身不会发送通知。

恢复会覆盖当前数据库，并在操作前再创建一次备份：

```bash
./deploy/scripts/restore-postgres.sh backups/<实际备份文件>.sql.gz --confirm-restore
```

恢复命令先验证并保留输入副本，避免恢复前新备份的保留清理删掉选中的旧文件。
随后停止应用，使用 PostgreSQL 单事务恢复；任何 SQL 失败都会回滚整次恢复，再重新
启动应用。应用停止失败时也尝试恢复服务。

使用隔离容器演练，不停止应用，也不连接生产数据库：

```bash
python3 deploy/scripts/postgres_backup.py drill backups/<实际备份文件>.sql.gz --expected-schema 12
```

演练启动 `postgres:16-alpine` 临时容器，无网络、无宿主机端口、无生产数据卷；
恢复后检查 schema 版本、表记录数、投资现金非负及账户/流水归属关联。成功与失败
都记录 `backups/invest-restore-drill-*.json`，包含恢复耗时、备份年龄、摘要与检查结果。
正常退出或捕获到中断后清理容器及临时卷；若清理失败，报告明确列出容器名称供处理。
备份年龄用于评估数据新鲜度，演练耗时只覆盖恢复验证阶段，不代表完整故障恢复 RTO。

建议使用服务器 `crontab -e` 添加：

```cron
0 3 * * * cd /opt/invest-app && ./deploy/scripts/backup-postgres.sh >> /var/log/invest-backup.log 2>&1
15 * * * * cd /opt/invest-app && python3 deploy/scripts/postgres_backup.py check >> /var/log/invest-backup-check.log 2>&1
20 3 * * * cd /opt/invest-app && ./deploy/scripts/renew-certs.sh >> /var/log/invest-certbot.log 2>&1
```

上述备份默认仍在同一台服务器。生产环境仍需配置加密的 COS/OSS 或异机镜像、
保留周期、监控通知接收方及定期演练计划。仓库提供执行和检测入口；本次代码改造
不会自动配置服务器 cron、存储挂载或发送告警，也不代表已完成线上容灾验收。

## 每日快照任务

Docker 默认设置 `ENABLE_SNAPSHOT_SCHEDULER=1`。后端启动时执行一次安全刷新，
之后按 `BUSINESS_TIMEZONE`（默认 `Asia/Shanghai`）在每日 `00:05` 刷新当天快照。财务
写入只同步刷新家庭汇总和受影响成员，定时任务才遍历全部家庭，各家庭独立事务。
时区通过会话返回前端，用于默认日期、月度筛选和日期快捷操作，不改写历史日期。

PostgreSQL advisory lock 用于阻止多个执行者同时刷新；标准 Compose 部署仍应
只保留一个启用该开关的后端服务。扩容时，仅一个实例设置为 `1`，其余设为 `0`。
任务状态可通过以下命令检查：

```bash
curl -fsS https://finance.example.com/healthz
docker compose logs --tail=200 backend
```

进程内任务不提供跨机器重试队列。当前同步刷新和持久化状态适合单实例部署；
若未来改为多实例，需先设计独立的持久化调度入口，不能只依赖内存任务。

`/livez` 只检查进程存活；`/healthz` 检查数据库连接和迁移版本，但历史后台任务
失败不会直接让 readiness 失败，避免无意义的容器重启循环。原始异常只写入受控
后端日志，公开接口不返回数据库行或财务正文。

## 幂等响应留存

财务命令的去重凭据长期保留，完整响应正文默认保留 90 天。到期后状态变为
`expired`，同键仍不会重新执行；账本恢复后的键保持 `invalidated`。
升级到 schema 11 及以上版本后不得删除 `financial_commands`、清空浏览器
`investPendingOperations:v1/v2`，也不得只回退前端：旧范围未知的操作必须保留原 ID
并先查询命令终态，不能用新键重新执行。

建议每天独立运行分批清理，不与快照任务绑定：

```cron
30 3 * * * cd /opt/invest-app && docker compose exec -T backend python -m jobs.financial_command_retention --batch-size 250 >> /var/log/invest-retention.log 2>&1
```

可通过 `FINANCIAL_COMMAND_RESPONSE_RETENTION_DAYS` 和
`FINANCIAL_COMMAND_RETENTION_BATCH_SIZE` 调整保留天数与批量大小。清理失败可
重复执行，不会删除去重墓碑或复活恢复前的操作键。

## Web 安全头与模拟器

Nginx 对 HTML、静态资源和代理响应统一应用安全头。标准同域部署的
`Content-Security-Policy` 使用 `connect-src 'self'`。若 Web 前端必须连接独立
API 域名，应在 `deploy/nginx/snippets/security-headers.conf` 中列出该确切 HTTPS
来源，不要恢复 `https:` 通配。Capacitor 原生包通过 `VITE_API_URL` 连接公网 API，
不依赖 Web Nginx 的 CSP 响应头。

默认 `npm run build` 和 Docker 前端镜像不输出模拟器。仅开发调试使用：

```bash
cd frontend
npm run simulator
```

该命令启动本地开发服务并直接打开 `/simulator.html`。如只需生成可预览产物：

```bash
cd frontend
npm run build:simulator
```

生产验收使用 `npm run verify:build`；Vite 每次构建会清空 `dist/`，避免增量发布
遗留旧的 `simulator.html` 或模拟器 chunk。

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
