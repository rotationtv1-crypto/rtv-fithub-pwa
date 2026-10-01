const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../backend-server');

async function withServer(run, paypalFetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtv-fithub-'));
  const server = createApp({ dataDir: dir, paypalFetch }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = async (route, body) => {
    const response = await fetch(`${origin}${route}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  try { await run({ origin, send, dir }); }
  finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('serves five workouts and persists a daily wallet credit, rejecting invalid or repeated completion', async () => {
  await withServer(async ({ send, dir }) => {
    const workouts = await send('/api/workouts');
    assert.equal(workouts.status, 200);
    assert.equal(workouts.data.length, 5);
    assert.equal((await send('/api/wallet')).data.coins, 0);
    assert.equal((await send('/api/wallet', { workoutId: 'unknown' })).status, 400);
    const earned = await send('/api/wallet', { workoutId: 'mobility-flow' });
    assert.equal(earned.data.coins, 5);
    assert.equal((await send('/api/wallet', { workoutId: 'mobility-flow' })).status, 409);
    assert.equal((await send('/api/wallet')).data.coins, 5);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'wallet.json'))).coins, 5);
    assert.equal((await send('/api/wallet', { workoutId: '100-rep-challenge' })).data.coins, 15);
  });
});

test('only serves allowlisted shell files, never secrets or wallet storage', async () => {
  await withServer(async ({ origin, send }) => {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /A Member of the RotationTV Network Ecosystem/);
    for (const file of ['/.env', '/backend-server.js', '/data/wallet.json', '/package.json']) {
      assert.equal((await fetch(`${origin}${file}`)).status, 404);
    }
    assert.equal((await send('/api/paypal/create-order', { packId: 'starter' })).status, 503);
  });
});

test('PayPal fixed-price order and verified capture credits only once', async () => {
  const previousId = process.env.PAYPAL_CLIENT_ID;
  const previousSecret = process.env.PAYPAL_SECRET;
  process.env.PAYPAL_CLIENT_ID = 'test-id';
  process.env.PAYPAL_SECRET = 'test-secret';
  const calls = [];
  const paypalFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'test-token' }) };
    if (url.endsWith('/v2/checkout/orders')) return { ok: true, json: async () => ({
      id: 'ORDER12345', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345' }]
    }) };
    return { ok: true, json: async () => ({ id: 'ORDER12345', status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ amount: { currency_code: 'USD', value: '1.99' } }] } }] }) };
  };
  try {
    await withServer(async ({ send }) => {
      assert.equal((await send('/api/paypal/create-order', { packId: '__proto__' })).status, 400);
      assert.equal((await send('/api/paypal/create-order', { packId: 'bad' })).status, 400);
      assert.equal((await send('/api/paypal/capture-order', { orderId: 'OTHER12345' })).status, 404);
      const order = await send('/api/paypal/create-order', { packId: 'starter', amount: '0.01' });
      assert.equal(order.status, 200);
      assert.equal(order.data.orderId, 'ORDER12345');
      assert.equal(JSON.parse(calls[1].options.body).purchase_units[0].amount.value, '1.99');
      const captured = await send('/api/paypal/capture-order', { orderId: 'ORDER12345' });
      assert.equal(captured.data.wallet.coins, 50);
      assert.equal((await send('/api/paypal/capture-order', { orderId: 'ORDER12345' })).data.wallet.coins, 50);
      assert.equal(calls.filter(call => call.url.endsWith('/capture')).length, 1);
    }, paypalFetch);
  } finally {
    if (previousId === undefined) delete process.env.PAYPAL_CLIENT_ID; else process.env.PAYPAL_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.PAYPAL_SECRET; else process.env.PAYPAL_SECRET = previousSecret;
  }
});

test('does not award coins when PayPal capture amount does not match pack', async () => {
  const previousId = process.env.PAYPAL_CLIENT_ID;
  const previousSecret = process.env.PAYPAL_SECRET;
  process.env.PAYPAL_CLIENT_ID = 'test-id';
  process.env.PAYPAL_SECRET = 'test-secret';
  const mock = async url => ({ ok: true, json: async () => url.endsWith('/token') ?
    { access_token: 'token' } : url.endsWith('/orders') ?
    { id: 'ORDER12345', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow' }] } :
    { id: 'ORDER12345', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ amount: { currency_code: 'USD', value: '0.01' } }] } }] } });
  try {
    await withServer(async ({ send }) => {
      assert.equal((await send('/api/paypal/create-order', { packId: 'starter' })).status, 200);
      assert.equal((await send('/api/paypal/capture-order', { orderId: 'ORDER12345' })).status, 502);
      assert.equal((await send('/api/wallet')).data.coins, 0);
    }, mock);
  } finally {
    if (previousId === undefined) delete process.env.PAYPAL_CLIENT_ID; else process.env.PAYPAL_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.PAYPAL_SECRET; else process.env.PAYPAL_SECRET = previousSecret;
  }
});
