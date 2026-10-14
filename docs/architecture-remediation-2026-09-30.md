# 架构审查完整改造验收

日期：2026-09-30。对应 [原始架构审查](architecture-review-2026-09-30.md) R1–R7。
范围为当前工作区，保留已有未提交修改；本次未发布或修改线上数据。

R1–R7 的代码与工程入口均已落实，本机可运行回归通过。真实 PostgreSQL 并发、
容器恢复演练及生产部署仍需外部环境验证，不能把 CI 文件当作已执行的证明。

## 问题与实现

| 项目 | 最终实现 | 证据 |
| --- | --- | --- |
| R1 提交状态 | 统一提交生命周期，先确认/结束意图，再刷新资源；失败读取不重新写入；未知结果复用原键，过期、失效、内容冲突返回机器码 | `frontend/src/features/shared/useSubmission.js`、`frontend/src/operations/operationStore.js`、`frontend/src/api.js`、`backend/application/commands.py` |
| R2 读取一致性 | 根查询拥有只读快照，所有子查询显式复用连接；汇总、分页、核对、预算、目标、恢复预览统一；仓库 GET 不写快照 | `backend/infrastructure/read_models.py`、`backend/infrastructure/database.py`、`backend/queries/finance.py`、`backend/queries/reconciliation.py`、`backend/queries/valuation.py` |
| R3 业务日期 | 统一 `BUSINESS_TIMEZONE` 和日历运算，会话同步前端；建账、记账、筛选、行情和快照采用同一日期，保留历史值 | `backend/domain/calendar.py`、`frontend/src/shared/businessDate.js`、`backend/application/authentication.py`、`backend/snapshot_scheduler.py` |
| R4 领域边界 | 余额规则保留纯 Decimal 计算；SQL 移入具体持久化模块；架构检查拒绝领域 SQL 与应用层未协调写事务 | `backend/domain/accounting.py`、`backend/infrastructure/accounting_store.py`、`backend/architecture_check.py` |
| R5 工程验证 | CI 启用产物校验、独立真实浏览器及真实 PostgreSQL；浏览器至少六项且零跳过，自动创建/清理临时账本 | `.github/workflows/ci.yml`、`frontend/scripts/real-api-e2e.mjs`、`frontend/scripts/verify-production-build.mjs` |
| R6 家庭恢复 | 所有在线写入遵守家庭锁顺序；锁外持久化副本，锁内复核指纹；数据库分配新 ID 并映射关联；恢复纳入幂等，不重置序列或全表排他锁 | `backend/application/backup.py`、`backend/infrastructure/restore_store.py`、`backend/application/commands.py`、`backend/tests/restore_cases.py` |
| R7 表单归属 | feature 拥有默认草稿、字段规则和动作；app 装配跨功能分派；shared 只保留通用状态与视觉能力 | `frontend/src/features/*/drafts.js`、`frontend/src/app/actionDefinitions.js`、`frontend/src/app/useActionWorkspace.js`、`frontend/src/architecture.test.js` |

家庭锁覆盖资金命令、成员/密码、分类、行情写回、快照和命令响应清理。统一顺序：
家庭事务锁 → 命令键 → 账户 ID 升序 → 流水/持仓/交易。快照批处理各家庭独立提交，
任务锁覆盖完整批次；失败可按业务日期重试。

恢复会映射分类父级、账户与成员、交易持仓、计划分配、审计实体及其 JSON、审计账户
关联和转账引用。不存在的历史审计实体使用 `legacy:` 标识。账户导入去重命名空间
跨恢复保留，避免 ID 变化后重复导入账单。前端清理旧草稿、筛选和明细，并刷新家庭成员。

## 运维闭环

新增 `deploy/scripts/postgres_backup.py`，现有 `backup-postgres.sh` 委托此入口：

- 备份采用私有临时文件、完整 gzip 校验、原子发布、文件/目录 fsync 和 SHA-256。
- 记录成功、失败、运行中及最近成功时间；并发备份被拒绝，失败不触发旧备份清理。
- 支持挂载目录镜像，镜像校验失败返回非零；`check` 检测失败、过期、缺失和损坏。
- `drill` 在无网络、无生产卷的独立 PostgreSQL 容器执行恢复，检查结构版本、
  记录数、投资现金与账户/流水关联，记录恢复耗时并清理容器。
- 整库恢复先保留输入副本，防止恢复前新备份清理掉已选旧文件；SQL 失败整体回滚，
  并恢复应用服务。

CI 的 `backup-restore-drill` 作业先创建全新 Compose 测试项目，再生成并恢复真实备份。
操作说明、监控退出码及 cron 示例见 [DEPLOYMENT.md](../DEPLOYMENT.md)。
脚本不自动开通远端存储、配置生产计划任务或发送通知。

## 实际验证

| 检查 | 本机结果 | 说明 |
| --- | --- | --- |
| 后端 unittest | 183 项：158 通过，25 跳过 | 24 项 PostgreSQL 流程及 SQLite 类中的 1 项 PG 专属 MVCC 测试跳过 |
| 运维故障注入 | 8 / 8 通过 | 失败导出、并发、损坏、过期、镜像失败、隔离清理、约束失败、旧恢复文件被清理及失败重启 |
| 前端 Vitest | 128 / 128 通过 | 22 个测试文件 |
| 前端覆盖率 | 语句 72.92%，分支 57.33%，函数 67.07%，行 75.92% | 全局覆盖率，不代表所有路径均已验证 |
| lint | 0 warning / 0 error | 含最终浏览器测试修改 |
| 默认生产构建 | 通过，13 个产物文件通过校验 | 无模拟器入口及本机调试端点 |
| 模拟 API 浏览器 | 9 / 9 通过 | 桌面、平板、手机：导航、日期筛选、长弹窗关闭操作 |
| 真实 SQLite 浏览器 | 6 / 6 通过，0 跳过 | 同上三端，每端两条完整业务/故障链路 |
| 现有本地账本迁移副本 | v7 → v8，通过 | 对源库只读复制，22 张既有表记录数不变；第二次迁移幂等 |
| 静态检查 | 通过 | 86 个 Python 文件语法、AST 架构规则、修改脚本 Bash 语法和 `git diff --check` |

真实浏览器第一条流程覆盖：登录、UI 记账、UI 转账、买入/卖出及逐笔撤销、
家庭/个人切换、从弹窗选择并预览备份、恢复新增成员、无需页面重载即可选择映射后账户、
同键恢复重放和最终余额。第二条流程在真实写成功后注入读取失败，确认只产生一条流水；
点击重新加载不会再写入，主动录入第二笔相同内容仍可成功。

本次验证日志位于本机 `/tmp/invest-*-final.log`；真实浏览器结构化报告位于
`frontend/test-results/real-api/report.json`。这些是本地生成文件，不作为源码提交。
临时浏览器账本/服务由 runner 清理；本轮临时 PostgreSQL 编译目录已清理。

## 迁移与部署

- 新结构版本为 **schema 8**，JSON 备份为 **v7**，兼容导入 v1–v6。
- 部署先执行 `python migrate.py`；标准后端容器入口已包含此步骤。
- `BUSINESS_TIMEZONE` 默认 `Asia/Shanghai`，无需逐条改写历史流水日期。
- 继续保持模块化单体、Decimal、交易历史汇率、家庭隔离和目标记录不占用真实资金。
- 进一步的生产发布及整库恢复应按部署文档执行；本轮没有执行。

## 尚无运行证据的环境

1. **真实 PostgreSQL 并发。** 本机未配置测试 URL 且无 Docker；尝试独立 PostgreSQL
   16.10 时，服务因 `postmaster became multithreaded during startup` 退出，未能执行
   PG 套件。CI 已使用 PostgreSQL 16 服务，仍需取得实际运行结果。
2. **真实容器备份演练。** 本机故障注入测试通过，但 Docker 演练只完成代码和 CI
   接入，尚无本次运行报告。
3. **生产 Nginx、原生 iOS/Android、远端备份和告警。** 未在真实部署/设备执行，
   不承诺线上响应头、原生行为、RPO/RTO 或容量指标。

这些限制不以修改生产数据库来补测。完整边界说明见
[architecture.md](architecture.md)，设计取舍见
[ADR](adr/2026-09-30-financial-boundaries.md)。
