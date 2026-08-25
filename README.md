# Friending Webadmin

Secure, dark-only bilingual administration for Friending at `https://friendingapp.com`.

The console provides:

- an operational overview;
- registered-user search and profile inspection;
- moderation, verification, membership, support, and presence operations;
- People discovery hero campaign management;
- allow-listed runtime, landing, signup, and profile catalogue configuration;
- admin allow-list management;
- an immutable administrative audit view.

The browser never receives the Friending Core shared secret. Email-code login
creates a separate signed HttpOnly session, and admin membership is rechecked
against Core on every protected request.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3006`.

## Checks

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Production and server details are documented in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
