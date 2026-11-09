import assert from 'node:assert/strict';
import test from 'node:test';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { NativePsbtRequests } from '../src/connections/psbtRequests.ts';
import type { WalletConnectRequest } from '../src/connections/walletConnect.ts';
import type { PsbtApprovalMethod, PsbtApprovalReview, PreparedPsbtApproval } from '../../../source/wallet/psbtApprovals.ts';

const psbt = new syscoinUtils.bitcoinjs.Psbt();
psbt.addInput({ hash: 'aa'.repeat(32), index: 0 });
psbt.addOutput({ script: Buffer.from('51', 'hex'), value: BigInt(900) });
const envelope = PsbtUtils.toPali(psbt);
const origin = 'https://reported.example', topic = 'a1'.repeat(32);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(method: PsbtApprovalMethod = 'sys_sign') {
  let current = true, foreground = true, blocked = false, preparations = 0, signatures = 0, disposals = 0, dispatched = false;
  let prepareWait = Promise.resolve(), signWait = Promise.resolve(), responseWait = Promise.resolve();
  let responseError: Error | undefined, signError: Error | undefined;
  const requests: unknown[] = [], responses: unknown[] = [], handoffs: unknown[] = [];
  const lifetime: AbortSignal[] = [];
  const check = () => { if (!current) throw Error('CONTEXT_CHANGED'); };
  const wire: WalletConnectRequest = { id: 1, expiresAt: Date.now() + 120000,
    session: { binding: { topic, peerPublicKey: 'b2'.repeat(32), origin },
      metadata: { name: 'Untrusted display name', description: '', url: 'https://attacker.invalid', icons: [] }, expiry: Math.ceil(Date.now() / 1000) + 600,
      namespaces: { bip122: { accounts: ['bip122:' + 'ab'.repeat(16) + ':stable-anchor'], methods: ['sys_sign', 'sys_signAndSend'], events: [] } } },
    chainId: 'bip122:' + 'ab'.repeat(16), method, params: [{ ...envelope }], verification: { validation: 'UNKNOWN', isScam: false } };
  const details: PsbtApprovalReview = Object.freeze({ method, origin, unsignedHash: 'ab'.repeat(32), transactionType: 'bitcoin', feeSatoshis: '100',
    transactionOptions: { rbf: false }, complete: false, sentry: null,
    inputs: [{ txid: 'aa'.repeat(32), vout: 0, valueSatoshis: '1000', scriptHex: '51' }],
    outputs: [{ index: 0, address: null, scriptHex: '51', valueSatoshis: '900', assets: [] }] });
  const manager = new NativePsbtRequests({
    foreground: () => foreground, changed() {}, checkSite: async () => ({ isBlacklisted: blocked }),
    host: () => ({ async prepare(request, signal, guard) {
      preparations++; requests.push(request); lifetime.push(signal); await prepareWait;
      const prepared: PreparedPsbtApproval = { review: details, assertCurrent: guard,
        disposition: () => dispatched ? { transactionNotBroadcast: false, txid: 'ef'.repeat(32) } : { transactionNotBroadcast: true },
        async approve() { guard(); signatures++; await signWait; guard(); if (signError) throw signError; return method === 'sys_sign' ? envelope : { txid: 'dd'.repeat(32) }; },
        dispose() { disposals++; } };
      return prepared;
    } }),
    async respond(request, response, guard, handoff) {
      guard(); handoff(); handoffs.push({ topic: request.session.binding.topic, id: request.id });
      responses.push({ topic: request.session.binding.topic, id: request.id, response }); await responseWait;
      if (responseError) throw responseError;
    },
  });
  const enqueue = () => manager.enqueue(wire, { order: 1, accountLabel: 'Account', address: 'stable-address', networkLabel: 'Bitcoin',
    chainId: wire.chainId, symbol: 'BTC', decimals: 8, assertCurrent: check });
  return { manager, wire, details, enqueue, requests, responses, handoffs, lifetime,
    review: () => manager.review(7), preparations: () => preparations, signatures: () => signatures, disposals: () => disposals,
    retire: () => { current = false; manager.revalidate(); }, setForeground: (value: boolean) => { foreground = value; },
    block: () => { blocked = true; }, holdPrepare: (wait: Promise<void>) => { prepareWait = wait; },
    markDispatched: () => { dispatched = true; },
    holdSign: (wait: Promise<void>) => { signWait = wait; }, holdResponse: (wait: Promise<void>) => { responseWait = wait; },
    failResponse: (error: Error) => { responseError = error; }, failSign: (error: Error) => { signError = error; } };
}

for (const method of ['sys_sign', 'sys_signAndSend'] as const) test(`${method} prepares a detached public review and requires explicit one-use consent`, async () => {
  const f = fixture(method);
  try {
    f.enqueue(); await tick();
    assert.equal(f.signatures(), 0); assert.equal(f.responses.length, 0);
    assert.equal(f.review()!.details, f.details); assert.equal(f.review()!.origin, origin);
    assert(!JSON.stringify(f.review()).includes(envelope.psbt));
    assert(!JSON.stringify(f.requests).includes('attacker.invalid'));
    (f.wire.params as { psbt: string }[])[0]!.psbt = 'changed after admission';
    assert.deepEqual(f.requests, [{ method, origin, psbt: envelope }]);
    const id = f.review()!.id;
    const pending = f.manager.approve(id);
    await assert.rejects(f.manager.approve(id)); await pending;
    assert.equal(f.signatures(), 1); assert.equal(f.disposals(), 1); assert.equal(f.review(), null);
    assert.deepEqual(f.responses, [{ topic, id: 1, response: { result: method === 'sys_sign' ? envelope : { txid: 'dd'.repeat(32) } } }]);
  } finally { await f.manager.dispose(); }
});

test('late prepare after cancellation disposes its capability and cannot publish a review', async () => {
  const held = Promise.withResolvers<void>(), f = fixture(); f.holdPrepare(held.promise);
  f.enqueue(); await tick(); f.manager.reject(f.review()!.id); held.resolve(); await tick();
  assert.equal(f.review(), null); assert.equal(f.disposals(), 1); assert.equal(f.signatures(), 0);
  assert(f.lifetime[0]!.aborted); assert.equal(f.responses.length, 1);
  await f.manager.dispose();
});

test('revocation while signing prevents result disclosure and joins the admitted operation', async () => {
  const held = Promise.withResolvers<void>(), f = fixture(); f.holdSign(held.promise);
  f.enqueue(); await tick(); const signing = f.manager.approve(f.review()!.id);
  await tick(); f.retire();
  let joined = false; const disposal = f.manager.dispose().then(() => { joined = true; }); await tick(); assert.equal(joined, false);
  held.resolve(); await assert.rejects(signing); await disposal;
  assert.equal(f.responses.length, 0); assert.equal(f.disposals(), 1); assert.equal(f.review(), null);
});

test('lost response ACK and held ACK cannot admit another signature', async () => {
  const held = Promise.withResolvers<void>(), f = fixture(); f.holdResponse(held.promise); f.failResponse(Error('private relay error'));
  try {
    f.enqueue(); await tick(); const pending = f.manager.approve(f.review()!.id); await tick();
    assert.equal(f.handoffs.length, 1); assert.equal(f.signatures(), 1);
    await assert.rejects(f.manager.approve(f.review()!.id)); held.resolve(); await assert.rejects(pending);
    assert.equal(f.review()!.error, 'DELIVERY_UNCERTAIN'); assert.equal(f.review()!.attempted, true);
    await assert.rejects(f.manager.approve(f.review()!.id)); assert.equal(f.signatures(), 1);
    f.manager.reject(f.review()!.id); assert.equal(f.responses.length, 1);
  } finally { await f.manager.dispose(); }
});

test('uncertain submission retains its known txid and blocks a new sign or send', async () => {
  const f = fixture('sys_signAndSend'); f.failSign(Object.assign(Error('opaque provider failure'), { code: 'UTXO_SUBMISSION_UNKNOWN', txid: 'ef'.repeat(32) }));
  f.markDispatched();
  try {
    f.enqueue(); await tick(); await assert.rejects(f.manager.approve(f.review()!.id));
    assert.equal(f.review()!.error, 'SUBMISSION_UNCERTAIN'); assert.equal(f.review()!.txid, 'ef'.repeat(32));
    await assert.rejects(f.manager.approve(f.review()!.id)); assert.equal(f.signatures(), 1); assert.equal(f.responses.length, 0);
  } finally { await f.manager.dispose(); }
});

test('background queue ordering, site recheck and expiry cannot silently start signing', async () => {
  const f = fixture(); f.setForeground(false);
  try {
    f.enqueue(); await tick(); assert.equal(f.preparations(), 0); assert.equal(f.review(), null);
    f.setForeground(true); await f.manager.prepare(); f.block();
    await assert.rejects(f.manager.approve(f.review()!.id)); assert.equal(f.review()!.error, 'BLOCKED_SITE'); assert.equal(f.signatures(), 0);
    f.manager.expire(f.wire.id); assert.equal(f.review(), null); assert.equal(f.responses.length, 0);
  } finally { await f.manager.dispose(); }
});

test('malformed envelope and missing required ports fail before host or signing admission', async () => {
  const f = fixture();
  try {
    for (const params of [envelope, [envelope, envelope], [{ psbt: 'invalid', assets: '[]' }], [{ ...envelope, sentryFeeAuthorization: 'untrusted tag' }]]) {
      assert.throws(() => f.manager.enqueue({ ...f.wire, params }, { order: 1, accountLabel: '', address: '', networkLabel: '', chainId: '', symbol: '', decimals: 8, assertCurrent() {} }));
    }
    assert.equal(f.preparations(), 0); assert.equal(f.signatures(), 0);
    // @ts-expect-error Required host callbacks are also enforced for JavaScript callers.
    assert.throws(() => new NativePsbtRequests({}), /PSBT_REQUEST_PORTS_REQUIRED/);
  } finally { await f.manager.dispose(); }
});

for (const dispatched of [false, true]) test(`Close while signing uses the shared ${dispatched ? 'dispatched' : 'not-dispatched'} disposition before replying`, async () => {
  const held = Promise.withResolvers<void>(), f = fixture('sys_signAndSend'); f.holdSign(held.promise);
  f.enqueue(); await tick(); const id = f.review()!.id, work = f.manager.approve(id);
  await tick(); if (dispatched) f.markDispatched();
  f.manager.reject(id); assert.equal(f.responses.length, 0); assert.equal(f.review(), null);
  held.resolve(); await assert.rejects(work); await tick();
  assert.equal(f.responses.length, dispatched ? 0 : 1);
  if (!dispatched) assert.deepEqual(f.responses[0], { topic, id: 1, response: { error: { code: 4001, message: 'User rejected' } } });
  await f.manager.dispose();
});
