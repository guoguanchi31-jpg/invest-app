# 渐进式架构改造验收记录

日期：2026-09-29

## 已核实问题

已复现并修复：

- 非负债投资账户可用负期初现金创建。
- 前端请求世代参与业务幂等键，scope 往返可能生成新键。
- `api.js` 向 `127.0.0.1:7777/event` 发送生产调试探针。
- 逐持仓与 SQL 聚合舍入边界不一致。
- 缺少身份时隐式选择管理员。
- router、数据库基础设施和 `App.jsx` 承担过多业务职责。
- 审计推断协议与显式命令结果并存。
- 响应过期后可能被误认为未执行。
- 快照任务 running 状态不可观察，任务锁生命周期不清晰。
- 默认生产构建包含模拟器入口的风险。

已在本轮前修复并保留验证：

- PostgreSQL `NUMERIC` 到业务层保持 `Decimal`。
- 历史汇率固化和非金额编辑不重算。
- 恢复文件按家庭隔离。
- 行情网络请求期间不持有数据库连接。
- 退出、重新登录、scope 和分页请求的旧响应丢弃。
- 目标只记录进度，不占用真实账户资金。

## 最终边界

后端依赖方向：

```text
routers
  -> application
       -> domain
       -> queries
       -> infrastructure
       -> integrations
jobs -> application / infrastructure
migrations -> database schema only
fixtures -> opt-in development data only
```

前端依赖方向：

```text
App shell
  -> feature data hooks
  -> feature actions and form components
  -> shared request/operation lifecycle
  -> api transport
```

`App.jsx` 不直接调用 `fetchJson/postJson/patchJson/deleteJson/downloadFile`。
后端 router 不执行 SQL。AST 架构检查同时验证循环依赖、领域层禁用依赖和财务
用例连接所有权。

## 财务与状态规则

- 非负债投资账户 `cash_available >= 0`；普通账户和负债账户允许原有负值语义。
- 所有资金写入在外层财务命令事务中提交，审计、幂等和当天快照同事务。
- 锁顺序为账户 ID 升序，再锁流水、持仓或交易；预读关联必须锁内复核。
- 估值逐持仓舍入到分，再按账户、成员和家庭汇总。
- operation ID 与界面请求世代分离；结果未知重试复用原键。
- 响应正文到期后保留 `expired` 去重墓碑；恢复后键保持 `invalidated`。
- 恢复前校验投资现金不变量，不以自动清零修复异常。
- 核对 API 只报告差异，不自动修改真实账本。

## 迁移与恢复

- 当前 schema：7。
- 真实旧 SQLite 样本从 v2 升级到 v7，账户、流水、持仓、交易和快照计数不变。
- 同一旧库重复迁移无副作用。
- 全新 SQLite 安装得到 v7、0 个账户、29 个默认分类和 1 个管理员。
- JSON 备份 v6 精确十进制往返、恢复前指纹和恢复回滚均有测试。
- PostgreSQL 运维恢复使用 `psql --single-transaction -v ON_ERROR_STOP=1`。

## 本次执行结果

| 层级 | 结果 |
| --- | --- |
| Python 编译 | 通过 |
| AST 架构检查 | 通过 |
| 后端 unittest | 152 项：141 通过，11 项真实 PostgreSQL 跳过 |
| 前端 Vitest | 103/103 通过 |
| 前端覆盖率 | statements 70.46%，branches 58.93%，functions 66.53%，lines 73.47% |
| 前端 lint | 0 warning / 0 error |
| 生产构建校验 | 通过；无 simulator 入口和 7777 调试端点 |
| 模拟 API Playwright | 桌面/平板/手机共 9/9 通过 |
| 真实 SQLite 浏览器链路 | 1/1 通过 |
| 真实 PostgreSQL | 未执行：本机无 Docker、PostgreSQL 服务/客户端，环境变量未配置 |
| 实际 Nginx 响应头 | 未执行：本机无 Docker/Nginx；静态配置回归通过 |

真实 SQLite 浏览器链路覆盖登录、UI 记账、UI 转账、买入、卖出、逐笔撤销、
family/personal scope 往返、备份预览、恢复和最终余额核对。该结果不替代真实
PostgreSQL 并发验证。

## 外部待配置

- 专用 PostgreSQL 测试实例及 `INVEST_TEST_POSTGRES_URL`。
- 生产域名上的 Nginx 响应头探测。
- COS/OSS 等异机加密备份、失败告警和定期恢复演练。
- 若 Web 改为跨域 API，CSP `connect-src` 需列出确切 HTTPS API 来源。

以上均未使用生产环境替代，也未自动部署、上传或修改生产财务数据。
