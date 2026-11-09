import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSentryRequests, type NativeConnectionSentryHost } from '../src/connections/sentryRequests.ts';
import type { WalletConnectRequest } from '../src/connections/walletConnect.ts';
import type { SentryNodeLinkReview } from '../../../source/wallet/sentryNodeManagement.ts';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  let current = true, published = false, cancelled = 0, calls = 0;
  let signing = Promise.resolve(), response = Promise.resolve();
  let responseError = false;
  const scope = new AbortController(), check = () => { if (!current) throw Error('CONTEXT_CHANGED'); };
  const wire: WalletConnectRequest = { freshness: 'fresh', id: 9, method: 'sys_linkSentryNode', chainId: 'bip122:' + 'ab'.repeat(16), params: [{ version: 1 }], expiresAt: Date.now() + 120000,
    session: { binding: { topic: 'aa'.repeat(32), peerPublicKey: 'bb'.repeat(32), origin: 'https://original.test' },
      metadata: { name: 'Reported name', description: '', url: 'https://not-authority.test', icons: [] }, expiry: Math.ceil(Date.now()/1000) + 600,
      namespaces: { bip122: { methods: ['sys_linkSentryNode'], accounts: [], events: [] } } }, verification: { validation: 'UNKNOWN', isScam: false } };
  const approval: SentryNodeLinkReview = { id: 'private-id', origin: wire.session.binding.origin, network: 'mainnet', serviceUrl: 'https://configured.test',
    node: { proTxHash: 'ab'.repeat(32), service: 'node.test:8369', nevmAddress: '', collateralOutpoint: { txid: 'cd'.repeat(32), vout: 1 } } };
  const host: NativeConnectionSentryHost = { revalidate() {}, async prepare(_request, signal, guard, assertGrant) {
    assertGrant(); return { details: { kind: 'link', approval }, assertCurrent: guard,
      async approve() { calls++; await signing; guard(); return { linked: true }; },
      disclose() { guard(); assertGrant(); published = true; },
      dispose() { if (!published) cancelled++; assert(signal.aborted); } };
  } };
  const manager = new NativeSentryRequests({ host: () => host, foreground: () => true, changed() {}, checkSite: async () => ({ isBlacklisted: false }),
    async respond(_wire, value, guard, handoff) { guard(); if ('result' in value) { handoff(); await response; if (responseError) throw Error('Lost ACK'); } }, });
  const enqueue = () => manager.enqueue(wire, { order: 1, accountLabel: 'Account', address: 'address', networkLabel: 'Syscoin', chainId: wire.chainId, assertCurrent: check, assertGrantCurrent: check });
  return { manager, enqueue, published: () => published, cancelled: () => cancelled, calls: () => calls,
    holdSign: (value: Promise<void>) => { signing = value; }, holdResponse: (value: Promise<void>) => { response = value; responseError = true; },
    revoke() { current = false; scope.abort(); manager.revalidate(); } };
}
test('pre-handoff cancellation retires unpublished authority and suppresses the late result', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdSign(held.promise);
  f.enqueue(); await tick(); const id = f.manager.review(1)!.id;
  const pending = f.manager.approve(id, { kind: 'link' }); await tick(); f.manager.reject(id); held.resolve();
  await assert.rejects(pending); assert.equal(f.published(), false); assert.equal(f.cancelled(), 1); await f.manager.dispose();
});
test('handoff publishes once and lost ACK retirement preserves it without another approval', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdResponse(held.promise);
  try {
    f.enqueue(); await tick(); const id = f.manager.review(1)!.id;
    const pending = f.manager.approve(id, { kind: 'link' }); await tick(); assert.equal(f.published(), true);
    await assert.rejects(f.manager.approve(id, { kind: 'link' })); held.resolve(); await assert.rejects(pending);
    assert.equal(f.manager.review(1)!.error, 'DELIVERY_UNCERTAIN');
    f.manager.reject(id); assert.equal(f.cancelled(), 0); assert.equal(f.calls(), 1);
  } finally { await f.manager.dispose(); }
});
