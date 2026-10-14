# Invest 架构复审报告

日期：2026-09-30。范围：当前工作区，包括已有未提交修改和未跟踪模块；不是对线上部署版本的认证。本轮重新读取运行入口、业务调用链、数据边界、迁移、前端状态与测试，并执行回归和补充故障复现。

仅新增本报告，未修改业务实现或真实财务数据。补充复现使用临时测试文件和独立临时 SQLite 数据库，结束后已清理。

## 1. 总体结论

| 项目 | 结论 |
|---|---|
| 架构合理度 | **良好** |
| 综合评分 | **86 / 100**。按家庭财务应用规模评估，是工程判断，不是自动化质量分数。 |
| 一句话结论 | 核心分层、资金事务和前端提交边界已明显改善；继续修复少数状态与审计语义缺口，并补齐生产数据库验证即可，无需扩大重构。 |
| 最突出的优点 | 写入、审计、幂等、快照有统一提交边界；组合读取有一致性快照；这些边界已有行为测试和真实接口浏览器验证。 |
| 最大的架构风险 | PostgreSQL 并发与真实容器恢复尚无本轮运行证据，同时一个并发测试存在错误预期；现有本地绿灯不能替代生产路径验收。 |
| 是否需要立即重构 | **否**。本轮确认 4 项 P2 问题，适合局部修复；未发现新的、已复现的 P0/P1 缺陷。 |
| 判断依据 | 实际入口和依赖、完整本地测试、真实 SQLite 浏览器流程，以及提交生命周期、历史核对、恢复审计和并发合法顺序的补充复现。 |

### 上轮主要问题的复核结果

| 上轮问题 | 本轮判断 | 当前证据 |
|---|---|---|
| 写入成功后刷新失败，导致原表单重复记账 | **原缺陷可以关闭**；行级动作出现另一个较轻的生命周期问题，见 F1 | [先结束意图再刷新](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:55)，真实接口浏览器故障流程通过 |
| 已处理但结果过期的 409 被当作失败并换键 | **已修复对应分类** | [服务端机器码](/Users/bytedance/Desktop/invest-app/backend/application/commands.py:34)、[客户端过期处理](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:43)、[传输回归](/Users/bytedance/Desktop/invest-app/frontend/src/api.test.js:220) |
| 财务组合查询混读不同版本 | **一致性事务已接入，SQLite 回归通过；PG MVCC 仍待实跑** | [根查询事务](/Users/bytedance/Desktop/invest-app/backend/infrastructure/read_models.py:9)、[核对入口](/Users/bytedance/Desktop/invest-app/backend/application/accounts.py:120)、[组合读取测试](/Users/bytedance/Desktop/invest-app/backend/tests/test_cross_workflows.py:84) |
| 业务日期混用 UTC 与业务时区 | **已建立统一业务日历并有边界测试** | [后端日历](/Users/bytedance/Desktop/invest-app/backend/domain/calendar.py:8)、[前端日历](/Users/bytedance/Desktop/invest-app/frontend/src/shared/businessDate.js:4)、[时区测试](/Users/bytedance/Desktop/invest-app/backend/tests/test_domain_rules.py:23) |
| domain.accounting 执行 SQL | **已修复** | [纯计算规则](/Users/bytedance/Desktop/invest-app/backend/domain/accounting.py)、[具体持久化模块](/Users/bytedance/Desktop/invest-app/backend/infrastructure/accounting_store.py)，AST 检查通过 |
| CI 未启用真实浏览器和产物校验 | **工程入口已补齐，本地对应命令已通过；未声称远端 CI 已通过** | [CI 前端校验](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml:49)、[真实浏览器作业](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml:61) |
| 恢复使用全表排他锁，锁内写恢复副本 | **结构已改善，仍需修复嵌套审计 ID 映射，见 F3** | [锁外持久化副本](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:732)、[家庭锁内复核](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:760) |
| 跨功能表单规则堆在共享层 | **归属已改善，无需再为目录形式重拆** | [应用装配](/Users/bytedance/Desktop/invest-app/frontend/src/app/useActionWorkspace.js)、各 feature 的 drafts/actions/字段组件 |
| 历史是否可重建的判定过宽 | **仍存在，见 F2** | [判定条件](/Users/bytedance/Desktop/invest-app/backend/queries/reconciliation.py:88) |
| 并发测试固定要求一个 409 | **仍存在，见 F4** | [固定结果数量断言](/Users/bytedance/Desktop/invest-app/backend/tests/test_cross_workflows.py:664) |

### 本轮实际执行结果

| 检查 | 本轮结果 | 证据边界 |
|---|---|---|
| 后端 unittest | **183 项：158 通过，25 跳过** | 本地 SQLite；包含迁移、权限、资金及恢复回归。真实 PG 流程及 PG 专属 MVCC 项跳过。 |
| 前端 Vitest / coverage | **128 / 128 通过，22 个文件** | 语句 72.96%，分支 57.37%，函数 67.07%，行 76.01%；覆盖率不代表所有组合场景正确。 |
| 前端 lint | **通过，0 warning / 0 error** | `npm run lint`。 |
| 生产构建及产物校验 | **通过** | `npm run verify:build`；13 个产物文件通过校验，默认产物不含模拟器入口。 |
| 模拟接口浏览器 | **9 / 9 通过** | `npm run test:e2e`，桌面、平板、手机视口。 |
| 真实接口浏览器 | **6 / 6 通过，0 跳过** | `npm run test:e2e:real`；隔离 FastAPI + SQLite，含成功写入后读取失败流程。这些视口不等于真实原生设备。 |
| 备份脚本故障注入 | **8 / 8 通过** | `python3 -m unittest discover -s deploy/tests -p 'test_*.py' -q`；不等于真实 Docker 恢复演练。 |
| 架构检查 | **通过** | `venv/bin/python architecture_check.py`，在 backend 目录运行。 |
| 补充复现 | **确认 F1–F4 的相应事实** | F1 为真实 Hook/API 逻辑加模拟传输；F2/F3 为临时 SQLite 实际业务调用；F4 为合法串行顺序复现，不是 PG 并发实跑。 |

后端测试命令为在 backend 目录运行 `venv/bin/python -m unittest discover -s tests -p 'test_*.py' -q`；前端测试命令为在 frontend 目录运行 `npm run test:coverage`。本轮真实浏览器报告：[report.json](/Users/bytedance/Desktop/invest-app/frontend/test-results/real-api/report.json)。

**无法判断**：真实 PostgreSQL 锁等待、死锁与 MVCC 表现，Docker 备份恢复耗时，生产 Nginx 响应头，原生 iOS/Android 行为，以及实际容量、RPO/RTO 和告警送达。需要独立测试 PG 的执行结果、容器恢复报告、部署配置/响应与设备测试证据；当前机器未配置测试 PG，且无可用 Docker/PostgreSQL 服务。

## 2. 架构还原

实际架构是**模块化单体，应用用例与查询分离，直接 SQL 持久化**。当前业务规模适合这一形态，不需要微服务或消息队列。

### 运行与模块职责

| 模块 | 实际职责与依赖 | 具体证据 |
|---|---|---|
| React / Capacitor | React 页面复用到 Web 和原生壳；app 装配会话、导航、资源和跨功能弹窗 | [App](/Users/bytedance/Desktop/invest-app/frontend/src/App.jsx)、[useSession](/Users/bytedance/Desktop/invest-app/frontend/src/app/useSession.js) |
| feature 与共享状态 | feature 管草稿、写入、展示转换和资源；共享层管请求竞态及提交生命周期 | [useFinanceData](/Users/bytedance/Desktop/invest-app/frontend/src/app/useFinanceData.js:26)、[useScopedDataResource](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useScopedDataResource.js:29)、[useSubmission](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:23) |
| HTTP / 身份 | FastAPI 解析输入、统一认证、注册路由、返回协议错误 | [main](/Users/bytedance/Desktop/invest-app/backend/main.py:112)、[目标路由](/Users/bytedance/Desktop/invest-app/backend/routers/goals.py) |
| application | 账户、流水、投资、预算、目标、家庭、行情和恢复用例；组织授权、数据库操作与审计事实 | [commands](/Users/bytedance/Desktop/invest-app/backend/application/commands.py:113)、[accounts](/Users/bytedance/Desktop/invest-app/backend/application/accounts.py)、[backup](/Users/bytedance/Desktop/invest-app/backend/application/backup.py) |
| domain / queries | domain 为金额、账户状态、估值、记账、预算及日历规则；queries 提供财务读取模型 | [domain](/Users/bytedance/Desktop/invest-app/backend/domain/)、[queries](/Users/bytedance/Desktop/invest-app/backend/queries/) |
| infrastructure | PG/SQLite 驱动、连接与事务、具体存储操作、恢复 ID 映射 | [database](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py:74)、[connection](/Users/bytedance/Desktop/invest-app/backend/infrastructure/connection.py)、[restore_store](/Users/bytedance/Desktop/invest-app/backend/infrastructure/restore_store.py) |
| migrations / jobs / integrations | 增量结构变化、快照与命令响应清理、外部行情访问 | [迁移](/Users/bytedance/Desktop/invest-app/backend/migrations/schema.py)、[任务](/Users/bytedance/Desktop/invest-app/backend/jobs/)、[行情用例](/Users/bytedance/Desktop/invest-app/backend/application/market_data.py) |

生产主入口是 Compose 的 PostgreSQL + FastAPI + Nginx。后端容器先迁移，再启动 Uvicorn；`main.lifespan` 校验安全配置、日历和结构版本。Vercel 保留无状态 API 兼容入口，关闭启动迁移和进程内调度。见 [Dockerfile](/Users/bytedance/Desktop/invest-app/backend/Dockerfile)、[Compose](/Users/bytedance/Desktop/invest-app/docker-compose.yml)、[Vercel 配置](/Users/bytedance/Desktop/invest-app/backend/vercel.json)、[lifespan](/Users/bytedance/Desktop/invest-app/backend/main.py:29)。这些是代码中的部署设计，本轮未据此推断线上正在运行哪套配置。

### 主要调用与数据流

```text
写入：
页面 → feature action → api / operation ID → 认证 → financial_command
    → 家庭事务锁 → 应用用例（同一连接、业务校验）
    → 流水/交易事实 + 余额/持仓状态
    → 显式审计事实 + 现金不变量 + 受影响快照 + 幂等结果
    → 原子提交 → 确认并结束前端意图 → 刷新读取资源

读取：
feature 资源 → GET → 身份与 scope → consistent_query
    → 同一个读取事务中的主/子查询 → 响应 → 前端版本校验 → 页面

恢复：
一致性读取/校验 → 锁外保存恢复前副本并 fsync
    → 家庭写锁 → 重新校验账本指纹 → 替换本家庭数据并映射 ID
    → 作废旧操作键、保留恢复键 → 审计/快照/结果一起提交
```

PostgreSQL 写入按家庭协调；SQLite 使用 `BEGIN IMMEDIATE`，不能将后者的全库写串行化等同于 PG 的家庭锁。组合查询使用 PG `REPEATABLE READ READ ONLY` 或 SQLite 显式读取事务。[事务实现](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py:93)。

`transactions` 保存现金变动事实，`investment_trades` 保存投资买卖与结算事实；`accounts`、`holdings` 保存当前状态；快照是派生估值；目标记录仅表示进度，不冻结或预留现金。顶层 `services.py`、`database.py` 等已经是兼容入口，不构成另一套业务实现。[兼容入口](/Users/bytedance/Desktop/invest-app/backend/services.py)、[目标用例](/Users/bytedance/Desktop/invest-app/backend/application/goals.py)。

## 3. 做得合理的地方

| 架构点 | 具体证据 | 带来的价值 |
|---|---|---|
| 财务事务集中且拒绝嵌套写事务 | [命令协调](/Users/bytedance/Desktop/invest-app/backend/application/commands.py:165)、[事务入口](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py:74) | 事实、状态、审计、幂等结果和快照一起提交；不依赖内部 commit 被静默吞掉。 |
| 领域计算与持久化已拆开 | [domain.accounting](/Users/bytedance/Desktop/invest-app/backend/domain/accounting.py)、[accounting_store](/Users/bytedance/Desktop/invest-app/backend/infrastructure/accounting_store.py) | 金额、方向和冲突规则可以独立验证，不需要引入通用仓储框架。 |
| 一致性读取显式传连接 | [consistent_query](/Users/bytedance/Desktop/invest-app/backend/infrastructure/read_models.py:9) | 同一响应内组合查询有明确快照边界，子查询不会暗中另开事务。 |
| 家庭写锁符合当前规模 | [family_write_connection](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py:108) | 降低同家庭跨账户/跨模块写入的协调复杂度；暂不需要更细的并行协议。PG 的跨家庭隔离效果仍需实测。 |
| 金额与估值规则可复用 | [money](/Users/bytedance/Desktop/invest-app/backend/domain/money.py)、[valuation](/Users/bytedance/Desktop/invest-app/backend/domain/valuation.py) | 统一 Decimal 和舍入口径；保留 SQLite 存储精度与 PG NUMERIC 的区别。 |
| 身份、角色和显示范围有独立职责 | [tenancy](/Users/bytedance/Desktop/invest-app/backend/tenancy.py:50) | 缺身份拒绝访问，家庭归属和写权限有集中校验入口。 |
| 前端功能资源已实际拆分 | [资源装配](/Users/bytedance/Desktop/invest-app/frontend/src/app/useFinanceData.js:39)、[禁用资源直接跳过](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useScopedDataResource.js:29) | 虽仍有聚合刷新函数，但并非每次都无条件请求所有功能。不能只看函数里有九个 refresh 就判定全量加载。 |
| 恢复对 ID、幂等与文件持久化有明确设计 | [准备与恢复](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:732)、[恢复回归](/Users/bytedance/Desktop/invest-app/backend/tests/restore_cases.py:44) | 恢复重试不会覆盖后续新流水；移除了不必要的全表锁和全局序列重设。F3 是映射完整性缺口，不推翻整体设计。 |
| 工程验证覆盖实际边界 | [真实浏览器](/Users/bytedance/Desktop/invest-app/frontend/e2e/real-api.spec.js)、[恢复故障用例](/Users/bytedance/Desktop/invest-app/backend/tests/restore_cases.py:83)、[CI](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml) | 不再只用目录/源码结构测试来证明行为正确。 |
| 生产产物与安全配置收敛 | [Vite 配置](/Users/bytedance/Desktop/invest-app/frontend/vite.config.js)、[CSP](/Users/bytedance/Desktop/invest-app/deploy/nginx/snippets/security-headers.conf:4) | 默认构建不含模拟器，CSP connect-src 已为 self；线上是否加载这些头仍未验证。 |

应用用例直接使用具体 SQL、部分读取留在 application、App 承担跨功能装配，在当前规模下均可接受。没有证据支持为了统一形式而再加一层通用 Repository、DI 容器或按行数强拆文件。

## 4. 问题与风险清单

成本按熟悉项目的一位开发者估算，含回归，不含等待外部环境。P2 不代表无需处理；这四项应进入近期迭代。

| 优先级 | 问题 | 具体证据 | 影响 | 建议方案 | 改造成本 |
|---|---|---|---|---|---|
| **P2 / F1，真实功能问题** | 一次刷新失败后，行级操作的已提交意图无法释放，拦住后续合法动作 | [终态直接返回](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:32)、[仅 refreshed 才删除缓存](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:127)、[目标固定动作键](/Users/bytedance/Desktop/invest-app/frontend/src/features/goals/useGoalWorkspace.js:56) | 暂停成功但刷新失败后，即使后来已重新加载并恢复目标，再次暂停也不发请求；按钮表现为无效 | 将资源重新确认接入行级意图生命周期，明确新用户意图的创建；结果未知仍复用旧键 | 0.5–1.5 天 |
| **P2 / F2，真实语义问题** | 有一条调整记录就把缺失历史判成可重建 | [reconstructable 判定](/Users/bytedance/Desktop/invest-app/backend/queries/reconciliation.py:88) | 余额差异仍在，却清除历史不足提示；可能误导后续核对和修复工具 | 分开表示当前差异与历史来源完整性；仅可信基线可证明基线后的可重建性 | 0.5–1 天；若增加基线元数据另计迁移 |
| **P2 / F3，真实审计问题** | 恢复映射遗漏嵌套目标对象的 ID | [递归时丢失子对象类型](/Users/bytedance/Desktop/invest-app/backend/infrastructure/restore_store.py:67)、[目标审计结构](/Users/bytedance/Desktop/invest-app/backend/application/goals.py:19) | 同一审计中 entity_id、goal.id、allocation.goal_id 不一致，影响追溯；未复现资金余额受损 | 按审计事件结构显式映射嵌套实体，未知历史引用明确标识，增加恢复后逐字段断言 | 1–2 天 |
| **P2 / F4，测试缺陷及潜在 CI 风险** | 并发测试固定要求一个 409，排除了合法执行顺序 | [并发任务与断言](/Users/bytedance/Desktop/invest-app/backend/tests/test_cross_workflows.py:639) | 核对先成功时三项操作均可成功，正确实现可能被测为失败 | 受控调度分别验证合法顺序，再做无顺序假设的并发不变量测试 | 0.5–1 天，另需真实 PG 环境 |

**验证缺口，不额外计作已证实代码缺陷**：本轮没有真实 PG 和容器演练结果。CI 已提供 [PG 作业](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml:9) 与 [容器恢复作业](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml:88)，但配置存在不等于运行成功。发布前应取得结果，并先修正 F4 的测试预期。

**可选优化**：随着新功能继续把局部表单和样式放回 feature，观察家庭锁持有时长。当前不把大文件行数、兼容导出或函数内 import 本身当成架构缺陷，也不建议单独启动一轮 CSS 搬迁。

## 5. 重点问题深入分析

本轮未确认 P0/P1。以下说明四项 P2 的完整修复边界，避免仅修复表面症状。

### F1：已提交意图保留过久，阻止下一次合法操作

**当前实现与原因。** `useCommandActions` 按 `goal:id:status` 等键缓存意图。提交后若刷新失败，意图处于 committed 并保留。以后执行同键时，`executeSubmission` 在入口直接返回 duplicate，不执行刷新，也不返回 refreshed。外部的手动、轮询或其他动作刷新没有清理这个 Map 的入口。[代码](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:110)。

**实际复现。** 对真实 `useGoalWorkspace` 和 API 逻辑模拟传输：目标 active → paused 写入成功，随后 loadData 返回 false；手动重新读取成功；paused → active 成功；再次 active → paused。最终仅发送两次 PATCH，正文状态为 `[paused, active]`，第三次合法暂停被吞掉。此复现是 Hook 行为测试，不宣称已经完成该场景的真实后端浏览器复现。

**目标结构。** 一个意图的重试保护与同一实体的后续意图必须分开。服务端状态重新确认之后，可以结束旧终态并允许下一次主动操作；未知结果不能因此被换键重试。

**最小方案。** 为行级命令提供资源确认/释放入口，相关 GET 成功确认状态后释放已完成意图；让手动重新加载和正常刷新调用同一入口。不能在任意刷新失败或点击时直接删除全部意图。

**完整方案。** 将“命令结果”和“资源确认状态”作为两个明确状态；行级动作显式开启新意图，正在处理/结果未知时继续绑定原 operation ID。核查同 Hook 的归档、恢复、删除和预算复制调用，但不要假定它们已出现完全相同的用户场景。

**风险与验证。** 最大风险是重新引入重复记账。补充刷新失败 → GET 恢复 → 反向动作 → 原动作的循环测试；断言新意图有新键、原意图重试不换键。保留现有成功后 GET 失败只写一次的真实浏览器回归，并验证快速双击、身份切换和未知结果恢复。

### F2：历史完整性不能由余额碰巧相等或一条调整记录证明

**当前实现与原因。** `difference == 0`、有 `opened_at`、存在 opening 或 adjustment，任一成立都将 reconstructable 设为 true。差异值与历史来源是否完整是不同事实；增量调整只说明本次差额，无法补齐过去的期初。

**实际复现。** 在临时 SQLite 创建无期初事实的历史账户，余额 1000；初始返回 expected=0、difference=1000、reconstructable=false。通过现有核对接口把余额从 1000 调到 1050，新增真实 adjustment=50；随后返回 actual=1050、expected=50、difference=1000，但 reconstructable=true、limitation=null。新增调整没有补齐原来缺失的 1000 元历史。

**目标结构。** `matches` 表示当前状态和可用事实是否一致；历史证明单独表示基线来源、起算时间和未知范围。即使当前不一致，也可能拥有完整历史；即使当前一致，也不能反证历史完整。

**最小方案。** 移除“有调整就完整”和“差异为零就完整”的推断；仅在能证明现有期初/基线规则已落实时声明从基线起可重建。证据不足仍返回限制，不修改余额或生成补历史流水。

**完整方案。** 明确定义 unknown / 自明确基线起可重建等状态；若现有字段无法表达来源，再追加版本迁移记录基线来源与日期。旧数据默认未知。可信基线之前的历史仍不宣称完整，保留现有响应字段的兼容含义。

**风险与验证。** 不可因修文案而伪造资金历史。覆盖无期初但余额相等、无期初加调整、有可信期初后数据被破坏、建账前历史、投资现金与持仓历史分别不足等情况；断言只读核对不写库，真实余额和已有事实不变。

### F3：恢复后的审计 JSON 使用了两个 ID 空间

**当前实现与原因。** 恢复已正确映射 audit_events.entity_id；递归处理 JSON 时，只为部分键指定子表。目标事件的结构是 `{goal: {...}, allocations: [...]}`，进入 goal 子对象时 table 变为 None，嵌套 id 保留旧值；allocations 中的 goal_id 则按通用外键映射成新值。[映射实现](/Users/bytedance/Desktop/invest-app/backend/infrastructure/restore_store.py:43)。

**实际复现。** 在独立 SQLite 通过业务接口创建目标、导出、预览并恢复。得到 old_goal_id=1、new_goal_id=2、audit.entity_id="2"、audit.after_value.goal.id=1、audit.after_value.allocations[0].goal_id=2。目标数据恢复成功，但审计内容内部不一致。

**目标结构。** 每类审计载荷具有明确的实体引用规则；所有新 ID 引用一致，无法解析的历史引用明确使用历史命名空间。原始金额、业务值不变。

**最小方案。** 给 goal 等已知嵌套结构补充显式映射，并逐项核查预算计划、分摊与组合事件的实际结构；不能对所有名为 id 的数字盲目使用同一张表的映射。

**完整方案。** 为现有审计事件定义可测试的载荷映射器，必要时增加载荷格式版本；恢复器按事件类型/版本处理引用。未知旧格式保留明确来源信息，不把无法判断的 ID 当作当前实体。已恢复数据只有在可靠旧新映射仍可取得时才能自动修复，不可靠数字相似程度猜测。

**风险与验证。** 重点防止错连其他实体或家庭。增加同家庭恢复、跨家庭导入、连续恢复两次、历史实体已删除、多层分摊的字段级断言；检查审计主体、before/after、账户关联及全部已知嵌套外键，同时验证余额、持仓和原金额完全不变。当前证据只确认目标嵌套 ID 漏映射，不据此宣称全部审计类型都有缺陷。

### F4：并发测试不能要求调度器固定选择某个顺序

**当前实现与原因。** 并发运行转出 200、买入支出 300、按 expected=1000 核对到 900；测试固定要求一项 409、两项成功。家庭锁保证串行执行，但不保证核对一定排在后面。

**合法场景。** 核对先取得锁：1000 → 900，之后转出 200、买入 300，余额为 400，三项均成功。转账或买入先发生：核对看到旧 expected 值，返回 409，另两项成功，余额为 500。本轮用真实业务函数在隔离 SQLite 按第一种顺序执行，得到三项成功和余额 400。这证明断言遗漏合法顺序，不是声称已在 PG 观察到 CI 失败。

**目标结构与最小方案。** 接受与执行结果相匹配的两组合法结果：三成功对应 400；核对冲突、两成功对应 500。不能只把成功数量放宽，而不核查哪项冲突、事实数量、现金与审计一致性。

**完整方案。** 用明确同步点分别控制核对先执行与其他写入先执行；再保留不预设顺序的真实 PG 并发测试，断言操作可串行化、无丢失更新、冲突无副作用、同键不重复。测试同步钩子仅属于测试，不侵入生产业务逻辑。

**风险与验证。** 宽泛的“最终余额非负”可能掩盖漏记或重复记账。逐笔核对成功结果、流水/投资交易、账户余额、审计与幂等记录，真实 PG 使用独立连接和测试库运行；不可为满足错误测试改变正确的业务锁顺序。

## 6. 推荐的目标架构

目标基本就是当前架构，重点补齐状态与审计契约。建议保留以下划分，不要求照此重新搬文件：

```text
backend/
├── routers/                 HTTP 输入、认证依赖和响应
├── application/             业务用例、命令协调、授权、恢复与快照编排
├── domain/                  Decimal、账户、记账、估值、预算与日历纯规则
├── queries/                 一致性读取、报表与核对模型
├── infrastructure/          驱动、事务、具体存储与恢复映射
├── integrations/            外部行情适配
├── migrations/              只追加的结构版本链
├── jobs/                    快照及命令响应保留等任务
├── fixtures/                显式启用的开发数据
└── tests/                   领域、SQLite、PG、恢复与跨流程行为测试

frontend/src/
├── app/                     会话、导航、跨功能装配
├── features/
│   ├── accounts/ ledger/ investments/ budget/ goals/ ...
│   └── shared/              通用提交与读取生命周期，不反向分派业务
├── operations/              operation ID、未知结果和重试状态
├── shared/                  业务日期等公共工具
├── components/              可复用界面组件
└── pages/                   页面布局与展示

deploy/                      部署、备份、恢复与运维故障测试
docs/                        当前边界、ADR、验收与运行说明
```

依赖保持 router → application/query → domain + infrastructure/integrations；domain 不依赖 HTTP、数据库或外部服务。前端 app 组合 feature，feature 使用公共能力，共享层不反向依赖具体功能。

需要补齐的核心接口只有三处：行级命令与资源重新确认的通知契约、核对结果中的历史证明契约、恢复器对审计实体引用的映射契约。现有 FinancialCommandResult、显式连接、AuthContext 和 Decimal 继续复用。测试修正 F4，不需要增加新的运行时层。

## 7. 分阶段改造计划

| 阶段 | 改动范围 | 预期收益 | 风险 | 验证方法 | 大致工作量 |
|---|---|---|---|---|---|
| 第一阶段：低风险、高收益 | 修正 F4 断言并补受控顺序；为 F1–F3 固化本报告复现；修正 F2 的无依据推断 | 先让测试表达正确业务语义，避免遗漏继续被绿灯掩盖 | 不得把真实冲突断言删成宽松校验；核对只改语义不动财务事实 | 重现原错误后验证修复；全部后端相关回归 | 1–2 天 |
| 第二阶段：解决边界缺口 | 完整修复 F1 行级命令生命周期和 F3 审计映射；若确有需要再补历史基线元数据 | 消除合法动作被拦截和恢复后追溯不一致 | 操作键生命周期回归；历史 ID 错映射；新增元数据兼容 | Hook 行为测试、真实浏览器刷新故障与动作循环、完整恢复字段核对；新增结构走版本迁移 | 2–4 天 |
| 第三阶段：工程验收与治理 | 在独立 PG 运行全部并发/MVCC 测试，在 Docker 跑备份恢复演练；补充实际运行报告和必要任务告警 | 让生产路径具有运行证据，确认恢复耗时和失败退出行为 | 测试必须隔离生产；缺少运维配置不能视为代码已完成 | CI 实际结果、恢复报告、退出码/告警接收证据；保持本地回归 | 环境就绪后约 1–2 天，等待环境另计 |

各阶段保持项目可运行；第一阶段不必等待生产环境。无需重做已经通过的目录拆分。新增数据库变化只追加迁移，保留旧备份兼容；任何历史数据修复先生成只读差异报告和恢复方案，不擅自重算真实余额或补造事实。

## 8. 最终建议

**未来 6～12 个月能否继续支撑？** 按当前家庭财务业务和模块化单体形态，可以继续演进，前提是修复上述缺口并完成 PG/恢复验收。用户数、账本规模、请求量和可用性目标未提供，因此对容量和 SLA 的定量承诺为“无法判断”。

**最优先的三件事：**

1. 修复行级命令在失败刷新后的恢复路径，并保住现有防重复记账测试。
2. 修复恢复审计 ID 和核对历史完整性的语义，保证用户看到的追溯信息可信。
3. 修正并发测试预期，取得真实 PostgreSQL 与容器恢复的执行结果。

**应保持不动：** 模块化单体、当前 financial_command 边界、家庭写锁策略、显式一致性读取、tenancy 权限规则、Decimal 与历史汇率、增量迁移和目标仅记录进度的产品语义。保留仍有用途的 Docker/Vercel 支持。

**现在不必做：** 微服务、消息队列、事件溯源、通用仓储/依赖注入框架、仅为行数而拆文件、全量 CSS 搬迁、更细的资金写并行化，以及把储蓄目标直接改为资金预留。若以后需要预留资金，应作为独立产品变更设计。

**如果只能做一次架构优化：** 完成“业务意图—服务端提交结果—资源重新确认”这个前端生命周期边界。它被多个功能复用，既要阻止同一笔资金被重复提交，又要允许下一次合法操作；F1 表明其中最后一段尚未闭合。保持其接口清晰，比继续移动目录更能降低后续功能出错的概率。
