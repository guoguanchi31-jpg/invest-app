# 架构兼容修复验收（Round 5）

## 范围

本轮针对四个已复现缺陷完成局部架构修复：

| 优先级 | 问题 | 结果 |
| --- | --- | --- |
| P1 | 操作 identity / 指纹升级可能生成新键并重复记账 | 操作存储和服务端指纹均显式版本化；旧范围未知操作只确认、不自动执行 |
| P1 | schema 10 修日期后仍遗漏历史 `balance_applied` 异常 | 核对拆分期初、应用语义和余额一致性；新增受控、幂等、可回滚更正入口 |
| P2 | 目标状态写入已提交但旧 GET 延迟时阻塞后续循环 | 写入等待与刷新等待分离；旧已提交 intent 可被更新状态退休，按钮锁在 PATCH 终态释放 |
| P2 | 数据库迁移与旧 JSON 对快照日期碰撞处理不同 | 共享确定性兼容规则；预览披露保留/舍弃记录，同格式非法重复仍拒绝 |

保持模块化单体、家庭权限、财务方向、历史汇率、恢复事务和现有交互。未读取后改写、
清理或重算真实账本；所有迁移和资金更正测试使用临时隔离数据库。

## 关键实现

### 幂等升级

- schema 11 为 `financial_commands` 增加 `fingerprint_version` 和 `data_scope`。
- 新命令写 v2；升级前无法确定算法的行标记为 v0，可用 v1/v2 算法确认内容，但不返回
  scope 不可证明的敏感响应。
- 前端新写 `investPendingOperations:v2`，同时读取 v1；旧无 scope 操作先用原 ID 查询
  `/commands/{id}`。
- `committed/expired/invalidated` 不重写；`processing/unknown` 保留原 ID 并要求核对。
- 当前 v2 继续按用户、家庭、scope 隔离。

### 日期应用治理

- `domain/reconciliation.py` 输出 `history`、`application`、`matches` 和 `healthy`。
- 异常包含账户、流水 ID、日期、金额、实际/预期标记和余额差额。
- 已撤销异常只作为审计限制，不改当前余额；建账前合法补录保持 `balance_applied=0`。
- `PATCH /transactions/{id}/application` 使用预期余额和预期原标记做乐观锁，在一个
  `financial_command` 中提交标记、余额、审计、快照和幂等结果。
- 迁移、扫描和备份预览均不自动调用更正。

### 目标状态

- submission 区分 `writePending` 与 `refreshPending`。
- 同 `stateKey` 的后续已提交状态可退休仍在刷新中的旧 intent。
- `GoalsPage` 在 PATCH 确认后释放按钮锁，并用操作序号阻止旧 `finally` 清理新锁。
- `unknown/processing`、预算月份确认、双击和身份切换规则保持原样。

### 快照兼容

- 仅合并旧日期转换产生的同家庭、同成员、同日碰撞。
- 按 `created_at`、ID 选择最新记录，不合计任何资产数字。
- `snapshot_compatibility` 在预览和恢复结果中披露选择过程。
- 不同成员、不同日期、重复 ID 和同格式重复不合并。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| 后端 SQLite / 领域 / 迁移 / 恢复 | 237 通过，36 跳过 |
| 前端 Vitest | 191 通过 |
| 前端 lint | 0 warning / 0 error |
| 生产构建 | 通过，14 个产物 |
| Mock Playwright | 33 通过，18 按矩阵跳过 |
| 真实 FastAPI + 浏览器 | 15 通过，0 跳过；桌面、平板、手机 |
| 运维故障注入 | 8 通过 |
| 架构检查 / compileall / diff check | 通过 |
| npm audit / pip check | 0 漏洞 / 无依赖冲突 |

后端跳过项是需要 `INVEST_TEST_POSTGRES_URL` 的真实 PostgreSQL 工作流和一项 PG 专属
MVCC/锁测试。当前机器没有 Docker、PostgreSQL 或 `psql`，因此以下项目未验证：

- PostgreSQL 16 上的 schema 11 实际迁移；
- 未提交旧键等待、advisory lock、MVCC 和双连接并发；
- PostgreSQL JSON 恢复往返；
- Docker 隔离备份恢复演练。

这些项目必须取得独立环境或 CI 的实际成功结果，不能以 SQLite 或模拟测试代替。

## 兼容、回退与人工确认

完整发布顺序、回退限制和 API 示例见
[upgrade-compatibility-2026-10-01.md](upgrade-compatibility-2026-10-01.md)。

真实账本持有人必须逐笔确认 `application.issues`。如果异常金额已经通过其他调整、
银行端冲正或人工修正反映在余额中，不能直接执行应用标记更正。回退不得删除
`financial_commands`、v1/v2 浏览器操作记录或手工降低 schema 版本。
