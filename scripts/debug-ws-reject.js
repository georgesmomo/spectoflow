'use strict';
// Temporary diagnostic script — not part of the framework. Mirrors connector.test.js's
// "WebSocket upgrade failure → HTTP fallback → back to WebSocket after wsRetryEvery" test
// exactly, but with heavy logging, to see what happens in CI where that test hangs
// deterministically (0 frames within 5s) though it never reproduces locally. Remove once diagnosed.
const { startFakeRelay } = require('../test/helpers/fake-relay');
const { createConnector } = require('../lib/dashboard/connector');

const fast = { backoffMin: 30, backoffMax: 60, dropWindow: 60000, dropLimit: 3, wsRetryEvery: 300, pollTimeout: 5000 };
const PUB = [{ localId: 'aaaaaa', name: 'alpha', kind: 'spectoflow', stats: { total: 2, done: 1 } }];
function stubs() {
  return {
    listPublished: () => PUB,
    readSnapshot: async (localId) => ({ projectName: 'snap-' + localId, plans: [] }),
    execOp: async () => ({ ok: true }),
  };
}

(async () => {
  console.log('node version:', process.version, 'platform:', process.platform, 'arch:', process.arch);
  const relay = await startFakeRelay({ pollHold: 100 });
  relay.rejectUpgrade = true;
  const c = createConnector({
    url: relay.url, token: relay.token, machineName: 'test-box', version: '0.25.0', timing: fast, ...stubs(),
    log: (m) => console.log(`[t=${Date.now() - t0}ms]`, m),
  });
  const t0 = Date.now();
  let lastLen = 0;
  const poller = setInterval(() => {
    if (relay.frames.length !== lastLen) {
      lastLen = relay.frames.length;
      console.log(`[t=${Date.now() - t0}ms] frames now:`, JSON.stringify(relay.frames.map((f) => ({ type: f.type, via: f.via }))));
    }
  }, 20);
  c.start();

  await new Promise((r) => setTimeout(r, 2000));
  console.log(`[t=${Date.now() - t0}ms] status after 2s:`, c.status());
  relay.rejectUpgrade = false;
  console.log(`[t=${Date.now() - t0}ms] rejectUpgrade set to false`);

  await new Promise((r) => setTimeout(r, 4000));
  console.log(`[t=${Date.now() - t0}ms] status after 6s total:`, c.status());
  console.log(`[t=${Date.now() - t0}ms] relay.upgrades=${relay.upgrades} httpPosts=${relay.httpPosts} httpPolls=${relay.httpPolls}`);
  console.log('final frames:', JSON.stringify(relay.frames.map((f) => ({ type: f.type, via: f.via }))));
  clearInterval(poller);
  c.stop();
  await relay.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
