import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountActivityController } from '../src/activity/accountActivity.ts';
import { ActivityExplorerReader } from '../src/activity/explorerReader.ts';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW, type LocalActivityRecord } from '../src/activity/types.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import type { NotificationChoice } from '../src/notifications/choices.ts';

const owner = '0x' + '11'.repeat(20), external = '0x' + '22'.repeat(20);
const accountId = 'hd:60:0';
const ids = ['syscoin-nevm', 'ethereum', 'base', 'arbitrum', 'rollux', 'zksys'];
const flush = async () => { for (let turn = 0; turn < 5; turn++) await new Promise<void>(resolve => setImmediate(resolve)); };
const hash = (value: number) => '0x' + value.toString(16).padStart(64, '0');

function fixture(retained: boolean, filter = 'all') {
  let active = 0, maximum = 0;
  const calls: { kind: 'retained' | 'explorer' | 'pending'; network: string; at: number; signal: AbortSignal }[] = [];
  const choices: NotificationChoice[] = ids.map(id => {
    const network = getNativeNetwork(id);
    return { label: 'Account 1', networkName: network.name, symbol: network.symbol,
      scope: { id: `account:${id}`, accountId, accountType: 'HDAccount', accountAddress: owner, network } };
  });
  const delay = async (kind: typeof calls[number]['kind'], network: string, signal: AbortSignal) => {
    calls.push({ kind, network, at: Date.now(), signal });
    active++; maximum = Math.max(maximum, active);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(finish, 8000);
        function finish() { signal.removeEventListener('abort', abort); resolve(); }
        function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(Error('Cancelled')); }
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    } finally { active--; }
  };
  const explorer = new ActivityExplorerReader(async (url, init) => {
    const request = new URL(url);
    const choice = choices.find(choice => {
      const api = createActivityScope('a'.repeat(64), accountId, owner, choice.scope.network as ReturnType<typeof getNativeNetwork>).apiUrl;
      return api && request.origin + request.pathname === new URL(api).origin + new URL(api).pathname;
    })!;
    const network = choice.scope.network.id;
    const action = request.searchParams.get('action');
    await delay(action === 'pendingtxlist' ? 'pending' : 'explorer', network, init.signal as AbortSignal);
    return Response.json({ status: '1', message: 'OK', result: action !== 'txlist' ? [] : [{
      hash: hash(ids.indexOf(network) + 1), from: external, to: owner, value: '1', nonce: '0',
      blockNumber: '100', timeStamp: '1700000000', confirmations: '1', txreceipt_status: '1',
    }] });
  });
  const model = new AccountActivityController({
    source: { getSnapshot: () => ({ phase: 'ready', revision: 1, account: { address: owner, network: 'ethereum' } }) as any,
      getCatalogue: () => ({ active: { accountId } }) as any, subscribe: () => () => {} },
    choices: () => choices, filter: { load: async () => filter, save: async () => {} },
    runtime(choice) {
      const network = choice.network as ReturnType<typeof getNativeNetwork>;
      const scope = createActivityScope('a'.repeat(64), accountId, owner, network);
      const locals: LocalActivityRecord[] = retained ? [0, 1].map(index => ({ walletFingerprint: 'a'.repeat(64), accountId,
        address: owner, networkId: network.id, registrationHash: network.registrationHash, chainId: network.chainId,
        hash: hash(100 + ids.indexOf(network.id) * 2 + index), phase: 'submitted', nonce: index, createdAt: 1,
        recipient: external, amountUnits: '1', maximumFeeUnits: '21000' })) : [];
      return { async load(check) { check(); return { scope, locals, saved: { archived: [], candidates: [], view: DEFAULT_ACTIVITY_VIEW, truncated: false } }; },
        async observeLocal(record, check, signal) { await delay('retained', network.id, signal); check(); return { status: 'missing', latestNonce: String(record.nonce) }; },
        async saveCache(_scope, _rows, check) { check(); }, async saveView(_scope, _view, check) { check(); } };
    },
    explorer, receipts: { async read() { throw Error('No detail reads expected'); } },
  });
  return { model, calls, maximum: () => maximum, active: () => active };
}

for (const scenario of [{ retained: true, filter: 'all' }, { retained: false, filter: 'all' }, { retained: true, filter: 'zksys' }]) {
  test(`queued explorer responses retain their owned window (${JSON.stringify(scenario)})`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1700000100000 });
    const f = fixture(scenario.retained, scenario.filter), stop = f.model.connect();
    try {
      await flush();
      for (let second = 0; second < 64; second++) { t.mock.timers.tick(1000); await flush(); }
      const expected = scenario.filter === 'all' ? ['syscoin-nevm', 'ethereum', 'rollux', 'zksys'] : ['zksys'];
      for (const id of expected) {
        const child = f.model.getNetwork(id)!.controller.getSnapshot();
        assert.equal(child.error, null, id); assert.equal(child.status, 'ready', id);
        assert(child.rows.some(row => row.hash === hash(ids.indexOf(id) + 1)), id);
      }
      assert(f.maximum() <= 4); assert.equal(f.active(), 0);
      assert.equal(f.calls.filter(call => call.kind === 'explorer').length, expected.length * 2);
      assert.deepEqual(f.calls.filter(call => call.kind === 'pending').map(call => call.network).sort(),
        expected.filter(id => id !== 'ethereum').sort());
      if (scenario.retained && scenario.filter === 'all')
        assert(f.calls.find(call => call.kind === 'explorer' && call.network === 'zksys')!.at >= 1700000124000);
    } finally { stop(); t.mock.timers.reset(); }
  });
}

test('changing the Activity filter retires queued work before I/O without exceeding four active reads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1700000100000 });
  const f = fixture(true), stop = f.model.connect();
  try {
    await flush(); const previous = f.calls.length;
    assert.equal(previous, 4);
    await f.model.selectFilter('zksys'); await flush();
    assert(f.calls.slice(0, previous).every(call => call.signal.aborted));
    for (let second = 0; second < 24; second++) { t.mock.timers.tick(1000); await flush(); }
    assert(f.calls.slice(previous).every(call => call.network === 'zksys'));
    assert.equal(f.model.getSnapshot().filter, 'zksys');
    assert.equal(f.model.getNetwork('zksys')!.controller.getSnapshot().error, null);
    assert(f.maximum() <= 4); assert.equal(f.active(), 0);
  } finally { stop(); t.mock.timers.reset(); }
});
