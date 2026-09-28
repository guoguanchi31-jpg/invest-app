# Invest frontend

React + Vite frontend packaged for iOS and Android with Capacitor.

## Web development

```bash
npm install
npm run dev
```

The development server uses `http://127.0.0.1:8000` when
`VITE_API_URL` is not set.

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

The initial application identifier is `com.investapp.mobile`. Change it
before store submission if a different permanent bundle identifier is
required.
