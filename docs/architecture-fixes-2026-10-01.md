# 架构复审 F1–F5 修复与验收

日期：2026-10-01。范围：当前工作区，包括原有未提交改造。
关联 [复审报告](architecture-review-2026-09-30-recheck.md)、
[补充 ADR](adr/2026-10-01-resource-history-audit-contracts.md)、
[当前架构](architecture.md)。

后续边界复审发现的问题及最终闭环见
[第二轮修复与验收](architecture-fixes-2026-10-01-round-2.md)。

## 修复结果

五项已确认问题已完成实现与本地回归。沿用模块化单体，完善共享契约与领域规则；
本次未操作真实账本、发布应用或执行生产迁移。

| 问题 | 最终行为 | 主要实现 |
|---|---|---|
| F1 行级提交无法解除 | 对应资源成功重读后允许下一次操作；手动、自动、局部刷新采用同一确认规则。提交前发起的 GET、其他月份/身份、未知结果和进行中的提交不能解除原意图 | `frontend/src/features/shared/resourceConfirmation.js`、`useSubmission.js`、`useScopedDataResource.js`，以及 app/目标/账户装配 |
| F2 历史完整性误判 | 余额匹配与历史来源分别报告；只有显式零期初或有完整证据的期初流水基线才标为可重建，调整不补造过去的事实 | `backend/domain/reconciliation.py`、`queries/reconciliation.py`、账户创建与备份校验 |
| F3 恢复审计混用 ID | 通过版本化实体结构映射目标、分配、目标记录、预算、交易及账户/持仓快照；未知载荷保留明确的历史命名空间，删除实体稳定使用 `legacy:` | `backend/domain/audit_payloads.py`、`infrastructure/restore_store.py`、`audit.py` |
| F4 并发测试排除合法顺序 | 同时接受合法序列化结果，并强制覆盖三种首写者；逐项验证资金、流水、持仓、交易、审计和重放 | `backend/tests/concurrency_cases.py`，SQLite/PostgreSQL 共用 |
| F5 月份测试随日期失败 | 固定月份场景只固定业务时钟；独立覆盖上海时间跨月创建和查询 | `backend/tests/clock.py`、`test_family_accounts.py`、`test_domain_rules.py`、共享数据库工作流 |

## 关键契约

### 提交与读取

公共资源记录当前身份、资源键和读取开始的单调事件序号。写入进入
`committed/invalidated` 时记录终态序号；后续成功读取必须晚于该终态且匹配资源。
行级动作在下一次调用前释放已获得确认的意图，仍进行中的写入或刷新继续防重。
结果未知继续复用原操作键；表单“再记一笔”继续明确创建新意图。

浏览器已验证：标记完成 → GET 故障 → 点击重新加载 → 恢复 → 再次标记完成。
三个真实 PATCH 使用三个不同的操作键，最终服务端目标状态为 completed。

### 历史证明

schema 9 新增 `accounts.history_basis`：

- `unknown`：没有可证明的期初来源，迁移旧数据及缺元数据备份采用此值。
- `opening_transaction`：显式期初流水基线，须有唯一有效、影响余额且日期匹配的期初记录。
- `zero_opening`：新建时明确零余额，且没有矛盾的期初流水。

`history` 返回完整性、来源、基线日期/金额和状态字段；
`matches` 只表达当前差额。普通账户与负债账户保留负值语义，投资账户核对结算现金。
缺失 1000 元历史的账户从 1000 调为 1050 后，expected=50、difference=1000，
仍为历史不完整；差额碰巧为零也不会变为完整。

### 审计恢复

schema 9 新增 `audit_events.payload_version`。新事件为 1，旧事件默认 0；
两个版本的已知结构通过显式映射处理。未知版本/结构封装为
`_id_namespace=historical` 并保留原值。失去实体引用的 ID 保留 `legacy:`，
再次恢复不会叠加此前缀。账户成员、实体外键、家庭编号和转账引用同时更新，
金额、价格、数量和业务日期保持原值。

### 并发与时钟

初始现金 1000，转出 200、买入 300，核对请求带 expected=1000/actual=900：

- 核对先获锁：三个操作成功，最终现金 400。
- 转账或买入先获锁：核对返回 409，两个操作成功，最终现金 500。

测试还检查成功命令重放不会增加流水、审计或改变资金。时钟夹具仅替换
`domain.calendar.datetime`，不改变认证和超时钟；跨月规则另行验证。

## 兼容与迁移

- schema 8 → 9 只追加迁移，不修改已应用的历史迁移。
- 旧账户保持余额和流水不变，历史来源默认为 unknown。
- JSON v8 携带新元数据，兼容读取 v1–v7；无证据的显式基线在预览阶段拒绝。
- 现有家庭锁、恢复前副本、原子提交、外部账单去重和 Decimal 规则继续使用。
- 部署时由既有部署脚本先执行迁移；生产应用仍只校验版本。
- 迁移测试验证旧账户全部已有字段不变，重复迁移不重复修改。

## 本地验证

| 检查 | 结果 |
|---|---|
| 后端全量 unittest | 203 项：173 通过，0 失败，30 跳过 |
| 前端全量 Vitest | 27 文件、153 项通过 |
| 真实 API 浏览器 | 桌面/平板/手机共 9 项通过，0 跳过 |
| 模拟 API 浏览器 | 19 通过，2 跳过；显式多宽度矩阵仅桌面项目执行一次 |
| 运维脚本故障注入 | 8 项通过 |
| 前端 lint | 0 warning、0 error |
| 生产构建与产物检查 | 通过，14 个产物文件 |
| 架构 AST 检查 | 通过 |
| 最后契约回归 | 后端领域/并发/恢复 11 项、前端提交 15 项通过 |
| 历史兼容补充回归 | 12 项通过，包括 SQL 默认字段省略与无效期初证据 |
| 浏览器报告保留 | 按真实 → 模拟顺序执行后，真实 9 项报告与后端/前端日志仍存在 |
| diff 空白检查 | 通过 |

后端测试使用隔离临时 SQLite；真实接口浏览器启动专用后端与端口，
产物在 `frontend/test-results/real-api/`。收尾发现默认模拟浏览器输出目录会清除
整个 `test-results/`，已将其隔离至 `test-results/mock-api/`；真实流程仍写入
`test-results/real-api/browser/`，避免另一套测试清掉真实接口报告。
全量日志位于本次会话的
`/tmp/invest-fixes-{backend-full,frontend-full,real-browser,mock-browser,ops,lint,build}.log`。

### 尚缺外部环境验证

本机没有 Docker、Podman、psql、pg_isready，未配置 `INVEST_TEST_POSTGRES_URL`，
本地 5432/55432 端口不可用。30 项跳过包括 29 项 PostgreSQL 工作流以及 SQLite
套件中的 1 项 PostgreSQL 专属 MVCC 测试。真实 PostgreSQL 和容器备份恢复演练
本次未执行；CI 已有对应入口，但没有将 CI 配置视为运行成功证据。
