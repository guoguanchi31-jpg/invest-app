# Invest

家庭投资与收支管理应用。Web 与 Capacitor 移动端共享 React 前端，后端使用
FastAPI，生产数据库为 PostgreSQL 16，本地开发和迁移工具兼容 SQLite。

## 本地开发

首次安装：

```bash
cd backend
python -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python migrate.py
cd ../frontend
npm ci
```

日常启动：

```bash
cd frontend
npm run dev
```

`npm run dev` 会同时管理 Vite 和 `http://127.0.0.1:8000` 上的 FastAPI：
后端未运行时自动启动，意外退出时自动恢复。仅需连接外部后端时，可使用
`INVEST_SKIP_BACKEND=1 npm run dev`，或单独运行 `npm run dev:frontend`。

打开开发模拟器：

```bash
cd frontend
npm run simulator
```

该命令会启动开发环境并直接打开 `/simulator.html`。默认生产构建仍不包含模拟器。

开发浏览器默认通过 Vite 同源 `/api` 代理访问 `http://127.0.0.1:8000`，避免
前端端口变化引起 CORS 失败。显式 `VITE_API_URL` 时仍直接使用该地址。本地模式允许
初始化开发账号 `admin / 123456`；任何联网部署必须设置 `APP_ENV=production`、
独立 `APP_PASSWORD` 和 `APP_AUTH_SECRET`。

应用启动会校验数据库迁移版本。本地开发默认可自动迁移；生产发布必须先执行
`python migrate.py`，不能依赖应用请求触发结构变更。

## 质量检查

在项目根目录执行：

```bash
(cd backend && venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v)
(cd frontend && npm run test:coverage)
(cd frontend && npm run lint)
(cd frontend && npm run verify:build)
(cd frontend && npm run test:e2e)
(cd frontend && npm run test:e2e:real)
python3 -m unittest discover -s deploy/tests -p 'test_*.py' -v
```

测试层级：

- 后端默认套件使用临时 SQLite，覆盖领域规则、HTTP 流程、迁移、备份和并发回归。
- `backend/tests/test_cross_workflows.py` 可通过
  `INVEST_TEST_POSTGRES_URL` 在专用 PostgreSQL 实例运行相同跨流程用例。
- Vitest 覆盖前端状态、请求乱序和组件行为；Playwright 在桌面、平板、手机
  三种视口运行模拟 API 浏览器测试。
- `npm run test:e2e:real` 自动分配独立端口、启动临时 SQLite 后端和 Vite，执行
  三端真实登录、记账、转账、投资、撤销、恢复和写成功后读取失败的回归；退出时
  清理测试服务和数据库。首次运行先执行 `npx playwright install chromium`。
- CI 独立运行真实 PostgreSQL 跨流程测试、真实浏览器和 PostgreSQL 备份恢复演练；
  浏览器作业要求至少六项成功且零跳过。
- 未配置 `INVEST_TEST_POSTGRES_URL` 时，真实 PostgreSQL 用例会明确跳过。该
  变量不得指向生产数据库。

当前数据库 schema 版本为 11，JSON 备份版本为 v8（兼容 v1-v7）。
业务日历由后端 `BUSINESS_TIMEZONE` 决定，默认 `Asia/Shanghai`，会话会同步给
前端。默认生产构建不包含模拟器；开发专用构建使用 `npm run build:simulator`。

生产部署、备份和恢复见 [DEPLOYMENT.md](DEPLOYMENT.md)，架构边界和依赖规则见
[docs/architecture.md](docs/architecture.md)。本轮 R1–R7 完整改造结果与验证边界见
[docs/architecture-remediation-2026-09-30.md](docs/architecture-remediation-2026-09-30.md)；
升级兼容、回退与历史账本核对流程见
[docs/upgrade-compatibility-2026-10-01.md](docs/upgrade-compatibility-2026-10-01.md)；
本轮四项修复与验证边界见
[docs/architecture-fixes-2026-10-01-round-5.md](docs/architecture-fixes-2026-10-01-round-5.md)；
此前分层改造记录保留在 [docs/refactor-acceptance.md](docs/refactor-acceptance.md)。
