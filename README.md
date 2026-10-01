# RTV FitHub

Mobile-first bodyweight workout PWA. A Member of the RotationTV Network Ecosystem.

## Static site (GitHub Pages)

The `main` branch deploys the app shell through `.github/workflows/pages.yml` to https://rotationtv1-crypto.github.io/rtv-fithub-pwa/. Open on HTTPS to install; the service worker caches the shell and workouts for offline use. By default `config.js` has an empty `apiBase`: demo coins are stored on the current device in localStorage. These demo coins have no cash or crypto value. Each workout awards coins at most once per UTC day. The 90-day plan is a reference guide, not an automated day-by-day tracker.

## Optional API

Install Node 20+, run `npm ci`, copy `.env.example` to `.env`, populate PayPal sandbox credentials if using checkout, then run `npm start` or `npm run dev`. The Express server serves the same static PWA and exposes:

- `GET /api/workouts` — workout list
- `GET /api/wallet` — single-instance demo wallet
- `POST /api/wallet` — `{ "workoutId": "mobility-flow" }` (once per workout per UTC day)
- `POST /api/paypal/create-order` — `{ "packId": "starter" }` or `boost` (fixed USD 1.99 / 4.99 prices)
- `POST /api/paypal/capture-order` — `{ "orderId": "..." }` for an order created by this server; checks PayPal's completed status, ID and captured amount before crediting once.

PayPal uses sandbox by default; `PAYPAL_ENV=live` opts into production, and optional `PAYPAL_RETURN_URL` specifies your HTTPS approval/cancel return URL. No PayPal credentials or payment processing run in the browser. PayPal API routes are backend-only; the static GitHub Pages site does **not** host them or provide a checkout button. Set `window.RTV_CONFIG.apiBase` in `config.js` to a deployed HTTPS API origin only after deploying a persistent backend; once set, the UI uses the API wallet rather than the local wallet. The `EMAIL_*` placeholders are reserved for future work and are not used by this app.

The API is a **single shared demo wallet**, stored in `data/wallet.json`, not a production multi-user account system. There is no login or ownership verification; do not deploy the API for public payments until authentication, per-user wallets, abuse controls and durable transactional storage are implemented. The `data/` directory and `.env` are ignored by Git. For tests: `npm test` and `node --check backend-server.js`.
