# Freelove Webadmin

Secure, bilingual administration for Freelove.

The first release provides:

- an operational overview;
- registered-user search and profile inspection;
- People discovery hero campaign management;
- a small allow-listed runtime configuration registry;
- admin allow-list management;
- an immutable administrative audit view.

The browser never receives the Freelove Core shared secret. Email-code login
creates a separate signed HttpOnly session, and admin membership is rechecked
against Core on every protected request.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3004`.

## Checks

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Production and server details are documented in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
