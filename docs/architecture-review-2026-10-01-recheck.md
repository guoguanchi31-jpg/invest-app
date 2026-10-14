# Invest 架构审计报告

日期：2026-10-01。范围：当前工作区，包括已有未提交与未跟踪代码。重新读取实际入口、业务调用链、前端提交状态、历史基线、恢复映射及测试，并重新运行本地验证。

本轮只新增本报告；未修改业务实现、执行生产迁移或操作真实财务数据。补充复现使用独立临时 SQLite 和临时前端探针，结束后已清理。本文描述当前行为，不将新发现的问题直接认定为本次改动引入。

## 1. 总体结论

| 项目 | 结论 |
|---|---|
| 架构合理度 | **良好** |
| 综合评分 | **87 / 100**，按家庭财务应用规模评估，属于工程判断。 |
| 一句话结论 | 模块边界和核心事务模型已稳定，旧问题大部分完成闭环；仍有日期输入契约影响记账正确性，以及跨月故障恢复的状态缺口。 |
| 最突出的优点 | 历史证明、审计引用、财务事务、幂等与读取确认已有具体契约，并由跨流程行为测试验证。 |
| 最大的架构风险 | 业务日期以文本保存和比较，但 API 并未保证唯一文本格式；不同模块对同一日期的解释因此不一致。 |
| 是否需要立即重构 | **否**。需要优先修复 N1，随后修复 N2；均可在现有边界内完成。 |
| 判断依据 | 当前实现、重新执行的 210 项后端与 160 项前端测试、12 项真实接口浏览器测试，以及两类补充复现。 |

本轮确认 **1 项 P1、1 项 P2**，未确认新的 P0。N1 的已知触发入口是 API 接受非标准日期，未证明标准日期控件或真实账本已经触发；但已在实际认证、参数校验、业务路由与数据库链路中复现错误余额行为，需要优先处理。

### 旧问题复核

| 旧问题 | 本轮判断 | 当前证据 |
|---|---|---|
| 行级动作遇到读取失败后一直被拦截 | **常规同月流程已修复，但整体不能完全关闭**；读取失败后直接切月仍有 N2 | [确认消费](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:113)、[现有生命周期用例](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/commandLifecycle.test.jsx:43)；真实浏览器同月循环通过 |
| 有调整记录就误判历史可重建 | **原问题可以关闭** | [独立历史证明](/Users/bytedance/Desktop/invest-app/backend/domain/reconciliation.py:11)、[历史用例](/Users/bytedance/Desktop/invest-app/backend/tests/history_cases.py)、[迁移默认 unknown](/Users/bytedance/Desktop/invest-app/backend/migrations/schema.py:708) |
| 恢复后嵌套审计 ID 留在旧命名空间 | **已覆盖的目标、预算、交易结构可以关闭** | [版本化映射](/Users/bytedance/Desktop/invest-app/backend/domain/audit_payloads.py)、[同家庭、跨家庭及重复恢复测试](/Users/bytedance/Desktop/invest-app/backend/tests/restore_cases.py:27) |
| 并发测试强制要求一个 409 | **错误断言已修复**；真实 PG 执行仍缺证据 | [控制首个写入者并检查资金、事实、审计和重放](/Users/bytedance/Desktop/invest-app/backend/tests/concurrency_cases.py) |
| 成功读取确认后切月丢失确认 | **该已确认场景已修复**；不要与 N2 的“尚未确认就切月”混为一谈 | [锁存 readConfirmed](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:115)、[切月测试](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/commandLifecycle.test.jsx:55) |
| 投资账户备份缺少默认字段导致异常 | **对应问题已修复** | [统一账户默认值](/Users/bytedance/Desktop/invest-app/backend/domain/accounts.py)、[备份规范化](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:293)、[历史兼容测试](/Users/bytedance/Desktop/invest-app/backend/tests/history_cases.py) |
| 嵌套目标、预算审计展示无变化 | **对应问题已修复** | [按实体解释审计](/Users/bytedance/Desktop/invest-app/frontend/src/features/audit/presentation.js)、[详情组件](/Users/bytedance/Desktop/invest-app/frontend/src/components/AuditDetails.jsx)；实际接口浏览器审计展示通过 |
| 转账精度导致交易失败或自身备份不兼容 | **已复核的两个场景已修复** | [转账估值和有界残差](/Users/bytedance/Desktop/invest-app/backend/domain/transfers.py:7)、[领域回归](/Users/bytedance/Desktop/invest-app/backend/tests/test_domain_rules.py:153)、后端转账/恢复测试 |

### 本轮重新执行的验证

| 检查 | 结果 | 范围与限制 |
|---|---|---|
| 后端 unittest | **210 项：178 通过、32 跳过、0 失败** | 31 项 PG 工作流未启用，SQLite 类中另有 1 项 PG 专属测试跳过。 |
| 前端 Vitest / coverage | **27 文件、160 项通过** | 语句 75.30%，分支 60.45%，函数 70.51%，行 78.21%。 |
| lint | **通过，0 warning / 0 error** | `npm run lint`。 |
| 生产构建与产物检查 | **通过，14 个产物文件** | `npm run verify:build`。 |
| 真实 API 浏览器 | **12 项通过、0 跳过** | 独立 FastAPI + SQLite；桌面、平板、手机视口。包含财务流程、写后读取失败、目标循环及嵌套审计。 |
| 模拟 API 浏览器 | **19 项通过、2 项跳过** | 2 项为显式宽度矩阵只在桌面项目运行一次的预设跳过，不是缺后端环境。 |
| 运维故障注入 | **8 项通过** | 备份脚本的模拟故障测试，不是 Docker 恢复实跑。 |
| 架构 AST 检查 | **通过** | `venv/bin/python architecture_check.py`，在 backend 目录运行。 |
| 补充日期复现 | **确认 N1** | 实际认证与 FastAPI ASGI 请求、真实临时 SQLite；两次写入均返回 HTTP 200。 |
| 补充前端复现 | **确认 N2** | 实际 Hook、资源确认与 API 逻辑，模拟网络/服务端状态；不计入上述 160 项既有测试。 |
| diff 空白检查 | **通过** | 仅检查工作区格式，不代表全部行为正确。 |

后端命令：在 backend 目录运行 `venv/bin/python -m unittest discover -s tests -p 'test_*.py' -q`。前端命令：在 frontend 目录运行 `npm run test:coverage`、`npm run lint`、`npm run verify:build`、`npm run test:e2e:real`、`npm run test:e2e`。运维命令：根目录运行 `python3 -m unittest discover -s deploy/tests -p 'test_*.py' -q`。

本轮日志：[后端](/tmp/invest-audit-20261001-backend.log)、[前端](/tmp/invest-audit-20261001-frontend.log)、[构建](/tmp/invest-audit-20261001-build.log)、[真实浏览器](/tmp/invest-audit-20261001-real-browser.log)、[模拟浏览器](/tmp/invest-audit-20261001-mock-browser.log)。结构化结果：[真实浏览器报告](/Users/bytedance/Desktop/invest-app/frontend/test-results/real-api/report.json)。这些是本地生成产物，不作为生产运行证据。

**无法判断**：真实 PostgreSQL 的锁等待、MVCC、死锁与迁移表现；真实 Docker 恢复耗时及故障恢复；生产 Nginx 响应头、原生 iOS/Android 行为、远端备份和告警送达。本机未配置 `INVEST_TEST_POSTGRES_URL`，没有 Docker/Podman/PostgreSQL/psql。需要对应 CI 实际执行报告、隔离恢复演练报告、线上部署证据和设备测试结果；不能用 SQLite、模拟脚本或 CI 配置代替。

## 2. 架构还原

当前仍是**模块化单体、应用用例与查询分离、直接 SQL 持久化**。技术形态适合当前家庭财务业务，未发现需要拆服务才能解决的问题。

| 模块 | 实际职责 | 证据 |
|---|---|---|
| React / Capacitor、app | 会话、身份与 scope、导航、页面和跨功能表单装配 | [App](/Users/bytedance/Desktop/invest-app/frontend/src/App.jsx)、[useSession](/Users/bytedance/Desktop/invest-app/frontend/src/app/useSession.js) |
| features / operations | 各功能查询、草稿、提交、展示转换；独立管理 operation ID、未知结果及互斥动作 | [资源装配](/Users/bytedance/Desktop/invest-app/frontend/src/app/useFinanceData.js)、[操作存储](/Users/bytedance/Desktop/invest-app/frontend/src/operations/operationStore.js)、[API](/Users/bytedance/Desktop/invest-app/frontend/src/api.js) |
| routers / schemas | HTTP 参数、输入校验、认证依赖、响应；财务入口使用命令装饰器 | [路由注册](/Users/bytedance/Desktop/invest-app/backend/main.py:112)、[账户入口](/Users/bytedance/Desktop/invest-app/backend/routers/accounts.py:46) |
| application | 授权、账户/流水/投资/预算/目标用例，组织资金状态、事实、审计及快照 | [commands](/Users/bytedance/Desktop/invest-app/backend/application/commands.py)、[ledger](/Users/bytedance/Desktop/invest-app/backend/application/ledger.py)、[accounts](/Users/bytedance/Desktop/invest-app/backend/application/accounts.py) |
| domain | 金额、日历、记账方向、账户不变量、历史证明、转账估值、审计载荷映射 | [domain](/Users/bytedance/Desktop/invest-app/backend/domain/) |
| queries / infrastructure | 一致性读取，数据库连接与事务、具体存储、恢复引用映射 | [consistent_query](/Users/bytedance/Desktop/invest-app/backend/infrastructure/read_models.py)、[database](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py)、[restore_store](/Users/bytedance/Desktop/invest-app/backend/infrastructure/restore_store.py) |
| migrations / integrations / jobs | schema 版本升级、行情服务、快照及幂等响应保留任务 | [迁移链](/Users/bytedance/Desktop/invest-app/backend/migrations/schema.py:721)、[行情](/Users/bytedance/Desktop/invest-app/backend/application/market_data.py)、[调度](/Users/bytedance/Desktop/invest-app/backend/snapshot_scheduler.py) |

实际链路：

```text
财务写入：
页面 → feature action → operation ID → 认证/参数校验 → financial_command
    → 家庭写事务 → 应用用例与领域规则
    → 事实 + 余额/持仓 + 审计 + 快照 + 幂等结果 → 一次提交
    → 前端确认业务结果 → 相关资源读取 → 释放已完成意图

读取：
资源 Hook → GET → 身份/家庭/scope → consistent_query
    → 同连接、同读取快照的组合查询 → 接受当前身份和查询的响应

互斥状态动作：
新动作 → 发现旧结果未知 → 查询 /commands/{key}
    → 仅服务端终态允许退休旧键并开始新动作

备份恢复：
一致性导出/预览 → 锁外持久化恢复前副本
    → 家庭写锁内重核指纹 → 新 ID 与显式引用映射
    → 作废旧键、保留本次恢复键 → 审计/快照/结果原子提交
```

`transactions` 是现金变动事实，`investment_trades` 是投资交易事实；`accounts`、`holdings` 保存当前状态，`snapshots` 是派生估值。`goal_records` 只表示目标进度，不代表冻结或划拨现金。`history_basis` 说明账户基线证据，不能替代现金事实。[当前核对](/Users/bytedance/Desktop/invest-app/backend/queries/reconciliation.py)、[目标记录用例](/Users/bytedance/Desktop/invest-app/backend/application/goals.py:293)。

Compose 是完整生产运行方式；容器先迁移再启动 API。Vercel 保留关闭自动迁移和进程内调度的 API 兼容入口。当前 schema 为 9、JSON 备份为 v8。顶层 services/database 等仍是兼容导出，不应按旧文件名判断存在第二套业务实现。[部署](/Users/bytedance/Desktop/invest-app/docker-compose.yml)、[后端入口](/Users/bytedance/Desktop/invest-app/backend/Dockerfile)、[Vercel](/Users/bytedance/Desktop/invest-app/backend/vercel.json)、[备份版本](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:37)。

## 3. 做得合理的地方

| 架构点 | 具体证据 | 带来的价值 |
|---|---|---|
| 资金事务边界保持集中 | [financial_command](/Users/bytedance/Desktop/invest-app/backend/application/commands.py)、[事务上下文](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py:74) | 状态、事实、审计、快照和幂等结果同成同败；内部不自行提交。 |
| 历史完整性与余额差异分开 | [account_history](/Users/bytedance/Desktop/invest-app/backend/domain/reconciliation.py:11)、[history_cases](/Users/bytedance/Desktop/invest-app/backend/tests/history_cases.py) | 不再用一条 adjustment 或差额为零伪造历史完整性。N1 属于日期输入边界，应保留这项改进。 |
| 审计使用显式版本和实体结构 | [audit_payloads](/Users/bytedance/Desktop/invest-app/backend/domain/audit_payloads.py)、[前端审计转换](/Users/bytedance/Desktop/invest-app/frontend/src/features/audit/presentation.js) | 避免嵌套 ID 猜测；未知载荷有历史命名空间；显示层保留字段白名单。 |
| 并发测试验证合法业务结果 | [concurrency_cases](/Users/bytedance/Desktop/invest-app/backend/tests/concurrency_cases.py) | 不只看非负余额，还检查流水、交易、审计、幂等及受控首写者。 |
| 未知命令状态查询保持最小信息 | [get_command_status](/Users/bytedance/Desktop/invest-app/backend/queries/commands.py:7)、[认证路由注册](/Users/bytedance/Desktop/invest-app/backend/main.py:114) | 按家庭和操作用户过滤，只返回状态；不存在不被误认为旧操作已经失败。 |
| 转账精度规则进入领域层 | [transfer_valuation](/Users/bytedance/Desktop/invest-app/backend/domain/transfers.py:7)、[收款腿残差校验](/Users/bytedance/Desktop/invest-app/backend/domain/transfers.py:17) | 同币种不从零本位币金额反推零汇率；跨币种和恢复使用一致的精度规则。 |
| 新元数据采用追加迁移 | [migration_009](/Users/bytedance/Desktop/invest-app/backend/migrations/schema.py:708)、[迁移回归](/Users/bytedance/Desktop/invest-app/backend/tests/test_architecture_regressions.py:191) | 旧账户保留原值、默认 unknown；迁移不会自动补造期初。 |
| 读取确认使用事件序号 | [resourceConfirmation](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/resourceConfirmation.js)、[读取接受条件](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useScopedDataResource.js) | 不依赖设备墙钟；旧身份、过期请求和提交前读取不能解除防重。N2 需要补实体与月份的区别。 |
| 验证入口覆盖实际业务流程 | [真实浏览器](/Users/bytedance/Desktop/invest-app/frontend/e2e/real-api.spec.js)、[独立 runner](/Users/bytedance/Desktop/invest-app/frontend/scripts/real-api-e2e.mjs)、[CI](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml) | 模拟接口、真实接口、PG、容器演练分开；不会把真实接口全跳过当作浏览器验收成功。 |

没有证据支持继续机械拆 services、database 或 App。当前应用用例直接依赖具体数据库能力，在这个规模下可以接受；纯计算已经进入 domain，不必引入通用 Repository 或 DI 容器。

## 4. 问题与风险清单

| 优先级 | 问题 | 具体证据 | 影响 | 建议方案 | 改造成本 |
|---|---|---|---|---|---|
| **P1 / N1，真实问题** | 日期验证接受多种格式，却返回原始文本；后续余额和月份逻辑要求标准格式 | [DatedModel](/Users/bytedance/Desktop/invest-app/backend/schemas.py:17)、[opening_date 校验](/Users/bytedance/Desktop/invest-app/backend/schemas.py:84)、[余额字符串比较](/Users/bytedance/Desktop/invest-app/backend/domain/accounting.py:16) | API 可成功创建支出但不扣余额；或扣余额后按月查不到流水；自身备份可能被历史证明校验拒绝 | 在边界保证唯一 YYYY-MM-DD；领域比较使用明确日期语义；为旧非规范数据生成只读影响清单及兼容方案 | 新写入修复与回归约 1–2 天；存量治理视实际扫描结果另计 |
| **P2 / N2，真实问题** | 未取得原月份确认就切月，旧目标状态意图仍拦截后续合法循环 | [目标意图绑定月份](/Users/bytedance/Desktop/invest-app/frontend/src/features/goals/useGoalWorkspace.js:58)、[确认必须同资源键](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/resourceConfirmation.js:12)、[终态提前返回](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:33) | 完成成功 → GET 失败 → 切月 → 恢复成功 → 再完成，只发送两次 PATCH；最后按钮无效 | 为全局目标状态建立按实体确认/新意图边界，保留预算等按月命令的确认规则 | 0.5–1.5 天 |

成本按熟悉项目的单人估算。N1 是本轮新确认的缺陷，N2 是既有提交生命周期问题的剩余组合场景；不把已修复的同月循环重新算作失败。

**潜在风险／验证缺口**：生产 PG 与容器恢复仍未实际验收。已有 [PG CI](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml:9) 和 [容器演练 CI](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml:88)，但本轮未取得运行记录，不能据此宣称生产并发和恢复正确，也没有依据判定它们必然失败。

**可选优化**：随功能迭代继续下沉局部样式和页面装配；在有实际锁等待数据后再考虑细化家庭锁。当前不以行数、目录层级或局部 import 形式作为问题依据。

## 5. 重点问题深入分析

### N1：同一个业务日期在不同边界有不同含义

**1. 当前实现。** `DatedModel.validate_iso_date` 和账户的 `validate_opening_date` 只调用 `date.fromisoformat` 验证可解析性，随后返回输入字符串。`affects_balance` 直接比较 `occurred_at >= opened_at`；月度查询使用字符串前七位；历史证明则把 opened_at 转成标准 ISO 日期后与期初流水原值比较。

**2. 为什么有问题。** 可被日期解析器接受不等于已满足存储所需的唯一格式。紧凑日期 `20260901` 可通过验证，但与 `2026-09-28` 的文本排序不等于日期排序。新增历史证明将一边规范化、另一边保留原值，又使同一账户的期初证据失配。[月份过滤](/Users/bytedance/Desktop/invest-app/backend/application/ledger.py:688)、[历史日期比较](/Users/bytedance/Desktop/invest-app/backend/domain/reconciliation.py:18)。

**3. 实际触发场景。** 通过认证的 FastAPI ASGI 请求，使用独立 SQLite，复现结果：

```text
POST /accounts
{name: "compact-opening", type: "debit_card", balance: 100,
 opening_date: "20260901"}
→ HTTP 200

POST /transactions
{account_id: 上述账户, amount: 10, direction: "expense",
 occurred_at: "2026-09-28"}
→ HTTP 200，balance_applied=false，账户余额仍是 100
→ 正确业务日期含义下应当扣到 90

导出该账本，再 POST /warehouse/restore/preview
→ HTTP 422：账户历史基线缺少对应期初事实
```

第二个独立场景：正常日期 `2026-09-01` 建账，提交 `occurred_at="20260928"` 的支出。HTTP 200，余额从 100 变为 90，但 `GET /transactions?month=2026-09` 查不到该条流水。

这两个结果是实际路由和数据库执行结果，不是只检查源码推测；没有据此声称生产用户已受影响，也没有证明正常浏览器日期控件会产生紧凑格式。

**4. 目标结构。** 新业务日期在进入应用用例和持久化前就保证唯一 `YYYY-MM-DD` 表达。日期解析、比较、月份提取和备份校验共享同一个定义。业务日期仍与带时区的发生时间戳分开。

**5. 最小改造。** 按现有 API 的 YYYY-MM-DD 契约严格检查格式和日期有效性，再返回标准值；或者明确兼容其他 ISO 输入，但必须统一转成标准值后才进入业务层。不要继续“验证转换结果、返回未转换原值”。同时覆盖 opening_date、occurred_at、recorded_at 等日期字段，确认请求指纹使用验证后的值。

**6. 完整改造。** 将业务日期解析/比较收敛到已有日历模块；补齐查询边界与备份输入的契约。对现有数据先只读扫描非规范日期和相关 balance_applied 记录，输出影响账户、原始日期及差异。日期文本修正可能改变原先是否应影响余额的解释，不能批量改日期后直接重算资金或重写 balance_applied。需要保留原始证据、兼容旧备份，并对需资金调整的账户使用现有可追溯核对流程。只有确需数据迁移时才追加版本，不修改已应用的迁移。

**7. 风险与验证。** 最大风险是修格式时改变存量财务含义。至少增加真实路由测试：标准日期、紧凑日期、ISO 周日期、闰日、非法日期、建账前后与跨月；验证非法输入无资金/流水/审计/幂等副作用，兼容输入若被接受则存储必须规范。断言余额、月份查询、核对与导出恢复往返一致。分别在 SQLite 和真实 PG 运行；旧数据扫描与修复另设前后对比和恢复方案。

### N2：目标状态是实体状态，确认却绑定了月份视图

**当前实现。** 命令 Map 使用 `goal:{id}:{status}`，其中 resourceKey 固定为首次提交的 `goals:{month}`。只有相同月份的读取确认才能释放。已经获得确认后切月的场景已正确锁存；未获得确认时仍保留原键。

**补充复现。** 实际 `useGoalWorkspace`、`useScopedDataResource` 和 API 逻辑，传输使用可记录状态的模拟实现：

1. 9 月视图将目标设为 completed，写入成功，随后 GET 失败。
2. 不在 9 月重新加载，直接切到 10 月；GET 成功，页面拿到目标 completed。
3. 恢复为 active，第二次 PATCH 成功，GET 也成功。
4. 再次标记 completed，被 9 月遗留的 committed 意图提前拦截。

实际写入状态序列只有 `[completed, active]`；服务端模拟状态和页面接受的状态仍为 active。该补充场景未执行真实后端浏览器复现；既有真实浏览器的同月流程通过。

**为什么仍是缺陷。** 后端目标状态存储在目标实体上，不是逐月状态；目标查询按月份筛选可见性和进度，却读取同一个当前 status。[状态写入](/Users/bytedance/Desktop/invest-app/backend/application/goals.py:264)、[查询实体状态](/Users/bytedance/Desktop/invest-app/backend/queries/finance.py:855)。旧完成操作已经明确提交，后续相反操作也已成功；再次完成是新的合法业务意图，不是重试旧写入。

**修复方向。** 最小方案是在同一实体的后续状态操作成功并确认后，明确退休其旧终态意图。完整方案是将“月份查询结果已加载”和“某目标状态已确认”拆为不同语义：后者按目标 ID、身份和操作顺序确认，确认数据须确实包含该实体；前者继续服务预算等逐月动作。不要简单删除所有月份检查，也不要用任意 GET 清除未知或 pending 意图。

**验证要求。** 将上述四步固化为行为测试并补真实浏览器场景；保留同月故障重载、确认后切月、旧 GET、其他身份、双击、未知结果原键重试和主动重复录入。针对目标状态和预算复制分别验证其实体/月份边界，避免通用 Hook 为修一个动作放宽所有动作的去重规则。

## 6. 推荐的目标架构

继续沿用当前结构，仅补齐“业务日期”和“实体状态确认”两个接口，不再启动全项目搬迁：

```text
backend/
├── routers/            HTTP、认证依赖、协议响应
├── schemas.py          输入格式约束，输出规范化业务日期
├── application/        授权、用例、事务与审计编排
├── domain/             日期、金额、记账、历史证明、审计和转账规则
├── queries/            显式一致性读取
├── infrastructure/     数据库、具体存储、恢复引用映射
├── integrations/       外部行情
├── migrations/         只追加的结构/兼容迁移
├── jobs/               快照及维护任务
└── tests/              领域、路由、跨流程、SQLite/PG 行为验证

frontend/src/
├── app/                会话、导航及跨功能装配
├── features/           功能查询、草稿、动作和展示模型
│   └── shared/         提交生命周期及明确区分语义的读取确认
├── operations/         操作键、未知结果和互斥动作
├── shared/             日期等公共能力
├── components/         共享界面组件
└── pages/              页面展示

deploy/                 部署、备份、恢复与演练
docs/                   架构契约、ADR、运行与验收记录
```

后端依赖仍为 router → application/query → domain + infrastructure/integrations，domain 不反向依赖框架或数据库。前端 app 装配 feature，共享层不反向分派具体业务。

数据流仍由财务事实驱动状态，快照作为派生结果。所有现金与持仓写入继续进入现有财务命令边界。新增日期契约在持久化前生效；新增实体确认契约负责结束已完成意图，不能替代服务端权限与幂等。

## 7. 分阶段改造计划

| 阶段 | 改动范围 | 预期收益 | 风险 | 验证方法 | 工作量 |
|---|---|---|---|---|---|
| 第一阶段：立即实施 | 固化 N1/N2 复现；修复新日期输入契约 | 阻止新写入产生错误余额分类、不可见月份数据及不兼容备份 | 接口对非规范日期的兼容性变化；不得暗改历史 | 认证路由测试、余额/月份/核对/备份往返，相关后端回归 | 1–2 天 |
| 第二阶段：补齐边界 | 修复目标实体状态确认；增加非规范历史日期的只读检查及兼容处理说明 | 失败后跨月仍可继续操作；明确是否存在受影响旧数据 | 放松防重、误读其他实体；历史余额被擅自重算 | 生命周期与真实浏览器组合测试；历史扫描前后数据不变 | 1–2 天；实际存量修复另计 |
| 第三阶段：工程验收 | 在独立 PG 执行 31 项共享工作流及对应专属验证，执行真实容器恢复演练；保留报告 | 补齐生产数据库与恢复链路证据 | 环境必须与真实账本隔离 | CI 实际结果、恢复校验与耗时记录，必要原生端及部署检查 | 环境就绪后约 1–2 天，外部等待另计 |

每一步保持可运行。已有迁移、财务边界和部署形态继续复用；不为修两个契约引入队列、服务拆分或通用框架。生产数据若需修复，另行给出可审查的差异和恢复方案。

## 8. 最终建议

**能否支撑未来 6～12 个月？** 按当前家庭财务规模与功能方向，可以继续演进；修复 N1/N2 并补齐 PG/恢复验收即可。实际用户量、账本记录量、请求峰值和 SLA 未提供，容量上限与可用性承诺为“无法判断”。

**最优先的三件事：**

1. 统一日期输入、存储与比较契约，确保成功返回的支出按正确业务日期影响余额。
2. 完成目标状态在“读取失败后切月”场景中的新意图边界，保留全部防重约束。
3. 取得真实 PostgreSQL 和容器恢复的执行证据，不能继续用本地绿灯代替。

**应保持不动：** 模块化单体、financial_command、家庭锁、一致性读取、tenancy、Decimal、历史汇率、历史基线与版本化审计设计、增量迁移，以及目标进度不占用真实现金的产品语义。

**现在不必做：** 拆微服务、引入消息队列或事件溯源、强制全套仓储/DI、按行数重拆模块、单独清理大样式文件，以及把目标直接改为资金预留。不要为了关闭 N1 放宽历史证据校验，也不要为了关闭 N2 清空所有操作缓存。

**如果只能进行一次架构优化：** 优先统一业务日期契约。它同时影响账户期初、流水是否记账、月份汇总、历史证明和备份恢复；本轮已经证明这些模块使用不同日期表达会产生持久化语义错误。修好这一处比继续调整目录更直接地保护财务正确性。
