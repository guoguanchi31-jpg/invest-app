# 架构与财务边界

## 运行形态

Invest 是模块化单体：

```text
React / Capacitor
        |
FastAPI routers
        |
application commands + query models
        |
domain rules + infrastructure adapters + integrations
        |
PostgreSQL 16 / SQLite
```

Docker Compose 是完整生产部署。Vercel 仅保留无状态 API 兼容入口，不执行迁移，
也不运行进程内定时任务。

## 依赖方向

- `routers/`：HTTP 参数、身份依赖、响应和协议错误；不得执行 SQL。
- `application/`：授权、用例、事务结果、审计事实、影响账户/成员、备份和快照协调。
- `domain/`：金额、账户状态、记账、估值、预算分配等纯规则，不依赖 FastAPI 或数据库。
- `queries/`：看板、报表、分页和只读核对模型。
- `queries/ledger.py`：账本分页、筛选、转账聚合、收支列表及导出原始行；
  `application/ledger_export.py` 负责 CSV 响应，`application/ledger.py` 保留写入用例和兼容入口。
- `infrastructure/connection.py`：SQLite/psycopg 驱动适配。
- `infrastructure/database.py`：连接配置、事务上下文和冻结的历史建表兼容基线。
- `infrastructure/accounting_store.py`：余额变更、最终校验的读写和核对流水持久化；
  金额、方向和冲突计算保留在 `domain/accounting.py`。
- `infrastructure/read_models.py`：组合查询的读取事务边界，不使用隐式共享连接。
- `migrations/schema.py`：唯一的增量结构版本链；新结构变化只能追加迁移。
- `fixtures/`：开发样例与隔离测试夹具。演示样例仅在 `SEED_DEMO_DATA=1` 时启用；
  `e2e_legacy_application.py` 只接受浏览器运行器创建的 `.e2e-tmp-*` 数据库目录。
- `integrations/`：行情等外部服务，网络请求期间不持有数据库连接。
- `jobs/`：可独立运行、可观察、可重试的维护任务。

顶层 `database.py`、`commands.py`、`services.py`、`backup.py`、`investing.py`、
`money.py` 和 `schema_migrations.py` 只保留旧导入路径的兼容导出，不保留第二份
业务实现。`architecture_check.py` 用 AST 检查循环依赖、领域层禁用依赖、router
SQL 和财务用例连接所有权。
领域层即使不导入数据库模块，也不能调用 `execute/executemany/executescript`。

## 业务日历与一致性读取

新财务事实使用 `BUSINESS_TIMEZONE`（默认 `Asia/Shanghai`）。后端
`domain/calendar.py` 负责业务日期、月份和时钟，`/auth/session` 返回时区；
前端 `shared/businessDate.js` 在加载会话后采用相同日历。建账日期、现金核对、
行情日期、表单默认日期、预算节奏和每日调度均遵循此配置。
`domain/dates.py` 定义业务日期的唯一表示：新 API 仅接受真实存在的
`YYYY-MM-DD`，去除首尾空白后按同一格式存储；`YYYYMMDD` 不属于新输入协议。
余额生效日、投资交易建账日和历史基线使用日期对象比较，不依赖字符串排序。
审计发生时间与业务日期是不同概念。日历加减采用日期组件运算，
不把日期字符串当成设备本地时间。时区或日期配置无效会阻止启动。

schema 10 将存量业务日期统一为 ISO。仅 `YYYYMMDD` 可无歧义转换；可空字段的
空字符串归一为 NULL；斜杠、缺位、无效日等格式不猜测，迁移中止并报告表、ID、
字段和值。SQLite 触发器和 PostgreSQL CHECK 阻止后续非规范日期直写。
快照日期转换后若发生同家庭、成员、日期冲突，保留 `created_at/id` 最新一条。
schema 11 不重跑或改写 schema 10；它追加幂等协议元数据，并对已升级数据库执行
只读兼容扫描。日期迁移不自动修改 `balance_applied` 或余额。核对模型按账户输出
期初证据、流水应用语义和余额求和三个独立结论；异常记录包含流水 ID、日期、实际/
预期标记、金额和更正差额。JSON v1-v8 备份采用相同诊断规则。

旧快照只有在“同家庭 + 同成员 + 不同原始日期字符串”规范化为同一天时才择一保留，
按 `created_at`、ID 依次选择最新记录，不相加资产值。恢复预览返回保留、舍弃和原因；
不同成员、不同日期分别保留；重复 ID 与同格式重复仍按无效数据拒绝。

财务汇总、分页、明细、核对、目标和恢复预览在一个读取快照中完成。根查询通过
`@consistent_query` 或 `consistent_read_connection()` 开始只读事务：
PostgreSQL 使用 `REPEATABLE READ READ ONLY`，SQLite 显式 `BEGIN`。
组合的子查询必须显式传 `conn=conn`；传入连接表示调用方已经拥有读取或写入事务，
子查询不得另开连接、提交或关闭。一个 HTTP 响应内保证一致性，不承诺多次 HTTP
请求看到同一版本。

仓库 GET 只读取当下估值和历史快照；当天展示点在响应中合并，不写数据库。
持久化快照仍由资金命令、显式刷新和定时任务负责。

## 财务事实

- `transactions`：收入、支出、转账双腿、期初和余额调整。`source` 保留真实语义。
- `investment_trades`：真实买卖、结算现金、交易前后数量与成本。
- `accounts.balance`：普通账户当前状态；由有效且影响余额的流水联动。
- `accounts.cash_available`：投资账户结算现金；不与持仓市值混为一列。
- `holdings`：当前数量、成本和报价；历史导入持仓不伪造买卖。
- `snapshots`：按业务日期保存的派生估值，不是新的财务事实。
- `goal_records`：目标进度，不划拨、冻结、预留资金，也不增加资产。

余额核对只生成可追溯 `adjustment` 流水。只读 `/accounts/reconciliation` 返回
账面状态与可重建事实的差异，不自动修复。历史不足以重建时报告限制。
`matches` 只表示当前差额是否为零；`history` 独立返回来源、完整性、基线日期、
基线金额及对应状态字段；`application` 独立验证每笔 `balance_applied` 是否符合
建账日期和流水类型。只有历史完整且应用语义一致时 `reconstructable=true`；
`healthy` 还要求余额求和一致。因此历史漏扣不能再用 `matches=true` 表示正常。
新建账户显式保存 `history_basis=opening_transaction/zero_opening`，前者还必须
存在唯一、有效且日期匹配的期初流水。迁移和旧备份缺少元数据时为 `unknown`，
不凭 `opened_at`、调整流水或差额为零推断历史完整。投资账户的承诺限于结算现金。

`PATCH /transactions/{id}/application` 是唯一的历史应用标记受控更正入口。调用方
必须提交当前看到的账户余额、原应用标记和原因；服务端锁定账户与流水后重新计算
预期状态，在同一财务命令中改标记和余额并写审计。幂等重试只生效一次，预期值冲突、
审计失败或快照失败全部回滚。扫描、迁移和恢复预览绝不自动调用该入口。

前端从账本工具栏或账户详情打开“账本诊断”，分开展示三项结论，且以账户原币
显示余额与更正差额。每次更正必须选择具体流水、填写原因并确认余额变化。
未知结果冻结原草稿并沿用原键重试；归档账户和无写权限成员只可查看。
账本列表使用后端 `transaction_application_state` 的诊断语义；缺少诊断信息的
未应用流水显示“待核对”，不再仅凭 `balance_applied=0` 标注为合法历史补录。

## 金额、汇率与估值

业务计算使用 `Decimal(str(value))` 和 `ROUND_HALF_UP`：

| 类型 | 精度 | PostgreSQL |
| --- | --- | --- |
| 金额 | 2 位 | `NUMERIC(24, 2)` |
| 价格 | 8 位 | `NUMERIC(24, 8)` |
| 数量 | 8 位 | `NUMERIC(28, 8)` |
| 汇率 | 10 位 | `NUMERIC(24, 10)` |

统一估值口径是“每笔持仓先按金额精度舍入，再按账户/成员/家庭汇总”。账户总览、
投资汇总、分布与快照复用同一估值规则。负值不在展示层截断。

流水固化发生时的原币、汇率和本位币金额。只改备注等非金额字段时保留历史汇率。
转账先用转出金额与其历史汇率计算未舍入的本位币值，再分别保存两位本位币金额和
十位收款汇率；同币种收款腿直接沿用转出汇率，不从可能为零的本位币金额反推。
恢复仍严格校验转出腿及双腿本位币守恒。只有引用、日期、家庭、撤销状态均匹配的
完整转账双腿，收款腿才允许不超过
`到账金额 × 汇率最小单位 / 2 + 金额最小单位 / 2` 的量化残差。
普通流水、期初、调整和导入不使用此宽容规则，也不使用账户当前汇率回算历史。
SQLite 的 `REAL` 适合本地开发和兼容测试，但不宣称与 PostgreSQL `NUMERIC`
具备完全相同的存储能力。

JSON 备份格式 v8 以十进制字符串保存精确数值，兼容读取 v1-v7。
v8 增加账户历史基线和审计载荷版本；继续保留 v7 的账户导入去重命名空间，
使恢复时重新分配 ID 不影响外部账单去重。
备份规范化在领域校验前补齐与 SQL 一致的账户状态默认值：
`is_liability=0`、`balance=0`、`cash_available=0`。只补缺失字段，不覆盖显式值；
账户类型等无默认值的必需字段仍按无效备份拒绝。

## 账户不变量

非负债投资账户必须满足 `cash_available >= 0`。普通账户和负债账户保留原有负值
语义，不套用同一限制。

该规则同时存在于：

1. 输入模型和账户领域规则；
2. 所有财务命令提交前的受影响账户检查；
3. PostgreSQL CHECK；
4. SQLite INSERT/UPDATE trigger；
5. 备份恢复预校验。

创建、期初、核对、流水、导入、转账、投资买卖及各类撤销均经过同一最终状态
检查。失败会回滚财务事实、状态、审计、快照和幂等记录。

## 事务、锁与审计

`@financial_command` 是财务写入的外层事务边界。应用用例显式使用同一连接，
内部不提交、回滚或关闭。嵌套写事务会直接报错。

每个财务用例返回 `FinancialCommandResult`，显式包含：

- HTTP 响应；
- 受影响账户；
- 受影响成员；
- 审计动作、实体、before/after、原因和账户关联。

不存在按函数名、参数名或响应形状推断审计的旧协议。审计前值在业务锁内读取。
跨业务锁顺序为家庭事务锁 → 命令键 → 账户 ID 升序 → 流水、持仓或交易子记录；
预读关联后必须在锁内重新验证。所有应用写入使用 `family_write_connection`，
包括财务命令、分类、成员/密码、行情写回、恢复、快照和命令保留清理。
PostgreSQL 使用按家庭编号的事务 advisory lock，同家庭串行、不同家庭独立；
MVCC 读查询不获取写锁。SQLite 继续使用 `BEGIN IMMEDIATE`。
离线迁移和整库恢复由运维停机流程独占，不参与在线家庭锁协议。

## 家庭恢复

恢复先在一致性只读事务中校验备份、读取当前家庭，再关闭连接，将恢复前副本写入
家庭专属目录，设置权限并 fsync。只有文件成功持久化后才进入家庭写事务，重新核对
当前账本指纹；准备期间发生变化则返回 409，账本保持原样。失败或竞争留下的完整
恢复副本允许保留用于排查；不能把副本存在当作恢复已提交。

删除与插入仅针对当前家庭。`infrastructure/restore_store.py` 用数据库分配的新 ID
重建全部财务表、外键、分类父级、审计实体/账户关联和转账引用；不存在的历史审计
实体标为 `legacy:`，不绑定到其他记录。审计的金额和业务内容保留。跨家庭导入为新
成员生成独立 member_key。恢复不再获取全表排他锁，也不重设全局序列。
`domain/audit_payloads.py` 定义实体载荷结构，新审计写入 `payload_version=1`。
恢复同时支持未版本化的 v0 已知结构；目标及分配、目标记录、预算成员/分类分配、
交易前后账户/持仓通过显式结构映射。流水应用更正的 before/after 为
`{transaction, account}`，同样登记在 v1 契约中，恢复时分别映射流水与账户，
保留应用标记、原金额和余额；界面显示“余额应用”与“关联账户余额”的变化。
未知结构或版本使用
`_id_namespace=historical` 封装保留原值，不猜测其中 ID 的新归属。
删除实体采用稳定的 `legacy:` 前缀，重复恢复不叠加前缀。

恢复 HTTP 接口使用同一财务命令幂等协议；准备产物不参与请求指纹。同键重试返回
第一次提交的结果，不覆盖恢复后的新流水。恢复事务作废本家庭的旧键，保留本次恢复
键，并将审计、快照与恢复结果一并提交。前端清理旧草稿和筛选状态，并刷新成员信息。

## 幂等生命周期

前端请求世代只决定响应能否回填当前界面。业务 operation ID 由
`operations/operationStore.js` 独立管理，状态为：

- `unsubmitted`
- `processing`
- `succeeded`
- `failed`
- `unknown`
- `expired` / `invalidated`（服务端已处理或恢复后失效的终态）

网络中断、页面重载或 scope 往返后，结果未知的同一业务意图复用原 operation ID。
持久化记录只包含 ID、身份、指纹、方法、路径和状态，不保存令牌或财务正文。
成功后再次主动提交相同内容会创建新 ID。

操作存储协议当前为 `investPendingOperations:v2`，并兼容读取 v1。终态确认使用完整
操作对象按其原存储版本移除对应记录，未知记录和其他身份条目继续保留。v1 中没有 scope
的操作不会被猜测归属：新代码先以原 ID 查询最小命令收据；已提交、已过期和已失效
只结束或阻断原意图，`processing/unknown` 保留原 ID 并进入明确核对，不创建新键。
不同用户或家庭的旧条目不会被收养。v1 中已经带 scope 的过渡记录仍沿用原 ID。

表单业务意图与读取资源分开管理。公共 `useSubmission` 确认写入成功后先关闭或重置
表单，再刷新数据；刷新失败提示“已保存，数据刷新失败”，页面“重新加载”只发起 GET。
已完成意图不能重新提交；主动点击“再记一笔”或打开新表单才产生新意图。旧身份收到
的成功结果保留已提交状态，不能因为无法更新当前界面而降级为失败。

行级动作由 `useCommandActions` 保存本次意图，直到对应资源的成功读取确认。
`useScopedDataResource` 只有接受当前身份、当前查询的数据后才返回确认凭据，
包含身份、资源键（预算/目标包含月份）及读取开始序号。读取必须开始于写入终态
之后，才允许释放已提交或已失效意图；使用单调事件序号，不依赖墙钟。
自动刷新、手动重载、局部刷新采用相同规则；其他资源读取失败不会阻塞已确认的
相关动作。写入尚未确认、结果未知、旧身份、其他月份和提交前开始的 GET
都不能释放本次意图。确认凭据到达时立即锁存到对应意图；只要写入已确认即可释放，
无需等待其他资源的刷新结束。
因此确认 9 月写入后切到 10 月不会丢失确认，也不会让其他月份读取替代原确认。
目标状态另有独立于月份视图的 `stateKey`。一次真实的新状态写入确认提交后，
在 `onCommitted` 内立即取代同一目标更早的已提交/已拒绝状态意图；不等聚合刷新返回。
因此“完成成功、刷新失败、直接切月、
恢复、再次完成”不依赖旧月份 GET。`unknown/processing` 意图不能被 stateKey
清除，仍须按原 operation ID 确认，避免迟到写入覆盖新状态。
提交状态进一步区分 `writePending` 与 `refreshPending`：PATCH 确认后即可释放按钮
写锁和退休旧已提交 intent，旧 GET 稍后结束不能清除更晚操作；仍在写入或结果未知的
intent 始终保持保护。预算等按月资源继续使用原资源确认规则。

对同一业务实体互斥的状态写入使用 `conflictKey`，例如目标完成/恢复以及账户
归档/恢复。结果未知的旧操作存在时，新操作先调用只读
`GET /commands/{operation_id}`。接口仅按当前 `family_id + user_id` 返回
`committed/expired/invalidated/processing/unknown`，不返回请求正文或财务结果；
不存在也返回 `unknown`，因为不可见的并发事务不能被当作失败。只有旧操作已进入
服务端终态才退休旧键并发送新写入；处理中、缺失或查询失败均阻止新写入，原意图
继续使用原操作键重试。持久化冲突元数据不包含令牌或财务正文。

服务端错误同时返回兼容的 `detail` 和机器 `code`：
`COMMAND_RESULT_EXPIRED`、`COMMAND_INVALIDATED`、`COMMAND_CONTENT_CONFLICT`、
`COMMAND_PROCESSING`、`BUSINESS_CONFLICT`。前端按 code 处理，不能解析中文文案
来决定是否换键。过期响应结束原意图；结果未知继续使用原键。

服务端 `financial_commands` 使用 `processing/committed/expired/invalidated`：

- 同键同内容重放已提交响应；
- 同键异内容返回 409；
- 响应到期后清除大正文，但保留去重墓碑，不重新执行；
- 账本恢复后旧键永久 `invalidated`；
- `jobs/financial_command_retention.py` 独立分批清理，默认保留 90 天响应正文。

schema 11 为命令增加 `fingerprint_version` 和 `data_scope`。新命令写 v2 和明确 scope；
升级前存量记为 v0（算法未知），可用旧/新算法确认内容，但因 scope 不可证明而不返回
敏感响应，只返回终态。该兼容路径不能用于跨 scope 重放。

## 身份与权限

`family_id` 是租户边界，`member_id` 是数据归属，角色决定写权限，scope 只控制
家庭/个人显示范围。缺少请求身份立即返回 401，不选择默认管理员。
数据范围遵循最小权限默认：新登录、退出后的下一次会话、无本地偏好以及缺少
`X-Data-Scope` 的 HTTP 请求均使用 `personal`；只有显式 `family` 才读取家庭汇总。
用户主动切换后的范围写入本地偏好，刷新页面继续沿用，不在每次加载时强制重置。
范围偏好带存储版本；旧客户端自动写入但未版本化的 `family` 不视为用户选择，
升级后首次进入按 `personal` 处理。

初始化、迁移和后台多家庭遍历使用显式系统流程。系统上下文不能由 HTTP 参数选择。
所有查询、写入、导出及恢复文件均校验家庭归属。已有业务历史的成员不能物理移除，
只能停用登录并保留归属。

## 前端边界

- `app/useSession.js`：登录、身份、家庭和 scope 生命周期。
- `features/*/use*Data.js`：按身份、家庭、scope 和查询条件加载各功能数据。
- `features/*/actions.js`：各功能写入和 payload。
- `features/*/presentation.js`：服务端数据到页面模型的转换。
- `features/*/drafts.js`：各功能默认草稿、编辑转换和字段变化规则。
- `features/shared/useSubmission.js`：公共提交、确认、刷新及重试生命周期，不分派具体业务。
- `app/actionDefinitions.js` / `app/useActionWorkspace.js`：跨功能表单与字段组件装配、
  身份切换清理；共享层不得反向导入各 feature。
- `app/useDeleteAction.js`：删除/归档的确认、分派和提交生命周期装配。
- `operations/operationStore.js`：业务操作生命周期。
- `features/audit/presentation.js`：版本化审计载荷到字段变化的只读展示映射；
  目标、目标记录、预算分配和投资交易使用显式结构与稳定业务键配对。
- `usePaginatedResource.js`：分页乱序保护和加载期间总数保持。
- `App.jsx`：导航、全局布局及跨功能装配，不直接调用业务 API。

写入后只刷新当前页面启用的相关资源；进入其他页面时再加载对应数据。身份或 scope
变化会关闭弹窗、清理草稿并使旧响应失效。

## 迁移、任务与构建

- 当前 schema 版本为 11；历史版本不重编号、不覆盖。
- 历史 bootstrap 只用于创建旧基线表，再按 `schema_migrations` 顺序升级。
- 生产启动先运行 `python migrate.py`，应用进程只校验版本。
- PostgreSQL 迁移使用 advisory lock；失败不登记版本且事务整体回滚。
- 每日快照在 `00:05` 按 `BUSINESS_TIMEZONE` 运行，session advisory lock 覆盖完整任务。
- 快照批处理按家庭独立提交；单家庭失败使任务标记失败，重试使用当天 upsert，不重复累计。
- `background_job_runs` 提供可观察的 running/succeeded/failed 记录和停滞接管。
- `/livez` 只表示进程存活；`/healthz` 返回脱敏数据库、版本和任务摘要，普通任务
  失败不直接触发容器重启。
- 默认生产 Vite 构建不包含 `simulator.html`；`npm run build:simulator` 才生成。
- `npm run verify:build` 检查模拟器和已移除的本机调试端点未进入生产产物。
- CI 分开执行模拟 API 冒烟与 `npm run test:e2e:real`；后者自动启动专用临时 SQLite
  后端和独立端口，覆盖三种视口。至少十八项真实用例且零跳过才通过，日志与报告作为
  CI 产物保留；不复用开发或生产账本。真实矩阵包含嵌套审计详情在
  桌面、平板、手机中不溢出弹窗的检查。
- `tests/upgrade_cases.py` 同时混入 SQLite/PostgreSQL：旧命令元数据迁移、未提交事务
  的最小收据与并发重试、三类账户的迁移前漏扣、更正事务回滚、嵌套审计跨家庭及重复
  恢复，以及 schema 10/11 和 JSON 的快照选择一致性。
- 固定月份测试通过 `tests/clock.py` 只固定业务时钟，认证与超时继续使用真实时钟。
  跨月规则另有真实业务创建/查询用例。现金并发回归同时覆盖无预设顺序和三种
  首写者：核对先执行时三笔成功、现金 400；转账或买入先执行时核对冲突、现金 500。
