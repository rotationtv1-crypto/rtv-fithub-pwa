require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');

const workouts = require('./workouts.json');
const packs = {
  starter: { coins: 50, price: '1.99' },
  boost: { coins: 150, price: '4.99' }
};
const paypalBase = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

function createApp({ dataDir = path.join(__dirname, 'data'), paypalFetch = fetch } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10kb' }));
  for (const file of ['index.html', 'app.js', 'config.js', 'workouts.json', 'manifest.json', 'service-worker.js']) {
    app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
  }
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  app.use('/icons', express.static(path.join(__dirname, 'icons')));

  const storeFile = path.join(dataDir, 'wallet.json');
  function readStore() {
    if (!fs.existsSync(storeFile)) return { coins: 0, completions: {}, orders: {} };
    const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    return { coins: saved.coins || 0, completions: saved.completions || {}, orders: saved.orders || {} };
  }
  function saveStore(store) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temporaryFile = `${storeFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, storeFile);
  }
  function wallet(store) { return { coins: store.coins, completions: store.completions }; }
  function error(res, status, message) { return res.status(status).json({ error: message }); }

  async function paypal(pathname, options) {
    const response = await paypalFetch(`${paypalBase}${pathname}`, options);
    const data = await response.json();
    if (!response.ok) throw new Error('PayPal request failed. Check credentials or try again.');
    return data;
  }
  async function accessToken() {
    const { PAYPAL_CLIENT_ID, PAYPAL_SECRET } = process.env;
    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) throw new Error('PayPal is not configured.');
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
    const data = await paypal('/v1/oauth2/token', {
      method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    if (!data.access_token) throw new Error('PayPal did not provide an access token.');
    return data.access_token;
  }

  app.get('/api/workouts', (req, res) => res.json(workouts));
  app.get('/api/wallet', (req, res) => res.json(wallet(readStore())));
  app.post('/api/wallet', (req, res) => {
    const workout = workouts.find(item => item.id === req.body?.workoutId);
    if (!workout) return error(res, 400, 'Unknown workout.');
    const store = readStore();
    const today = new Date().toISOString().slice(0, 10);
    if (store.completions[workout.id] === today) return error(res, 409, 'Already completed today.');
    store.completions[workout.id] = today;
    store.coins += workout.coins;
    saveStore(store);
    return res.json(wallet(store));
  });

  app.post('/api/paypal/create-order', async (req, res) => {
    const pack = Object.hasOwn(packs, req.body?.packId) ? packs[req.body.packId] : null;
    if (!pack) return error(res, 400, 'Unknown coin pack.');
    try {
      const token = await accessToken();
      const order = await paypal('/v2/checkout/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: pack.price }, description: `${pack.coins} FitHub demo coins` }],
          application_context: {
            return_url: process.env.PAYPAL_RETURN_URL || 'https://rotationtv1-crypto.github.io/rtv-fithub-pwa/',
            cancel_url: process.env.PAYPAL_RETURN_URL || 'https://rotationtv1-crypto.github.io/rtv-fithub-pwa/'
          }
        })
      });
      const approveUrl = order.links?.find(link => link.rel === 'approve')?.href;
      if (!order.id || !approveUrl || !approveUrl.startsWith('https://www.paypal.com/') && !approveUrl.startsWith('https://www.sandbox.paypal.com/')) {
        throw new Error('PayPal did not provide a valid approval link.');
      }
      const store = readStore();
      store.orders[order.id] = { packId: req.body.packId, captured: false };
      saveStore(store);
      return res.json({ orderId: order.id, approveUrl });
    } catch (err) { return error(res, err.message === 'PayPal is not configured.' ? 503 : 502, err.message); }
  });

  app.post('/api/paypal/capture-order', async (req, res) => {
    const orderId = req.body?.orderId;
    if (typeof orderId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(orderId)) return error(res, 400, 'Invalid order ID.');
    const store = readStore();
    const pending = store.orders[orderId];
    if (!pending) return error(res, 404, 'Order not found.');
    if (pending.captured) return res.json({ status: 'COMPLETED', wallet: wallet(store) });
    try {
      const token = await accessToken();
      const captured = await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}'
      });
      const amount = captured.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
      const pack = packs[pending.packId];
      if (captured.id !== orderId || captured.status !== 'COMPLETED' ||
          amount?.currency_code !== 'USD' || amount?.value !== pack.price) {
        return error(res, 502, 'PayPal payment could not be verified.');
      }
      store.coins += pack.coins;
      pending.captured = true;
      saveStore(store);
      return res.json({ status: 'COMPLETED', wallet: wallet(store) });
    } catch (err) { return error(res, err.message === 'PayPal is not configured.' ? 503 : 502, err.message); }
  });

  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) return error(res, 400, 'Invalid JSON.');
    console.error('FitHub request failed:', err);
    return error(res, 500, 'Unable to process the request.');
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`RTV FitHub listening on port ${port}`));
}
module.exports = { createApp };
