# Invest 架构审查

日期：2026-09-30。范围：当前工作区，包含已有未提交修改和未跟踪的分层代码。
本报告评估实际调用链，线上部署版本、流量和运维配置未核实。审查期间未修改业务实现；
故障复现使用临时测试文件和临时 SQLite 数据库，结束后已清理。

## 1. 总体结论

| 项目 | 结论 |
|---|---|
| 架构合理度 | 基本合理 |
| 综合评分 | 78 / 100，按小型家庭财务应用规模评估 |
| 一句话结论 | 模块化单体和现有事务模型可以继续使用，但提交结果、查询一致性和业务日期三个边界仍有可复现缺陷。 |
| 最突出的优点 | 财务事实、账户状态、审计、幂等与快照已有明确的事务协调，财务规则有跨流程回归。 |
| 最大的架构风险 | 服务端提交状态与前端表单状态没有闭合，已成功的资金操作可能被再次当作新操作提交。 |
| 是否需要立即重构 | 否；需要立即修复 R1，并尽快处理 R2、R3。其余按功能迭代渐进调整。 |
| 判断依据 | 真实启动链、60 个后端模块的 187 条静态导入边、关键读写代码、既有测试及故障注入。静态导入图未发现环。 |

本次执行结果：

| 检查 | 结果及边界 |
|---|---|
| 后端 unittest | 152 项，141 通过，11 项真实 PostgreSQL 用例跳过 |
| 前端 Vitest | 103 / 103 通过；语句覆盖率 70.42%，分支 58.93%，行 73.38% |
| lint | 0 warning / 0 error |
| 生产构建及产物校验 | 通过；校验器检查 13 个产物文件 |
| 默认 Playwright | 执行结束状态 passed；9 项模拟 API 用例，覆盖桌面、平板、手机；3 个真实 API 项按配置跳过 |
| 独立故障注入 | 确认重复提交路径、过期操作键重建路径、UTC 日期偏移 |
| 临时 SQLite 真实写入 | 确认查询组合出 900 / 1100 元而稳定资产为 1000 元；确认错误日期触发建账前流水语义 |
| PostgreSQL / Nginx / 原生客户端 | 本次没有真实环境运行证据，无法给出完整通过结论 |

既有测试通过说明已覆盖路径可工作；本次故障注入补充了原套件未覆盖的组合场景。
P0 表示必须立即处理的已证实缺陷，不表示已经核实生产事故。

## 2. 架构还原

### 运行链路

本地 `npm run dev` 调用 `frontend/scripts/dev.mjs`，管理 Vite 与本地 FastAPI。
前端开发模式通过 `frontend/src/api.js` 访问 8000 端口。生产 Compose 启动
PostgreSQL、FastAPI 和 Nginx；Nginx 提供静态资源，把其余路径转给 API。
后端容器先执行迁移，再启动一个 Uvicorn worker。

具体证据：

- [本地启动器](../frontend/scripts/dev.mjs#L39-L61)
- [前端 API 地址选择](../frontend/src/api.js#L1-L19)
- [后端容器入口](../backend/Dockerfile)
- [Compose 部署拓扑](../docker-compose.yml)
- [Nginx 路由](../deploy/nginx/snippets/app-locations.conf)
- [应用启动与路由注册](../backend/main.py#L26-L109)

`main.lifespan` 校验安全配置、数据库版本，按配置启动快照任务。
鉴权依赖把同步身份查询交给线程，再在请求协程设置 `AuthContext`；
同步业务路由由框架在线程池执行。Vercel 配置关闭自动迁移和进程内调度，
属于受限 API 运行入口。Capacitor 复用 `dist`，原生模式必须配置 API 地址。

### 核心模块与真实职责

| 模块 | 当前职责 | 具体证据 |
|---|---|---|
| 前端页面与装配 | 导航、页面视图模型、日期选择和跨功能弹窗装配；页面懒加载 | [App.jsx](../frontend/src/App.jsx#L65-L70)、[保存计划编排](../frontend/src/App.jsx#L1039-L1062) |
| 前端资源状态 | 按页面启用资源；身份、scope、请求版本隔离；定时刷新 | [useFinanceData](../frontend/src/app/useFinanceData.js)、[useScopedDataResource](../frontend/src/features/shared/useScopedDataResource.js) |
| 前端写入 | feature actions 构建请求；operationStore 管理业务操作；api.js 管理传输及旧响应 | [actions](../frontend/src/features/ledger/actions.js)、[operationStore](../frontend/src/operations/operationStore.js)、[api.js](../frontend/src/api.js) |
| HTTP | 参数解析、认证依赖、响应；资金接口套用命令装饰器 | [transactions router](../backend/routers/transactions.py#L79-L119) |
| 应用用例 | 账户、流水、投资、预算、目标、家庭与恢复的授权、锁和业务编排 | [application](../backend/application/) |
| 领域规则 | Decimal、账户不变量、估值、预算分配；accounting 仍混有 SQL | [domain](../backend/domain/)、[accounting](../backend/domain/accounting.py#L31-L175) |
| 查询 | 资产、收支、预算、目标、趋势及只读核对；部分查询仍在 application | [finance](../backend/queries/finance.py)、[ledger 查询](../backend/application/ledger.py#L124-L367) |
| 数据基础设施 | 连接、事务、驱动占位符适配；冻结的历史建表基线 | [database](../backend/infrastructure/database.py)、[connection](../backend/infrastructure/connection.py) |
| 迁移和样例 | schema v1–v7 的增量变化；显式启用的开发样例 | [migrations](../backend/migrations/schema.py)、[fixtures](../backend/fixtures/demo.py) |
| 行情与后台任务 | 外部报价读取、条件写回、快照调度、幂等响应保留清理 | [market_data](../backend/application/market_data.py)、[scheduler](../backend/snapshot_scheduler.py)、[retention](../backend/jobs/financial_command_retention.py) |

架构模式是**模块化单体、应用用例与查询分离、直接 SQL 访问数据库**。目前并非完全
独立的领域核心：application 使用 FastAPI/Pydantic 类型，domain.accounting 执行 SQL。
没有发现需要靠引入消息系统或拆服务才能解决的当前问题。

### 主要数据流

```text
资金写入：
页面表单 → feature action → api.js / operation ID
  → require_auth → router 的 financial_command
  → 应用用例（同一连接、账户锁、权限与业务校验）
  → 流水或交易事实 + 账户/持仓状态
  → 审计事实 + 最终现金检查 + 当天快照 + 幂等响应
  → 一次提交 → 前端确认结果 → 刷新相关资源

读取：
页面资源 Hook → GET → 身份/scope 过滤
  → 查询函数 → 多张表组合 → 视图模型 → 页面
  当前缺口：部分多语句、多连接查询没有同一读取快照。

行情：
读取持仓 → 关闭连接 → 限制并行数请求行情
  → 新事务内按旧值条件更新 → 快照 → 汇总响应
```

`transactions`、`investment_trades` 是财务事实；`accounts`、`holdings` 保存当前状态；
`snapshots` 是派生估值；`goal_records` 是进度，不冻结或移动真实资金。
`financial_commands` 是请求去重记录，前端 operationStore 是业务意图状态，
两者与请求世代应分别管理。

顶层 `backend/database.py`、`services.py` 等是兼容入口，已核实其转发关系，
不应把这些薄文件认定为第二套业务实现。

## 3. 做得合理的地方

| 架构点 | 具体证据 | 带来的价值 |
|---|---|---|
| 单体规模合适 | [Compose](../docker-compose.yml)、[main](../backend/main.py) | 一套部署和本地事务足以覆盖家庭账本，运维负担可控。 |
| 财务写入集中协调 | [financial_command](../backend/application/commands.py#L89-L208) | 资金事实、审计、约束、快照、幂等结果一起成功或回滚。 |
| 金额和估值规则共享 | [money](../backend/domain/money.py#L1-L47)、[valuation](../backend/domain/valuation.py) | 减少浮点计算与逐笔/汇总舍入口径分歧。 |
| 历史汇率保留 | [updated_transaction_money](../backend/application/ledger.py#L92-L108) | 修改非金额字段不会按当前汇率重算历史。 |
| 并发写入有实际防线 | [投资交易锁](../backend/application/investing.py#L113-L136)、[现金条件更新](../backend/application/investing.py#L178-L191) | 锁内复核、现金条件更新及数据库约束保护资金状态。 |
| 权限以家庭与归属判定 | [tenancy](../backend/tenancy.py#L50-L118)、[恢复文件授权](../backend/application/backup.py#L831-L838) | 缺少身份立即失败，家庭边界与成员写权限有集中入口。 |
| 前端生命周期已有隔离 | [api 身份检查](../frontend/src/api.js#L66-L88)、[资源版本检查](../frontend/src/features/shared/useScopedDataResource.js#L29-L75) | 旧响应不会直接填入新身份或新 scope 的当前资源。 |
| 行情 I/O 不占用数据库连接 | [关闭读连接](../backend/application/market_data.py#L21-L35)、[网络阶段和条件写回](../backend/application/market_data.py#L83-L105) | 外部服务慢或返回旧数据时，不必一直持有资金事务。 |
| 目标和真实资金分离 | [目标记录](../backend/application/goals.py#L291-L378)、[禁用资金快照刷新](../backend/routers/goals.py#L58-L67) | 避免目标积累被重复计入资产。 |
| 迁移、备份和运行记录可追踪 | [版本迁移](../backend/migrations/schema.py)、[一致性备份](../backend/application/backup.py#L788-L792)、[任务状态](../backend/snapshot_scheduler.py#L153-L199) | 支持回滚定位、恢复校验及任务失败排查。 |

数据库行以 dict 形式进入简单业务函数，Pydantic 同时承担输入验证，在当前规模下可以
接受。没有证据表明需要立即引入 ORM、依赖注入容器或全套实体映射。

## 4. 问题与风险清单

成本为一位熟悉项目的开发者估算，包含相关回归，不包含等待外部环境。

| 优先级 | 问题 | 具体证据 | 影响 | 建议方案 | 改造成本 |
|---|---|---|---|---|---|
| P0 / R1 真实问题 | 已提交操作因刷新失败或错误分类重新变成新操作 | [表单提前返回](../frontend/src/features/shared/useActionWorkspace.js#L418-L454)、[写入状态判定](../frontend/src/api.js#L159-L166)、[操作记录删除](../frontend/src/operations/operationStore.js#L163-L168) | 重复流水、转账或其他增量写入；服务端幂等无法合并不同键 | 分离提交确认与刷新结果；表单保留提交终态；服务端返回可机器识别的已处理/过期状态 | 最小 1–2 天；完整 3–4 天 |
| P1 / R2 真实问题 | 组合财务查询缺少统一读取事务 | [账户后读持仓](../backend/queries/finance.py#L190-L210)、[汇总另开持仓连接](../backend/queries/finance.py#L770-L802)、[核对多次读取](../backend/queries/reconciliation.py#L8-L53) | 并发交易可造成瞬时虚增/虚减资产，核对也可能误报差异 | 复用 consistent_read_connection，显式把同一连接传给所有子查询 | 2–3 天 |
| P1 / R3 真实问题 | 业务日期混用 UTC 与上海日历日期 | [UTC 默认日期](../frontend/src/features/shared/actionForm.js#L4-L10)、[生产 TZ](../docker-compose.yml#L56)、[建账日期判定](../backend/application/ledger.py#L720-L739) | 凌晨记录落到前一天/月；新建账账户可能把当日支出当成建账前历史，不扣余额 | 定义唯一业务时区；统一业务日期/月份工具，保留历史日期字符串 | 1–2 天 |
| P2 / R4 真实边界缺口 | 领域层仍执行 SQL，现有架构检查没有检查这种依赖 | [三个 SQL 函数](../backend/domain/accounting.py#L31-L175)、[检查仅限制导入](../backend/architecture_check.py#L86-L95) | 规则测试和复用依赖数据库；文档“纯领域”与代码不符，新增 SQL 仍可通过检查 | 只抽离三个函数的读写部分，保留纯金额/状态计算；增加领域层禁止 SQL 调用的检查 | 1–2 天 |
| P2 / R5 真实工程缺口 | CI 未启用真实浏览器链路和现有生产产物验证器 | [CI 前端步骤](../.github/workflows/ci.yml#L37-L54)、[真实测试开关](../frontend/e2e/real-api.spec.js#L4-L5)、[跳过条件](../frontend/e2e/real-api.spec.js#L30-L33) | 前后端契约和部署产物问题可漏过绿灯 | 接入隔离后端浏览器作业，明确真实测试数量；build 改为 verify:build | 1–2 天 |
| P2 / R6 潜在扩展风险 | 单家庭恢复获取全体财务表 ACCESS EXCLUSIVE 锁，锁内写本地备份文件 | [restore](../backend/application/backup.py#L719-L756) | 大备份或多家庭并发时，其他家庭读写也会阻塞 | 当前保留安全实现并观察耗时；扩展前设计所有写入口共同遵守的家庭恢复协调及 ID 映射 | 观测约半天；改锁协议 3–5 天 |
| P3 / R7 可选优化 | 跨功能表单编排仍集中在一个工作区 Hook 和 ActionDialog | [提交分派](../frontend/src/features/shared/useActionWorkspace.js#L390-L417)、[跨功能字段装配](../frontend/src/features/shared/ActionDialog.jsx#L7-L43) | 新增表单类型要修改集中分支，修改范围逐渐扩大 | 随新增功能拆出 feature 草稿/提交器，跨功能协调留在 app；共享层只复用弹窗和生命周期能力 | 随功能约 1–3 天 |

R2 的复现错误停留在查询响应，未证实它会破坏持久化余额；因此与 R1 区分优先级。
R6 当前优先保证恢复安全，不能仅把表锁删掉或替换成只有恢复路径获取的家庭锁。

## 5. 重点问题深入分析

### R1：前端尚未表达“已提交但展示未刷新”

1. **当前实现方式**

   `api.writeJson` 收到成功响应即标记操作 succeeded，operationStore 删除对应记录。
   `submitAction` 随后等待 `loadData()`；后者汇总所有启用资源的刷新结果。
   任何一个返回 false，函数就在关闭/重置表单前退出，但 finally 会解除提交锁。
   [调用与返回位置](../frontend/src/features/shared/useActionWorkspace.js#L418-L454)。

2. **为什么存在问题**

   页面刷新成败决定了是否结束已成功的业务表单。用户重试原表单时，已删除的操作键被
   新键替代，后端按新的业务操作执行。这是两个状态生命周期之间的缺口。

   另一个同类缺口是所有 4xx 被归为 failed。服务端可能用 409 表达“操作已处理但响应
   正文已过期”，客户端仍删除操作记录，下一次重试重新生成键。
   [服务端过期返回](../backend/application/commands.py#L131-L142)。

3. **具体触发场景与证据**

   对真实 `useActionWorkspace` 与 `api.js` 注入 HTTP 200，令后续 `loadData` 返回 false：
   第一次提交后表单仍打开、金额仍为 100、提交按钮重新可用；第二次提交产生相同正文、
   不同 `Idempotency-Key` 的第二次 POST。此实验仅模拟 HTTP 响应，不宣称已经运行
   “浏览器→真实后端”的故障链路。

   另一次故障注入得到：
   `网络结果未知 → 原键收到已处理过期的 409 → 下一次请求变成新键`。

4. **推荐目标结构**

   写入结果至少区分“未提交、提交中、结果未知、已确认提交、明确拒绝”。
   资源刷新独立拥有 loading/error；刷新失败不允许已提交表单重新发起同一笔业务。
   operation ID 与一次表单业务意图绑定，主动点击“再记一笔”才开始新意图。

5. **最小改造方案**

   成功响应后先把表单标为已完成，关闭或生成下一张空白表单；再刷新数据。
   刷新失败明确提示“已保存，数据刷新失败”，重试按钮只执行读取。
   对已处理但正文过期增加稳定错误码，保留其已处理状态。

6. **完整改造方案**

   在前端公共写入生命周期中统一处理提交状态；feature actions 返回包含操作结果的
   明确结构。服务端区分业务冲突、仍在处理、已提交但响应过期、恢复后失效等错误码；
   `ensureResponse` 保留错误码，客户端按语义处理，避免解析中文 detail。
   预算、目标、投资现金、通用表单采用相同的提交与刷新契约。

7. **改造风险与验证**

   必须保留主动连续记两笔相同金额的能力，不能全局按 payload 永久去重。
   回归：200 后某个 GET 失败、网络断开、页面重载、scope 切换、过期键重试、
   “再记一笔”和重复点击。真实后端断言同一意图只增加一条事实和一次余额变化，
   两个主动意图可以增加两条。

### R2：同一个汇总响应可能包含不同时间点的数据

1. **当前实现方式**

   `get_effective_accounts` 先读账户现金再读持仓。
   `get_investment_summary` 自己开连接，又调用未传 conn 的 `get_holdings` 打开另一连接。
   核对接口也依次读取账户、流水、投资交易。
   [读取位置](../backend/queries/finance.py#L770-L802)。

2. **为什么存在问题**

   没有显式读取事务时，SQLite 不保证这些 SELECT 来自同一快照；PostgreSQL 当前连接
   未设置 REPEATABLE READ，默认 READ COMMITTED 也允许后续语句看到新提交。
   仅仅“共用一个连接”不足以保证 PostgreSQL 多语句一致性。

3. **具体触发场景与证据**

   临时 SQLite 初始现金 1000。在持仓读取和现金读取之间执行一次真实、完整提交的
   100 元买入，响应为“持仓 0 + 现金 900”；稳定的账户资产仍为 1000。
   反过来，在账户现金读取后、持仓估值前提交买入，账户总览返回 1100，稳定值仍为 1000。
   实验使用查询边界注入来确定交错顺序，资金写入执行真实应用用例。

4. **推荐目标结构**

   一个有金额一致性承诺的查询响应，由一个外层只读事务承载。
   所有参与其总额、明细和核对的子查询显式接受 conn/context。
   不要求所有页面或多次 HTTP 请求共享一个全局快照。

5. **最小改造方案**

   复用已存在的
   [consistent_read_connection](../backend/infrastructure/database.py#L92-L107)：
   PostgreSQL 使用 REPEATABLE READ READ ONLY，SQLite 使用显式 BEGIN。
   从账户总览、投资汇总、核对三个入口开始，给 get_holdings 等传递同一连接。

6. **完整改造方案**

   逐步统一 dashboard、预算和目标等多语句查询的连接所有权；将同一响应需要的查询
   参数化，避免 helper 隐式另开连接。需要时返回业务日期/估值时间，明确显示口径。
   这不要求引入 ORM、独立报表数据库或读写分库。

7. **改造风险与验证**

   SQLite 长读事务可能延长写等待，读取事务内不能包含网络 I/O，也应限制大导出时长。
   在真实 PostgreSQL 与 SQLite 增加读取/买卖交错测试：结果可完整属于交易前或交易后，
   同一价格、无手续费时资产总额必须始终为 1000；核对不应报告不存在的余额差。

### R3：业务日历与 UTC 时间戳混用

1. **当前实现方式**

   `todayInputValue()`、`currentMonthValue()` 对当前时间调用 `toISOString()` 截取日期，
   所得为 UTC 日期。服务端使用 `date.today()`，Compose 默认时区为 Asia/Shanghai。
   [前端日期工具](../frontend/src/features/shared/actionForm.js#L4-L10)；
   [后端默认建账日期](../backend/application/accounts.py#L127-L130)。

2. **为什么存在问题**

   业务字段 occurred_at、opening_date 和预算 month 表示日历日期，不是 UTC 时间点。
   时区口径不一致会改变统计月份，甚至触发不同的余额更新规则。

3. **具体触发场景与证据**

   固定时钟为 `2026-10-01 00:30 +08:00`，两个工具实际返回 `2026-09-30`、`2026-09`。
   另用临时库创建 opening_date 为 10 月 1 日、余额 1000 的账户，将该默认日期提交为
   100 元支出：接口返回 `balance_applied: false`，余额保持 1000。
   建账前补录规则本身合理，错误来自前端默认业务日期。

4. **推荐目标结构**

   明确一个业务时区，默认沿用当前部署的 Asia/Shanghai；前后端使用相同的业务日历。
   时间戳用于审计时刻，YYYY-MM-DD/月字符串用于记账和统计日期，两者分别处理。

5. **最小改造方案**

   新建统一业务日期/月份工具，用明确时区格式化；替换相关默认值和“今天”快捷按钮。
   配置来源与后端对齐，不依赖设备时区碰巧相同。

6. **完整改造方案**

   会话/运行配置返回 business_timezone 和必要的 business_date；
   后端统一日期提供者，使快照、默认日期、导入与前端筛选共享定义。
   仅当真正支持不同地区家庭时，再增加家庭级时区配置。

7. **改造风险与验证**

   不批量修改历史 occurred_at，旧记录可能本来就是补录。
   覆盖上海 00:00、07:59、08:00、月末/年末、闰日，以及设备时区不同的情况。
   验证当日支出正常扣款，显式补录建账前日期仍保持原有行为。

## 6. 推荐的目标架构

继续沿用现有单体。优先强化三个接口边界：

- 写入：`execute(context, payload, operation_id)` 返回已确认结果；失败包含稳定错误码。
  `FinancialCommandResult`、AuditFact 和同一连接的资金事务继续复用。
- 读取：`read_model(conn, context, filters)`；需要组合金额时由外层创建一致性只读事务。
- 日期：`business_date(timezone, now)`；页面默认日期与服务端日历共享明确时区。

推荐依赖方向：

```text
HTTP routers → application 用例 → domain 纯规则
                          ├── infrastructure 具体持久化函数
                          └── queries（读取模型）
queries → domain 估值规则 + infrastructure 连接
application 行情编排 → integrations 行情服务
jobs → application + infrastructure

React app 装配 → feature 页面/草稿/动作
             → 共享提交生命周期 → operationStore → api
feature 数据 Hook → 共享资源生命周期 → api
```

建议目录是演进终点，按改动需求落地，不要求一次迁移所有文件：

```text
backend/
├── main.py
├── routers/                  # HTTP、参数、错误码映射
├── application/
│   ├── commands.py           # 保留资金命令事务协调
│   ├── accounts.py
│   ├── ledger.py
│   ├── investing.py
│   ├── budgets.py
│   ├── goals.py
│   ├── snapshots.py
│   └── backup.py
├── domain/
│   ├── money.py
│   ├── accounting.py         # 仅余额变化计算与规则
│   ├── accounts.py
│   ├── valuation.py
│   └── business_date.py
├── queries/
│   ├── accounts.py           # 从 finance.py 按修改需求逐步分出
│   ├── investments.py
│   ├── dashboard.py
│   └── reconciliation.py
├── infrastructure/
│   ├── connection.py
│   ├── database.py           # 连接/事务；历史基线先保留
│   └── accounting_store.py   # 具体 SQL，不建万能 Repository
├── integrations/
├── migrations/
├── jobs/
└── tests/

frontend/src/
├── App.jsx                   # 导航和跨功能装配
├── app/
│   ├── useSession.js
│   └── useFinanceData.js
├── features/
│   ├── ledger/               # 页面动作、草稿、字段、资源
│   ├── accounts/
│   ├── investments/
│   ├── budget/
│   ├── goals/
│   └── shared/               # 无具体业务分派的公共生命周期
├── operations/
│   └── operationStore.js
├── shared/
│   └── businessDate.js
├── components/               # ModalPanel / DialogActions 等视觉基础组件
├── pages/
└── api.js
```

后端无需给每张表生成 Repository，也无需为了使用依赖注入而新增容器；
函数参数传递 conn/context 已足够。纯规则与 SQL 的小范围分离即可提高测试隔离度。
HTTPException 从 application 向 routers 的进一步迁移，可留到确有 CLI/后台复用需求时。

数据流仍为“事实和当前状态同事务写入，派生视图受控刷新”；状态流改为“提交成功终态
先确定，资源刷新随后独立发生”。保持 goal_records 不改变真实资金。

## 7. 分阶段改造计划

### 第一阶段：低风险、高收益、可以立即实施

| 项目 | 改动范围 | 预期收益 | 风险 | 验证方法 | 工作量 |
|---|---|---|---|---|---|
| 修复成功后重复提交 | api/operationStore/通用提交 Hook；补错误码 | 同一业务意图不会因 GET 失败再次记账 | 误拦主动连续记账 | 写成功后刷新失败、重复点击、再记一笔、过期键、scope 切换 | 1–2 天 |
| 对齐业务日期 | 前端日期工具、后端时区配置契约 | 修正凌晨跨日跨月及建账前误判 | 误改历史日期 | 固定时钟与真实临时库验证 | 1–2 天 |
| 启用现有产物校验 | CI build 步骤 | 防止开发入口/调试代码进入产物 | 很低 | CI 实际执行 verify:build | 约半天 |

### 第二阶段：解决核心耦合与边界问题

| 项目 | 改动范围 | 预期收益 | 风险 | 验证方法 | 工作量 |
|---|---|---|---|---|---|
| 统一关键财务读取事务 | finance 查询、核对入口、连接参数 | 消除混合时间点的资产总额和核对误报 | SQLite 读锁时间增加 | PG/SQLite 交错读写测试 | 2–3 天 |
| 完成提交状态契约 | 相关 feature 提交器、错误解析、表单终态 | 避免各类弹窗采用不同的“保存成功”标准 | 多入口行为回归 | 记账/转账/买卖/目标/现金核对故障矩阵 | 在最小修复上再 1–2 天 |
| 领域 SQL 归位 | accounting 三个函数、有限调用点、架构检查 | 纯规则可脱离数据库测试 | 改动锁顺序或连接所有权 | 资金守恒、回滚、审计、幂等、双数据库回归 | 1–2 天 |
| 真实浏览器接入 CI | 临时数据库、启动脚本、Playwright 作业 | 覆盖真实 HTTP 和前后端契约 | 测试数据污染/时间依赖 | 每次独立数据库，显式记录执行与跳过数量 | 1–2 天 |

R2、R3 修复完成前不应扩展到更高并发或新增另一套时间口径；无需等待目录整理完毕。

### 第三阶段：长期演进与工程治理

| 项目 | 改动范围 | 预期收益 | 风险 | 验证方法 | 工作量 |
|---|---|---|---|---|---|
| 验证实际运维闭环 | 异机备份、失败告警、定期恢复、任务监测 | 证明数据可恢复且故障有人知晓 | 外部配置和凭证管理 | 隔离恢复，记录 RPO/RTO 与演练结果 | 1–3 天，依赖环境 |
| 多家庭恢复隔离 | 恢复协调、所有写入口、ID 分配 | 减少恢复对其他家庭的影响 | 锁协议遗漏破坏恢复安全 | 两家庭并发恢复/记账/查询，锁等待观测 | 3–5 天，按需求 |
| 按实际修改热点拆分 | finance 查询、跨功能表单、文档/ADR | 降低新增功能修改面 | 机械拆分产生跳转负担 | 导入图、现有行为、桌面/平板/手机回归 | 每次半天至 2 天 |

各项存在重叠，应按同一缺陷的最小修复与完整收口合并排期，不能简单把所有天数相加。

## 8. 最终建议

**未来 6～12 个月能否继续支撑？** 可以，前提是继续以当前家庭财务、有限并发的
产品形态演进，并先修复 R1–R3。面向大量家庭的容量、可用性及恢复时长无法判断：
需要家庭数、流水量、持仓量、并发请求、P95 延迟、DB 连接/锁等待与可用性目标。

**最应该优先处理的三件事：**

1. 闭合业务操作生命周期，修复成功写入后可重复提交以及过期结果误判。
2. 为资产汇总和余额核对建立一致性读取边界。
3. 统一业务时区与日期，修正跨日、跨月默认值。

**应保持不动：** 模块化单体；财务命令原子事务；Decimal 和历史汇率；家庭权限边界；
goal_records 的非资金语义；备份恢复前副本和校验；ModalPanel/DialogActions；
尚有调用方的薄兼容入口。依据分别见第 2、3 节及相应代码。

**现在不必做：** 微服务化、消息队列、事件溯源、读写分库、全局 Redux、通用 Repository、
全面替换 SQL/ORM、为了缩短 App.jsx 行数而重新分割稳定 UI。连接池或外部缓存应由
真实连接压力、延迟与热点数据证据推动。

**如果只能进行一次架构优化：** 选择“统一业务操作的提交状态与界面状态契约”。
它直接覆盖最严重的重复记账风险，并同时改善记账、转账、投资、目标记录的错误处理，
收益高于单纯搬移目录。

**无法判断及所需信息：**

- 线上是否已出现重复记账：需要生产日志、对应操作键及审计记录；本报告只证明路径可触发。
- PostgreSQL 当前部署的真实并发结果：需要专用测试实例或本次提交对应的 CI 运行结果。
- 异机加密备份和告警是否已部署：仓库仅给出建议，需服务器配置与恢复演练记录。
- 真实 Nginx 响应头、原生 iOS/Android 行为与应用商店构建：需要可测试环境及原生构建结果。
- 容量与性能上限：没有压测或生产指标，不给出并发数、SLA 或吞吐保证。
