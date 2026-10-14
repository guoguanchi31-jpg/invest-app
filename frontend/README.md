# Invest frontend

React + Vite frontend packaged for iOS and Android with Capacitor.

## Web development

```bash
npm install
npm run dev
```

The default development command supervises both Vite and the local FastAPI
server at `http://127.0.0.1:8000`. It starts a missing backend and restarts a
backend process that exits unexpectedly. Use `npm run dev:frontend` or
`INVEST_SKIP_BACKEND=1 npm run dev` when the API is managed separately.

Without `VITE_API_URL`, browser development uses the same-origin `/api` Vite
proxy targeting `http://127.0.0.1:8000`. This keeps alternate Vite ports from
drifting out of the backend CORS allowlist.

Open the local device simulator with one command:

```bash
npm run simulator
```

This starts the supervised development environment and opens
`/simulator.html`. It does not add the simulator to the production build.

## Mobile configuration

Create `.env.local` from `.env.example` and set `VITE_API_URL` to the
public HTTPS URL of the FastAPI backend. A native build intentionally
has no localhost fallback because localhost points to the phone itself.

```bash
cp .env.example .env.local
npm run mobile:sync
```

Open a native project after synchronization:

```bash
npm run mobile:open:ios
npm run mobile:open:android
```

## Quality checks

```bash
npm run test:coverage
npm run lint
npm run verify:build
npm run test:e2e
npm run test:e2e:real
```

The Playwright smoke suite runs against a local Vite server and mocks only the
backend transport boundary, so it verifies the real desktop and mobile browser
rendering and navigation paths.

The production build excludes the simulator and removed debug endpoints.
Use `npm run build:simulator` only for a dedicated development build.

The real API runner starts its own temporary SQLite backend and Vite on separate
ports, then removes the database and stops both servers. It never reuses an
existing application database. Install Chromium once before running:

```bash
npx playwright install chromium
npm run test:e2e:real
```

The real suite requires at least six passing tests and zero skips across desktop,
tablet, and phone viewports. It covers financial writes, reversals, restore via
the UI, refreshed member/account mappings, replay, and failed reads after a
successful write. Logs and a JSON report are in `test-results/real-api/`.
Use `INVEST_BACKEND_PYTHON` to select a Python executable if `backend/venv` is absent.

Forms share `useSubmission`; business dates follow `business_timezone` from the
authenticated session, with `Asia/Shanghai` as the initial default.

The initial application identifier is `com.investapp.mobile`. Change it
before store submission if a different permanent bundle identifier is
required.
