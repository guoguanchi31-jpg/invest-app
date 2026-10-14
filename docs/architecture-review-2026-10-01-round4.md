# Invest 架构审计报告：第四轮复核

日期：2026-10-01。范围：当前工作区，包括已有未提交和未跟踪的实现、文档及测试；不是仅审查 Git 已跟踪文件，也不是复述上一轮结论。

本轮只新增本报告，未修改业务代码、执行生产迁移或操作真实财务数据。补充复现使用临时 SQLite、测试身份和临时前端探针，探针已清理。审查期间工作区又出现恢复、权限、幂等和前端改动，已重新读取并重跑相关验证；以下测试数字采用最后一轮结果。最后一轮验证期间核对的 228 个源码文件未再变化。

## 1. 总体结论

| 项目 | 结论 |
|---|---|
| 架构合理度 | **良好** |
| 综合评分 | **87 / 100**。按家庭财务应用规模评估，属于工程判断。 |
| 一句话结论 | 模块化单体和财务事务边界已经基本稳定，当前重点是补齐旧数据、旧客户端意图和异步交错的兼容契约。 |
| 最突出的优点 | 资金写入、审计、快照和幂等结果具备统一事务边界；领域规则、身份权限、查询一致性和恢复校验均有实际实现及行为测试。 |
| 最大的架构风险 | 持久化协议发生变化时，只保证新请求正确，尚未完整处理旧操作和旧财务记录的后续生命周期。 |
| 是否需要立即重构 | **否**。需要优先修复两个 P1，均可在现有模块内完成，不需要重写项目。 |
| 判断依据 | 当前调用链和具体代码；最后一轮 227 项后端测试、181 项前端测试、12 项真实 API 浏览器用例，以及四组补充复现。 |

本轮确认 **2 项 P1、2 项 P2**，未确认 P0。两个 P1 都有明确的历史状态触发条件；没有读取实际用户账本或浏览器存储，**无法判断真实用户是否已受影响**。不把“未发现生产事故”等同于兼容机制正确，也不把条件性缺陷描述为所有正常操作都会失败。

### 旧问题复核

| 之前的问题 | 当前判断 | 具体证据 |
|---|---|---|
| 新 API 接受紧凑日期，造成余额和月份查询解释不同 | **新写入入口已修复**；已受影响旧流水另见 R2 | [统一日期解析](/Users/bytedance/Desktop/invest-app/backend/domain/dates.py)、[BusinessDate](/Users/bytedance/Desktop/invest-app/backend/schemas.py:15)、[日期回归](/Users/bytedance/Desktop/invest-app/backend/tests/test_finance_regressions.py:860) |
| 刷新失败后直接切月，恢复后不能再次完成目标 | **原来的串行场景已修复**；旧刷新尚未结束的交错场景仍有 R3 | [stateKey](/Users/bytedance/Desktop/invest-app/frontend/src/features/goals/useGoalWorkspace.js:60)、[真实浏览器用例](/Users/bytedance/Desktop/invest-app/frontend/e2e/real-api.spec.js:277)；三个视口均通过 |
| 后端业务持续进入顶层 services/database | **不应继续按旧结论重复拆分** | [services 兼容导出](/Users/bytedance/Desktop/invest-app/backend/services.py)、[database 兼容别名](/Users/bytedance/Desktop/invest-app/backend/database.py)、[分层约束](/Users/bytedance/Desktop/invest-app/backend/architecture_check.py) |
| 前端只有 investments feature，所有功能集中拉取 | **已完成实质性拆分**，聚合装配仍存在但有合理用途 | [按功能资源装配](/Users/bytedance/Desktop/invest-app/frontend/src/app/useFinanceData.js)、[功能目录](/Users/bytedance/Desktop/invest-app/frontend/src/features)；资源按页面启用，操作有独立功能 action |
| 幂等响应永久保留，清理可能重新执行旧命令 | **已有保留期与终态机制** | [清理 response、保留 expired 记录](/Users/bytedance/Desktop/invest-app/backend/jobs/financial_command_retention.py:51)、[重放处理](/Users/bytedance/Desktop/invest-app/backend/application/commands.py:34) |
| 模拟器进入生产包、CSP 任意 HTTPS 外连 | **对应配置已修复** | [条件构建入口](/Users/bytedance/Desktop/invest-app/frontend/vite.config.js)、[connect-src self](/Users/bytedance/Desktop/invest-app/deploy/nginx/snippets/security-headers.conf)；生产产物校验通过 |
| 备份可保留有效期初却篡改账户余额 | **新增加的重建校验已覆盖该场景**；与 R2 的错误 balance_applied 属于不同问题 | [备份重建校验](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:627)、[历史恢复测试](/Users/bytedance/Desktop/invest-app/backend/tests/history_cases.py:82) |
| SQLite 转 PostgreSQL 准备时遗漏 WAL 已提交数据 | **准备副本已改用 Online Backup API**；真实 PG 导入仍未验证 | [prepared_sqlite_copy](/Users/bytedance/Desktop/invest-app/backend/migrate_sqlite_to_postgres.py:29)、[工作流测试](/Users/bytedance/Desktop/invest-app/backend/tests/test_workflow_regressions.py) |

### 实际执行结果

| 检查 | 最后一轮结果 | 说明 |
|---|---|---|
| 后端 unittest | **227 项：192 通过、35 跳过、0 失败** | PostgreSQL 共享工作流未配置；另含 SQLite 套件中的 PG 专属检查。不能把跳过计作通过。 |
| 前端 Vitest / coverage | **29 文件、181 项通过** | 语句 75.67%、分支 61.49%、函数 70.19%、行 78.49%。 |
| 前端 lint | **通过** | `npm run lint`。 |
| 生产构建及产物校验 | **通过，14 个文件** | `npm run verify:build`。 |
| 真实 API 浏览器 | **12 通过、0 跳过** | 隔离 FastAPI + SQLite，桌面、平板和手机视口；不是 PG 或原生设备测试。 |
| 模拟 API 浏览器 | **32 通过、16 跳过** | 8 个显式视口矩阵只在 desktop 项目执行，另外两个项目预设跳过。 |
| 运维脚本故障注入 | **8 通过** | 模拟脚本故障，不代表真实 Docker 恢复已演练。 |
| 架构 AST / diff 空白检查 | **通过** | 不以结构检查替代业务行为测试。 |
| 补充升级兼容复现 | **确认 R1** | 实际 operationStore + 模拟浏览器存储；后端命令与真实临时 SQLite。 |
| 补充历史日期迁移复现 | **确认 R2** | 构造旧规则产生的状态，运行真实 schema 10 与当前核对代码。 |
| 补充异步交错复现 | **确认 R3** | 实际 Hook、API 和资源确认代码，网络/读取时序模拟；预期 3 次 PATCH，实际 2 次。 |
| 补充旧快照备份复现 | **确认 R4** | 从临时旧格式数据库实际导出 JSON，再调用恢复预览；返回 422。 |

真实浏览器第一次尝试因启动就绪超时未执行；第二次发生 trace 产物 ENOENT，9 项通过、1 项失败、2 项未执行。未将这两次记为成功。随后仅将 runner 的产物目录改为独立路径，保持用例、临时数据库和业务实现不变，完整通过；对最新代码再次运行也完整通过。文件丢失的具体外部原因无法判断。

验证入口：后端运行 `venv/bin/python -m unittest discover -s tests -p 'test_*.py' -q`；前端运行 `npm run test:coverage`、`npm run lint`、`npm run verify:build`、`npm run test:e2e`，真实接口使用项目 `scripts/real-api-e2e.mjs` 的临时独立产物目录副本；运维运行 `python3 -m unittest discover -s deploy/tests -p 'test_*.py' -q`；架构运行 `venv/bin/python architecture_check.py`。

日志：[后端](/tmp/invest-audit-round4-backend-final.log)、[前端](/tmp/invest-audit-round4-frontend-final.log)、[构建](/tmp/invest-audit-round4-build-final.log)、[真实浏览器](/tmp/invest-audit-round4-real-browser-final.log)、[模拟浏览器](/tmp/invest-audit-round4-mock-browser-final.log)。补充证据：[操作身份升级](/tmp/invest-audit-round4-operation-upgrade-probe.log)、[升级与日期迁移](/tmp/invest-audit-round4-upgrade-and-dates-probe.log)、[旧刷新交错](/tmp/invest-audit-round4-intent-probe.log)、[旧快照备份](/tmp/invest-audit-round4-legacy-backup-probe.log)。这些日志是本机临时产物，不是生产证据。

**无法判断**：真实 PostgreSQL 的并发、MVCC、锁等待和 schema 10 迁移；真实容器备份恢复；线上 Nginx 响应头；原生 iOS/Android 生命周期；生产负载、数据规模、告警送达和灾备恢复时长。本机未配置 `INVEST_TEST_POSTGRES_URL`，也无 Docker/Podman/PostgreSQL/psql。已有 [CI 配置](/Users/bytedance/Desktop/invest-app/.github/workflows/ci.yml)，仍需取得实际成功记录及恢复演练结果。

## 2. 架构还原

当前是**模块化单体，写入用例和只读查询分开，使用直接 SQL 和少量数据库适配**。没有需要引入微服务、消息队列或通用 Repository 才能解决的问题。

| 模块 | 当前职责 | 证据 |
|---|---|---|
| React / Capacitor、app、pages | 会话、身份、导航、页面布局和跨功能装配 | [App](/Users/bytedance/Desktop/invest-app/frontend/src/App.jsx)、[useSession](/Users/bytedance/Desktop/invest-app/frontend/src/app/useSession.js) |
| features / operations | 功能数据、表单、展示、提交；操作键与未知结果持久化 | [features](/Users/bytedance/Desktop/invest-app/frontend/src/features)、[operationStore](/Users/bytedance/Desktop/invest-app/frontend/src/operations/operationStore.js) |
| FastAPI routers | HTTP 输入、认证依赖、调用用例和响应 | [main 路由装配](/Users/bytedance/Desktop/invest-app/backend/main.py)、[账户路由](/Users/bytedance/Desktop/invest-app/backend/routers/accounts.py) |
| application | 授权、业务编排、财务命令、恢复和快照协调 | [commands](/Users/bytedance/Desktop/invest-app/backend/application/commands.py)、[ledger](/Users/bytedance/Desktop/invest-app/backend/application/ledger.py)、[backup](/Users/bytedance/Desktop/invest-app/backend/application/backup.py) |
| domain | Decimal、日期、记账、估值、账户不变量、持久化记录约束和历史证明 | [money](/Users/bytedance/Desktop/invest-app/backend/domain/money.py)、[reconciliation](/Users/bytedance/Desktop/invest-app/backend/domain/reconciliation.py)、[persisted_records](/Users/bytedance/Desktop/invest-app/backend/domain/persisted_records.py) |
| queries / infrastructure | 报表、分页、一致性读取；连接、事务、锁、SQL 持久化 | [finance](/Users/bytedance/Desktop/invest-app/backend/queries/finance.py)、[database](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py)、[read_models](/Users/bytedance/Desktop/invest-app/backend/infrastructure/read_models.py) |
| migrations / integrations / jobs | 增量结构版本、外部行情、定期快照及留存维护 | [schema](/Users/bytedance/Desktop/invest-app/backend/migrations/schema.py)、[market_data](/Users/bytedance/Desktop/invest-app/backend/application/market_data.py)、[scheduler](/Users/bytedance/Desktop/invest-app/backend/snapshot_scheduler.py) |

主要链路：

```text
页面操作 → feature action → API 操作键/身份范围
→ 认证路由 → 财务命令 → 家庭写锁 + 同一数据库事务
→ 领域校验 + 流水/交易 + 账户/持仓状态
→ 显式审计事实 + 受影响成员/家庭快照 + 幂等终态
→ 提交 → 前端确认写入成功 → 刷新受影响资源

GET → 查询用例 → 一致性读事务 → 查询/领域估值 → API 输出

恢复 → 规范化及验证 → 保存恢复前副本 → 获取家庭写锁
→ 复核账本指纹 → 替换财务数据和映射 ID → 审计/快照 → 原子提交
```

财务事实的分工是清楚的：`transactions` 承担收支、转账双腿、期初和调整；`investment_trades` 承担买卖及结算；账户余额和持仓是当前状态；`snapshots` 是按日派生估值；目标记录只记录进度，不冻结或划拨资金。[财务边界文档](/Users/bytedance/Desktop/invest-app/docs/architecture.md)、[投资交易](/Users/bytedance/Desktop/invest-app/backend/application/investing.py)、[目标记录](/Users/bytedance/Desktop/invest-app/backend/application/goals.py:290)。

依赖总体向下：HTTP → application → domain / queries / infrastructure / integrations；纯领域不依赖 FastAPI 或数据库。应用层仍直接写 SQL，在当前规模下可接受。Docker Compose 是完整主部署，Vercel 保留无状态 API 入口；这只是已核对的配置设计，不代表已经确认线上采用哪一套。[部署说明](/Users/bytedance/Desktop/invest-app/DEPLOYMENT.md)。

## 3. 做得合理的地方

| 架构点 | 具体证据 | 带来的价值 |
|---|---|---|
| 外层财务事务拥有连接，内部用例不自行提交 | [事务执行边界](/Users/bytedance/Desktop/invest-app/backend/application/commands.py:119)、[family_write_connection](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py:108) | 事实、余额、审计、快照和幂等结果统一回滚；无需借助吞掉 commit 的连接包装维持原子性。 |
| 家庭写入串行协调，一致性读取有明确隔离级别 | [家庭锁及读事务](/Users/bytedance/Desktop/invest-app/backend/infrastructure/database.py:93)、[并发行为测试](/Users/bytedance/Desktop/invest-app/backend/tests/concurrency_cases.py) | 在家庭应用规模下以简单模型控制写竞态；不必提前做复杂细粒度锁。PG 实际效果仍需验证。 |
| 权限和显示范围具备独立检查 | [缺身份拒绝、账户访问规则](/Users/bytedance/Desktop/invest-app/backend/tenancy.py)、[成员管理规则](/Users/bytedance/Desktop/invest-app/backend/application/family.py) | 不把 personal 视图过滤当作全部授权；owner/admin/member 的管理边界有专门代码。 |
| 金额精度和业务日期都有领域入口 | [money](/Users/bytedance/Desktop/invest-app/backend/domain/money.py)、[dates](/Users/bytedance/Desktop/invest-app/backend/domain/dates.py) | 计算保持 Decimal，金额/价格/数量/汇率精度明确；新日期输入和语义比较一致。 |
| 恢复预校验开始复用业务规则 | [持久化记录规则](/Users/bytedance/Desktop/invest-app/backend/domain/persisted_records.py)、[恢复重建校验](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:611) | 无效备份在破坏性步骤之前被拒绝；查询与恢复不再维护两套余额求和公式。 |
| 历史期初证据独立于当前差额 | [account_history](/Users/bytedance/Desktop/invest-app/backend/domain/reconciliation.py:11) | 缺失历史不会因做过调整或差额碰巧为零被伪装成有可靠期初。R2 是额外的流水应用一致性缺口。 |
| 行情网络阶段不占写事务 | [并发抓取与条件落库](/Users/bytedance/Desktop/invest-app/backend/application/market_data.py:21) | 外部行情慢或失败时减少对家庭资金写入的影响。 |
| 幂等明细清理保留防重终态 | [清理任务](/Users/bytedance/Desktop/invest-app/backend/jobs/financial_command_retention.py:51) | 降低敏感响应长期留存，同时避免删键后旧请求重新执行。 |
| 架构约束与行为测试相互补充 | [AST 检查](/Users/bytedance/Desktop/invest-app/backend/architecture_check.py)、[跨流程测试](/Users/bytedance/Desktop/invest-app/backend/tests/test_cross_workflows.py)、[真实接口浏览器](/Users/bytedance/Desktop/invest-app/frontend/e2e/real-api.spec.js) | 不再仅依靠“新逻辑不要放进大文件”的文档约定；也不把文件行数当作架构质量。 |
| 可观测性与部署边界已有落点 | [请求 ID、耗时和失败日志](/Users/bytedance/Desktop/invest-app/backend/main.py)、[调度状态](/Users/bytedance/Desktop/invest-app/backend/snapshot_scheduler.py)、[部署文档](/Users/bytedance/Desktop/invest-app/DEPLOYMENT.md) | 有助于定位请求和后台任务失败；线上采集、告警及恢复能力仍待实际运行证据。 |

## 4. 问题与风险清单

| 优先级 | 问题 | 具体证据 | 影响 | 建议方案 | 改造成本 |
|---|---|---|---|---|---|
| **P1 / R1，真实兼容缺陷** | scope 加入操作身份和命令指纹，但旧持久化意图没有升级路径 | [新 identity](/Users/bytedance/Desktop/invest-app/frontend/src/operations/operationStore.js:82)、[严格匹配后创建新键](/Users/bytedance/Desktop/invest-app/frontend/src/operations/operationStore.js:178)、[新指纹](/Users/bytedance/Desktop/invest-app/backend/application/commands.py:250)、[旧键冲突](/Users/bytedance/Desktop/invest-app/backend/application/commands.py:39) | 已提交但响应丢失的旧操作，升级后重试可换新键，重复记账；旧键本身也无法按新指纹正常重放 | 版本化操作/指纹协议；识别旧意图，先用原键确认终态；旧结果未知时保持原键并阻止自动创建新意图 | 1–2 天，含兼容与行为回归 |
| **P1 / R2，真实历史校验缺陷** | schema 10 只修日期，未识别旧日期错误已导致的 balance_applied 异常 | [迁移只更新日期](/Users/bytedance/Desktop/invest-app/backend/migrations/schema.py:761)、[求和跳过未应用流水](/Users/bytedance/Desktop/invest-app/backend/domain/reconciliation.py:57) | 历史支出漏扣仍存在，却返回 matches=true、reconstructable=true、limitation=null；新恢复校验也使用相同求和规则 | 增加只读语义扫描和异常状态；保留原记录、余额及证据，通过明确核对/更正流程处理，禁止批量自动重算 | 1–2 天完成检测和回归；真实数据处置另计 |
| **P2 / R3，真实异步缺陷** | 后续状态提交跳过仍在刷新中的旧 intent，旧刷新结束后没有补偿退休 | [pending 覆盖刷新](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:69)、[supersede 跳过 pending](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:126)、[终态拦截](/Users/bytedance/Desktop/invest-app/frontend/src/features/shared/useSubmission.js:33) | 完成已提交 → 旧刷新延迟 → 切月恢复 → 旧刷新结束 → 再完成，第三次 PATCH 不发送 | 按实体保留最新提交顺序或锁存 superseded 证据，待旧刷新结束安全退休；未知写入保持受保护 | 0.5–1 天 |
| **P2 / R4，真实恢复兼容缺陷** | 日期归一后的重复快照，迁移会合并，旧备份恢复却直接拒绝 | [迁移去重](/Users/bytedance/Desktop/invest-app/backend/migrations/schema.py:767)、[备份仅转日期](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:71)、[重复检查](/Users/bytedance/Desktop/invest-app/backend/application/backup.py:657) | 同一旧账本可以就地迁移，但其迁移前 JSON 备份无法预览恢复 | 为旧格式转换引起的碰撞共享确定性选择规则，预览披露处理结果；保留原备份，其他非法重复仍拒绝 | 0.5–1 天 |

工作量为熟悉项目的单人估算，存在重叠，不宜机械相加。R1 的实际发布风险取决于旧版本是否曾运行并留下未知操作；R2 取决于是否存在旧日期误判记录。两者都已复现条件成立时的实际错误，真实数据规模尚未确认。

**潜在风险／验证缺口**：PG 与 Docker 恢复没有本轮实跑证据，不能得出“生产已验收”或“必然失败”。应将对应 CI 和演练结果作为发布依据。

**可选优化**：随功能修改继续下沉 App 装配和局部样式；按实际锁等待数据决定是否细化家庭锁。当前没有证据支持因为文件长、惰性 import 或使用直接 SQL 就再发起全面重构。

## 5. 重点问题深入分析

### R1：操作身份升级破坏旧未知结果的防重连续性

**1. 当前实现。** 新前端的 identity 从旧格式“用户:家庭”变成“用户:家庭:scope”，但存储仍使用 `investPendingOperations:v1`，恢复操作时只接受 identity 完全相等。后端指纹新增 scope，却没有指纹版本或旧版匹配路径。

**2. 为什么存在问题。** 幂等键和未知状态是跨页面、跨发布保留的业务协议，不能只考虑同一版本内的重试。旧条目仍在存储中，并不意味着新代码能识别；新键在后端代表另一笔合法命令，资金层无法推断它其实是旧操作的重试。把原键返回内容冲突，也没有完成旧终态确认。

**3. 已复现的场景。**

```text
旧版：100 元账户支出 10 元，数据库已提交，但客户端丢失响应。
浏览器保留 identity="1:1"、key="old-unknown-operation"、status="unknown"。

升级后：当前 identity="1:1:family"。
相同 method/path/payload 经 resolveOperation → 生成新 UUID，未复用旧键。

旧格式指纹记录 + 当前服务端：原键重试 → 409 COMMAND_CONTENT_CONFLICT。
按前端新生成的键提交同一支出 → 再记一次，余额 90 → 80。
```

前端结果来自实际 operationStore，使用隔离的内存 localStorage；后端结果来自真实命令和临时 SQLite，旧指纹按上一实现的序列化规则构造。两部分分别执行，**未宣称已经做过整套旧前端到新前端的浏览器升级演练**。如果旧版本从未被使用、没有旧持久化意图，则不会触发这个场景。

**4. 推荐目标结构。** 操作存储和服务端指纹都有显式版本；业务意图 ID 在跨版本确认完成之前保持稳定。显示 scope 可以变化，但不能因此跳过同一用户/家庭的旧未知操作。保留新版本的 scope 隔离。

**5. 最小改造。** 在为同一载荷创建新键之前识别旧 identity 格式，使用原键调用已有 [最小命令回执](/Users/bytedance/Desktop/invest-app/backend/queries/commands.py)。已提交/已过期只能确认并刷新，不能再写；unknown 继续保留原键，不能把“查不到”当作“没有执行”。后端提供受用户和家庭约束的旧指纹兼容确认，禁止直接向另一 scope 重放敏感明细。无法可靠恢复旧 scope 时，应提示核对并保留原意图，不能擅自补 scope 后换新键。

**6. 完整改造。** 新增指纹版本及操作存储版本，用兼容适配处理旧协议。把“确认旧操作”和“主动创建新意图”作为不同状态转换；覆盖旧响应仍在、已过期、恢复后失效和仍在事务中的状态。数据库结构变化追加新迁移，不改写已应用版本；发布说明写清兼容窗口和回退行为，不以清空 localStorage/financial_commands 解决问题。

**7. 风险与验证。** 最重要的是兼容时不能放宽跨用户、家庭或 scope 的权限。增加旧浏览器存储 + 旧指纹数据库的升级测试，覆盖提交成功丢响应、未提交、事务未完成、过期及恢复失效；断言重复重试只有一条业务事实、一份资金变化和一次业务审计。至少完成一次真实浏览器升级回归，并在 PG 验证等待提交的原键重试。所有测试使用隔离账本。

### R2：规范日期后，原有漏记资金仍被当作正常账本

**1. 当前实现。** schema 10 将紧凑日期转为标准日期，保持金额、余额和 balance_applied 不变。当前重建函数直接跳过 balance_applied=0 的流水；期初证明只验证期初事实是否成立。最新恢复校验复用这一结果。

**2. 为什么存在问题。** 不自动改真实资金是正确的，但“保持资金不变”和“发现资金可能已经不一致”是两件事。旧错误恰好会把应影响余额的支出写成 balance_applied=0，重建再次相信这个标记，就会把同一错误同时用于实际值和期望值，差额自然为零。

**3. 已复现的场景。** 在独立 SQLite 中构造旧版允许的紧凑建账日期，使用旧字符串比较规则生成支出，再运行当前迁移与核对：

```text
期初：20260901，100 元。
旧版正常日期支出：2026-09-28，10 元，balance_applied=0。
迁移后：建账日规范为 2026-09-01；余额仍 100；支出标记仍为 0。
当前核对：expected=100，actual=100，matches=true，
          reconstructable=true，history.status=complete，limitation=null。
```

按明确日期语义，这笔普通支出应作用于当前余额，期望为 90。复现只在生成旧状态时模拟旧比较规则，迁移和核对使用当前真实实现；没有修改用户账本。已有 [迁移测试](/Users/bytedance/Desktop/invest-app/backend/tests/test_architecture_regressions.py:210) 验证的是“先迁移，再新增支出”，尚未覆盖“迁移前已经漏扣”。

**4. 推荐目标结构。** 分开表达期初证据完整性、流水应用标记一致性、当前求和差额。保留 matches 的算术含义，但在日期语义与应用标记矛盾时返回明确的异常清单和核对限制，不能继续给出无限制的可重建结论。

**5. 最小改造。** 增加只读诊断：账户、交易 ID、原始/规范日期、balance_applied、按既有业务规则预期的应用状态、涉及金额。覆盖已迁移账本，不能只搜索目前仍是紧凑格式的行。跳过已撤销记录，并保留真正建账前补录不影响余额的语义。发现异常只报告，不自动修改标记或余额。

**6. 完整改造。** 将诊断规则放入领域核对模块，由查询、迁移预检和恢复预览复用。迁移/修复产物保留原始证据；对确认需要更正的账本，通过具备预期余额检查、原记录引用、幂等和审计的更正流程处理。不能只翻转 balance_applied 再额外补一笔相同金额调整，避免双重影响。schema 10 已使用时追加后续迁移或维护入口，不能要求重新执行整个旧迁移链。

**7. 风险与验证。** 最大风险是把正常的建账前补录误判为漏记，或在修复时二次扣款。测试覆盖建账前/同日/之后、紧凑日期在账户或流水任一侧、收入/支出、撤销、普通/负债/投资现金、合法历史不完整账户。断言扫描和预览绝不改资金；确认后的修复可重试、失败全回滚，并满足导出恢复往返一致。资金如何处置需要账本持有人核对，不由迁移脚本猜测。

### R3：旧写入已提交，但延迟刷新阻止退休旧意图

实际交错为：9 月完成目标的 PATCH 成功，随后 GET 尚未返回；切到 10 月并成功读取 completed；恢复为 active 的 PATCH 和刷新成功；9 月旧 GET 随后返回，由资源代次检查正确丢弃；再次完成目标。

补充 Hook 用例最后预期 3 次 PATCH，实际只有 2 次。后续 active 提交执行 supersede 时，旧 completed 的 pending 仍为 true，因此跳过；旧刷新结束后，没有记录“已有更晚的实体提交”这一事实，completed 仍以终态留在 Map 中。现有串行失败用例和真实浏览器用例不包含这个时序。

最小修复是像 readConfirmed 一样锁存明确的 superseded 证据，待 pending 结束后消费；完整方案是按“身份 + stateKey”保存最新已提交的顺序号，将写入 pending 与后续视图刷新 pending 区分。不得用任意 GET 释放 unknown/processing 的写入，也不得撤销预算按月确认规则。增加 deferred 控制的相反顺序用例、身份切换、重复点击和未知写入回归，再补一次真实浏览器的延迟 GET 场景。

### R4：数据库迁移和旧 JSON 恢复采用不同的快照碰撞规则

从临时旧结构数据库实际导出，包含同一家庭汇总的 `2026-10-01` 和 `20261001`，二者在旧文本唯一约束下可以并存。当前预览先规范为同一天，随后返回 `422 备份无效：snapshots 存在重复记录`；同一数据库运行 schema 10 会按 created_at/id 留下一个快照，迁移后再导出则能预览通过。

建议抽出只作用于“旧日期转换引起的碰撞”的确定性处理规则，数据库迁移和备份规范化共同调用。预览展示原记录、保留记录及理由；不要把资产数值相加，不处理流水/交易去重，不放宽本来就非法的重复 ID 或同格式重复。保留原备份，测试不同成员不合并、同时间按 ID 选择、跨日期保留和反复规范化结果稳定；SQLite 与 PG 均执行恢复往返测试。

## 6. 推荐的目标架构

保留当前模块，完善已有协议和规则即可。以下是职责目标，不要求为每一项再创建一个空目录：

```text
backend/
├── routers/                 HTTP、认证依赖、协议响应
├── application/
│   ├── commands.py          原子写入、版本化幂等确认和准备产物生命周期
│   ├── accounts.py          账户与经过确认的核对/更正用例
│   ├── ledger.py            流水、导入、撤销
│   ├── investing.py         买卖、持仓与结算现金
│   ├── budgets.py           预算用例
│   ├── goals.py             目标及进度，保持不划拨资金
│   └── backup.py            兼容适配、预览、恢复事务编排
├── domain/
│   ├── dates.py             唯一日期契约
│   ├── money.py             Decimal 和舍入边界
│   ├── reconciliation.py   期初证据、应用标记诊断、状态重建
│   └── persisted_records.py 恢复前的持久化业务约束
├── queries/                 一致性读模型、核对报告、最小命令回执
├── infrastructure/          连接、锁、持久化及恢复 ID 映射
├── migrations/              冻结旧版本，追加兼容迁移
├── integrations/            外部行情
├── jobs/                    可观察的维护入口
└── tests/                   当前行为 + 历史版本升级/恢复样本

frontend/src/
├── app/                     会话、路由和资源装配
├── features/                各域查询、表单、提交与展示
│   └── shared/              提交终态、读取确认、实体意图退休
├── operations/              版本化未知操作存储及兼容确认
├── pages/                   页面布局
└── components/              通用交互组件
```

核心边界应明确为：新日期唯一格式；旧格式只在兼容入口解释；财务写入统一返回显式结果和影响范围；旧未知操作只能先确认，不能自动换键；余额求和与数据可信程度分开；快照是派生状态，其兼容归并不影响资金事实。

状态流继续采用“写入提交 → 本地提交终态 → 刷新视图”。刷新失败不能把已提交操作恢复成可重试写入；后续明确的实体状态提交可以退休旧已提交意图，即使旧视图刷新稍后才结束。身份和家庭变化仍必须隔离数据、草稿、回调与操作键。

## 7. 分阶段改造计划

| 阶段 | 改动范围 | 预期收益 | 风险 | 验证方法 | 大致工作量 |
|---|---|---|---|---|---|
| 第一阶段：立即 | 固化本报告四个失败场景为行为测试 | 防止只修已有成功路径 | 夹具误用当前规则生成“旧数据” | 使用明确旧版本格式和可控时序；验证资金、请求次数及恢复结果 | 0.5 天 |
| 第一阶段：立即 | 增加 R2 只读扫描和查询限制提示 | 先确定存量影响，避免假正常 | 正常历史补录被误报 | 账户前后数据摘要不变，正反例覆盖 | 0.5–1 天 |
| 第一阶段：立即 | 在已有旧运行状态的环境中，将 R1 兼容修复设为升级前置项 | 避免升级重试重复记账 | 无依据清理未知操作 | 原键保持、终态回执和权限用例 | 纳入第二阶段 R1 工作量 |
| 第二阶段：核心边界 | 完成版本化幂等/操作存储兼容，解决 R1 | 发布过程中保持一次业务意图一次资金影响 | 误放宽旧结果读取范围 | SQLite + PG 升级矩阵、丢响应和并发原键重试 | 1–2 天 |
| 第二阶段：核心边界 | 完成 R2 共享诊断和可追溯更正入口 | 查询、恢复、迁移检查一致 | 双重调整、误修正常历史 | 扫描只读；更正原子、可回滚、可重试 | 1–2 天，人工核对另计 |
| 第二阶段：核心边界 | 完成 R3 实体退休和 R4 备份快照兼容 | 修复交互失效及旧备份无法恢复 | 清理未知写入或合并错误快照 | 延迟 GET 浏览器回归、成员隔离及恢复往返 | 合计 1–2 天 |
| 第三阶段：工程治理 | 取得 PG CI、schema 10 升级、容器恢复演练结果；保留历史版本测试样本 | 将本地正确性扩展到生产运行方式 | 环境差异及测试数据污染 | 隔离测试实例、恢复后账本校验、实际告警验证 | 环境就绪后 1–2 天 |
| 第三阶段：按需 | 随业务需求整理局部 App/样式，观察锁等待和快照耗时 | 持续维护、依据数据优化 | 纯搬迁增加回归面 | 只覆盖被改功能与受影响链路 | 随迭代安排，无需专项大改 |

每个改动保持可运行并独立验证。涉及存量记录时，先保留备份和只读影响清单，再执行明确授权的兼容/更正；不能删除、重置或自动重算真实财务数据。报告不要求修改既有目标产品模型。

## 8. 最终建议

**未来 6～12 个月能否继续支撑？** 按当前家庭财务产品范围和小规模负载，可以继续演进；前提是补齐上述兼容缺口并完成 PG/恢复验收。没有实际用户数、数据量、峰值并发或路线图，无法承诺某个容量上限或任意新业务都无需调整。

**最优先的三件事：**

1. 修复 R1，保证旧未知操作跨版本仍沿用原业务意图，避免重复资金写入。
2. 完成 R2 的只读诊断与限制表达，确认是否存在历史漏扣，再按可追溯流程处理。
3. 将 R3/R4 的交错与旧备份场景纳入行为回归并修复；把真实 PG 和恢复演练作为发布验收项。

**应保持不动：** 模块化单体、家庭事务协调、Decimal 规则、显式审计、身份与显示范围的区分、增量迁移、目标仅记录进度的语义。修改可以发生在这些边界内部，不应推翻已验证的设计。

**现在不必做：** 微服务、消息队列、通用事件总线、通用 Repository/DI 容器、为行数而拆文件、全量 CSS 搬迁、没有负载证据就改细粒度锁，以及把目标进度直接改为真实资金预留。

**如果只能做一次架构优化：** 选择“财务持久化协议的跨版本兼容闭环”，先落地 R1 的原键确认与版本适配，再将旧日期/旧备份纳入同一升级验收。当前模块边界已经可用，最需要防止的是一笔旧操作或旧数据在新代码中被赋予另一种含义。
