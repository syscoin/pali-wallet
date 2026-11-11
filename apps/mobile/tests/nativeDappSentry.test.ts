import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeDappSentryHost } from '../src/custody/dappSentry.ts';
import type { NativeSentryNodeManagement, SentryNodeLinkReview } from '../src/custody/sentryNodeManagement.ts';
import { SENTRY_NETWORKS } from '../../../source/shared/sentryNetworks.ts';

const raw = { version: 1, genesisHash: SENTRY_NETWORKS.mainnet.genesisHash, proTxHash: 'ab'.repeat(32) };
const origin = 'https://claimed.example';
const review: SentryNodeLinkReview = Object.freeze({ id: 'private-review', origin, network: 'mainnet', serviceUrl: 'https://configured.example', node: Object.freeze({ proTxHash: raw.proTxHash, service: 'sentry.example:8369', nevmAddress: '', collateralOutpoint: Object.freeze({ txid: 'cd'.repeat(32), vout: 0 }) }) });
function fixture(wait = Promise.resolve()) {
  let valid = true, commits = 0, disposed = 0;
  const prepared: unknown[] = [], cancelled: string[] = [];
  const check = () => { if (!valid) throw new Error('CONTEXT_CHANGED'); };
  const host = createNativeDappSentryHost({
    async openApprovals() { throw new Error('Linking must not open signing authority'); },
    async openNodes(signal, owned) {
      const current = () => { owned(); if (signal.aborted) throw new Error('CANCELLED'); };
      const nodes: NativeSentryNodeManagement = {
        isAuthenticating: () => false,
        async list() { current(); return { network: 'mainnet', serviceUrl: review.serviceUrl, linkedNodes: [], collateral: [] }; },
        async prepareLink(request, requestOrigin) { current(); prepared.push({ request, origin: requestOrigin }); return review; },
        async confirmLink(value) { current(); assert.equal(value, review); commits++; return { linked: true, version: 1, proTxHash: raw.proTxHash, genesisHash: raw.genesisHash }; },
        cancelLink(id) { cancelled.push(id); },
        async releaseCollateral() { throw new Error('Dapp linking must not release protection'); },
        dispose() { disposed++; },
      };
      await wait; return nodes;
    },
  });
  return { host, check, prepared, cancelled, commits: () => commits, disposed: () => disposed, retire: () => { valid = false; } };
}
test('Sentry linking retains exact untrusted origin, typed request and the original reviewed object through consent', async () => {
  const f = fixture();
  const prepared = await f.host.prepare({ method: 'sys_linkSentryNode', raw, origin }, new AbortController().signal, f.check, f.check);
  assert.deepEqual(f.prepared, [{ request: raw, origin }]);
  assert.equal(prepared.details.kind, 'link'); assert.equal(prepared.details.approval, review);
  await assert.rejects(prepared.approve({ kind: 'vote' }, f.check));
  assert.equal(f.commits(), 0);
  assert.deepEqual(await prepared.approve({ kind: 'link' }, f.check), { linked: true, version: 1, proTxHash: raw.proTxHash, genesisHash: raw.genesisHash });
  assert.equal(f.commits(), 1); prepared.dispose();
  assert.deepEqual(f.cancelled, [review.id]); assert.equal(f.disposed(), 1);
});
test('a late Sentry manager open is disposed before it can prepare after request cancellation', async () => {
  const held = Promise.withResolvers<void>(), f = fixture(held.promise), lifetime = new AbortController();
  const opening = f.host.prepare({ method: 'sys_linkSentryNode', raw, origin }, lifetime.signal, f.check, f.check);
  lifetime.abort(); held.resolve(); await assert.rejects(opening);
  assert.deepEqual(f.prepared, []); assert.equal(f.disposed(), 1); assert.equal(f.commits(), 0);
});
test('a retired request cannot approve its retained link capability', async () => {
  const f = fixture(), prepared = await f.host.prepare({ method: 'sys_linkSentryNode', raw, origin }, new AbortController().signal, f.check, f.check);
  f.retire(); await assert.rejects(prepared.approve({ kind: 'link' }, f.check));
  prepared.dispose(); assert.equal(f.commits(), 0); assert.equal(f.disposed(), 1);
});
