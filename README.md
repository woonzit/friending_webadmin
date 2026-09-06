# Friending Webadmin

Secure, dark-only bilingual administration for Friending at `https://friendingapp.com`.

The console provides:

- an operational overview with rolling 24h/7d signup totals and Persona-verified subsets;
- registered-user search, rolling 24h/48h/72h/7d registration filters and profile inspection;
- moderation, verification, membership, support, and presence operations;
- People discovery hero campaign management;
- allow-listed runtime, landing, signup, and profile catalogue configuration;
- admin allow-list management;
- an immutable administrative audit view.

The browser never receives the Friending Core shared secret. Email-code login
creates a separate signed HttpOnly session, and admin membership is rechecked
against Core on every protected request.

Registration periods are rolling elapsed-time windows, anchored when Apply is pressed
and kept across pagination. Overview signup cohorts exclude system/demo/test/synthetic
and metrics-excluded accounts. Persona is current successful Persona verification
(including valid Persona imports), not an administrator exemption. Core's schema-1
`overview.data.signup_metrics` contract and generated controller corpus are pinned in
`tests/fixtures/webadmin_signup_metrics_wire`; an older Core without the block displays
metrics unavailable rather than false zeroes. Existing list filters and legacy overview
fields retain their original semantics.

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
