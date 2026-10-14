# schema 11 升级兼容与账本治理

## 范围

本次升级解决四类跨版本问题：

1. 旧浏览器未知操作和旧服务端指纹不能丢失幂等身份；
2. schema 10 日期规范化后必须识别历史 `balance_applied` 语义异常；
3. 目标状态写入已提交但旧视图仍刷新时，后续合法状态不能被旧 intent 阻塞；
4. 旧数据库迁移和旧 JSON 恢复采用同一快照日期碰撞规则。

升级不自动重算真实余额，不新增替代流水，不删除幂等墓碑，也不改写已登记的
schema 10。数据库变化仅追加 schema 11。

## 发布顺序

1. 停止写入并创建 PostgreSQL 整库备份，同时下载家庭 JSON 备份。
2. 运行 `backend/venv/bin/python backend/migrate.py`。
3. 确认 `/healthz` 返回 schema 11。
4. 先部署兼容后端，再部署前端 Web / Capacitor 包。
5. 运行后端、真实浏览器和独立 PostgreSQL 回归。
6. 查看 `/accounts/reconciliation`，由账本持有人核对 `application.issues`。

不得用清空 LocalStorage、删除 `financial_commands` 或为同一内容创建新键来处理
升级问题。

## 幂等协议

### 服务端

`financial_commands` 新增：

- `fingerprint_version`：`0` 表示升级前算法未知，`1` 表示旧无 scope 指纹，
  `2` 表示当前带 scope 指纹；
- `data_scope`：新命令明确保存 `personal` 或 `family`。

新命令统一写 v2。存量记录迁移为 v0，因为升级前数据库无法可靠判断它使用旧算法
还是已经带 scope 的过渡算法。v0 可用两种算法确认内容，但 scope 不可证明，因此：

- `committed/expired` 只确认已处理，不返回旧响应正文；
- `invalidated` 只返回失效终态；
- `processing` 保留原键继续确认；
- 内容无法匹配时返回 `COMMAND_CONTENT_CONFLICT`；
- v2 只有请求 scope 与保存 scope 相同时才允许正常重放。

`GET /commands/{id}` 继续只按当前用户和家庭查询；v2 的其他 scope 返回 `unknown`，
不泄露终态或结果。

### 前端

新操作写入 `investPendingOperations:v2`。读取时同时加载 v1：

- v1 identity 已含 scope：沿用原 ID 和已知 scope；
- v1 identity 不含 scope：先用原 ID 查询命令收据，不猜测 scope；
- 已提交、过期、失效只结束或阻断，不能再次发送写请求；
- `processing/unknown` 显示核对提示并保留原 ID；
- 不同用户或家庭不会匹配同一旧记录。

回退旧前端可能忽略 v2 未知操作并生成新键，因此有 v2 待确认记录时禁止单独回退
前端。紧急回退应先停止写入，并保留新前端的 operationStore 兼容层。

## 日期应用诊断与受控更正

`/accounts/reconciliation` 分别返回：

- `history`：期初证据是否完整；
- `application`：流水实际 `balance_applied` 与建账日期/业务类型是否一致；
- `matches`：按当前保存标记求和是否等于账户状态；
- `healthy`：上述三项全部成立。

每个应用异常包含流水 ID、发生日期、实际/预期标记、方向、金额、撤销状态和需要的
余额差额。已撤销记录不影响当前余额；真正建账前且标记为 0 的补录保持合法。

扫描和恢复预览只读；日期迁移不改变余额或流水应用标记。前端可从“账本 → 账本诊断”
或账户详情的“查看账本诊断”进入。异常流水显示“余额应用待核对”，选择具体流水后
会展示原币余额变化，填写原因、勾选确认后才提交。结果未知时保留原草稿和操作键重试。
确需更正时，由持有人逐笔确认后调用：

```http
PATCH /transactions/{transaction_id}/application
Idempotency-Key: <stable-operation-id>
Content-Type: application/json

{
  "expected_account_balance": "100.00",
  "expected_balance_applied": false,
  "reason": "核对旧日期比较导致的漏扣"
}
```

服务端重新锁定账户和原流水，校验预期余额、原标记和日期语义，再在一个事务内修改
标记、账户余额、审计、快照和幂等结果。任一步失败全部回滚。同键重试不会二次影响
资金。不得批量自动调用此接口。

账本持有人仍需确认：

- 异常流水是否确为历史漏扣/漏加，而非有意的建账前补录；
- 当时余额是否曾通过其他方式人工修正；
- 负债账户和投资现金的方向是否符合真实对账单；
- 更正后的账户余额是否与银行、券商或钱包账单一致。

## 快照兼容

旧 `YYYYMMDD` 转换为 `YYYY-MM-DD` 后，仅在以下条件全部成立时择一：

- 相同家庭；
- 相同成员，家庭汇总的 `member_id` 同为 NULL；
- 原始日期字符串不同；
- 规范化后日期相同；
- ID 本身不重复。

按 `created_at`、ID 依次选择最新记录，其他记录只在规范化副本或迁移事务中舍弃，
资产值不相加。恢复预览通过 `snapshot_compatibility` 返回保留 ID、舍弃 ID、原日期、
时间和原因。原始 JSON 文件不修改。

恢复弹窗在确认前展示以上报告，确认文案包含快照兼容说明。不同成员和不同日期
各自保留；同格式重复和重复 ID 继续返回无效备份。

## 2026-10-06 架构审查修复

- 清理已确认终态时同时使用操作 ID 和原存储版本，v1/v2 均不残留；不清除未知操作。
- 目标状态在写入确认时推进顺序，已成功的相关 GET 可释放操作，不等待无关页面刷新。
- 更正审计 v1 明确登记 `{transaction, account}`，恢复后仍能关联实体并展示余额应用
  标记和账户余额变化。已经被旧恢复流程封装为 historical 的载荷继续保留原文，
  不猜测其 ID 归属。
- 账本查询移入 `queries/ledger.py`，CSV 响应移入 `application/ledger_export.py`；
  HTTP 财务命令入口名称不变，拆分不改变已有命令指纹。
- 本轮不新增数据库结构版本、不改写 schema 10/11，不对真实账本执行更正。
  完整验证结果另见本轮交付记录。

## 回退

schema 11 只增加可空/带默认值列，旧后端通常可以读取其余表，但不理解新幂等协议。
安全回退原则：

1. 保留 schema 11，不删除列、不降迁移版本；
2. 保留 `financial_commands` 和两版浏览器操作存储；
3. 停止所有财务写入；
4. 回退前导出命令状态和 `/accounts/reconciliation` 报告；
5. 若必须恢复数据库，使用升级前整库备份，而不是手工改余额或删命令；
6. 恢复后旧操作键保持 `invalidated`，不得重新执行。

## 验证边界

2026-10-06 已在隔离 PostgreSQL 16.10 上执行迁移、等待未提交旧键、MVCC/锁及 JSON
恢复。后端完整回归 249 项通过、1 项为 SQLite 类中不适用的 PostgreSQL 专属场景；
PostgreSQL 41 项全部通过。前端 205 项、三视口真实接口浏览器 18 项、lint 和生产构建
均通过。完整结果见 [七项修复交付记录](architecture-fixes-2026-10-06.md)。

本机无 Docker，尚未执行 Docker Compose 整库备份/恢复演练；运维脚本的 8 项故障
注入测试不能替代该演练。iOS/Android 原生设备也未验证，Chromium 手机视口不代表
原生容器已通过。临时 PostgreSQL 已关闭，没有修改真实账本。
