运行后端回归测试（在 `backend/` 目录）：

```sh
python -m unittest discover -s tests -p 'test_*.py' -v
```

`test_cross_workflows.py` 对 SQLite 与 PostgreSQL 运行同一组跨流程用例：

- HTTP 记账携带 `Idempotency-Key`，覆盖正常写入、重放、内容冲突与并发重试。
- 收入、全额转账、账户归档后更正流水，校验失败操作不改变余额、历史或重试记录。
- 不同实体 ID 碰撞时新增审计前值为空，账户间移动与删除后审计仍可查询。
- 成员、分类、预算、目标、持仓与交易的新 ID 返回，以及备份恢复。
- PostgreSQL 屏障并发覆盖账户归属修改与流水更正，以及转账、买入、余额核对和
  撤销之间的统一锁顺序与投资现金非负约束。
- 汇总读取与真实买卖交错时，总资产仍来自完整的交易前或交易后快照。
- `restore_cases.py` 混入双数据库流程：跨家庭 ID、分类父级、审计与转账引用映射、
  恢复后导入去重、文件失败/插入失败回滚、准备期间竞争、恢复同键重放。
- PostgreSQL 专属恢复并发：家庭 A 恢复暂停时，家庭 B 可恢复、MVCC 查询可读旧快照、
  A 的新写入须排队；后续序列分配不冲突。
- `concurrency_cases.py` 在 SQLite/PostgreSQL 强制覆盖核对、转账、买入各自先获锁，
  验证现金 400（三成功）或 500（核对冲突），检查流水、持仓、交易、审计及原键重放。
- `history_cases.py` 区分余额差异与历史完整性，覆盖零/负数/负债/投资期初、
  缺失历史后的余额调整、JSON v7 缺元数据兼容及 v8 非法基线拒绝。
- schema 10 日期回归覆盖 API 严格 ISO、历史 `YYYYMMDD` 迁移、歧义格式阻断、
  快照日期碰撞收敛、余额生效日和旧备份预览/恢复。
- schema 11 回归覆盖旧/新命令指纹确认、v1/v2 浏览器操作存储、日期应用语义扫描、
  受控更正回滚，以及迁移与旧 JSON 共用的快照碰撞选择结果。
- schema 12 回归覆盖“购物”到“服饰”的幂等迁移及既有交易引用保留。
- `upgrade_cases.py` 将真实升级场景混入双数据库测试：移除旧命令表的版本字段后迁移、
  未提交事务的只读收据与等待原键重试、迁移前已漏扣的收入/支出/撤销/负债/投资现金、
  更正并发及失败全事务回滚、更正审计跨家庭和重复恢复、schema 10/11 与 JSON 的
  快照选择一致性；不使用 PostgreSQL 模拟适配器替代这些用例。
- 恢复审计同时覆盖同家庭、跨家庭、再次导出恢复；核对目标、分配、预算、
  交易前后账户/持仓主键和外键，以及删除实体的历史命名空间。

`test_domain_rules.py` 无需数据库即可验证 Decimal 余额规则、上海日历边界、
调度日期和领域层禁止 SQL 的架构负例；`test_architecture_regressions.py` 检查
迁移、运行状态、依赖方向、连接生命周期和生产边界。
固定月份场景使用 `tests.clock.freeze_business_time`（默认 2026-09-28 上海时间），
只替换业务时钟。跨月创建/查询在共享数据库用例中另行验证，不依赖运行当天月份。

PostgreSQL 用例默认跳过。提供专用测试实例即可运行；连接用户需要建库权限，每个用例自动创建并清理独立的 `invest_test_*` 数据库：

```sh
INVEST_TEST_POSTGRES_URL=postgresql://test_user:test_password@127.0.0.1:55432/postgres \
  venv/bin/python -m unittest tests.test_cross_workflows -v
```

此变量独立于应用的 `DATABASE_URL`。不要配置生产实例。
审计 JSON 中的金额保留数据库精度：PostgreSQL Decimal 会编码为十进制字符串，
SQLite 可能为 JSON 数字。共享用例按 Decimal 比较金额，实体 ID 仍按原类型严格比较，
避免为了统一测试表现而把审计精确金额转成浮点数。

前端的真实浏览器链路使用独立临时数据库，入口见
`frontend/e2e/real-api.spec.js`，在 `frontend/` 执行 `npm run test:e2e:real`；
它与默认模拟 API 的三视口冒烟测试分开运行，自动启动和清理测试环境。
六类真实流程共十八项：财务全流程（含快照兼容报告）、表单提交后读取故障、
目标完成/恢复循环、旧月份和无关 GET 延迟交错、历史漏扣诊断及人工更正、
嵌套审计详情响应式展示。测试夹具只允许修改运行器创建的临时 SQLite 目录；
目标循环要求完成后的读取失败或延迟时直接切换月份，仍可继续恢复 → 再次完成。

运维脚本的故障注入测试与真实 Docker 演练分别在根目录执行：

```sh
python3 -m unittest discover -s deploy/tests -p 'test_*.py' -v
backend/venv/bin/python deploy/tests/postgres_backup_smoke.py
```

第二条需要 Docker Compose，创建专用 Compose 项目和 PostgreSQL 数据库，不使用
项目 `.env` 或既有账本；结果写入 `deploy/test-results/`。CI 分别执行后端 PostgreSQL、
前端测试、真实浏览器和备份演练四个作业。未运行 CI 不能当作这些环境已通过验证。
