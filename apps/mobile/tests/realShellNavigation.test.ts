import assert from 'node:assert/strict';
import test from 'node:test';
import { TabDeparture } from '../src/navigation/tabDeparture.ts';
import { createWatchAccount, WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';

test('delayed Activity departure applies once and cannot overwrite a newer tab request', () => {
  const navigation = new TabDeparture(); const callbacks: (() => void)[] = []; const visits: string[] = [];
  const current = () => 'hd:60:0:ethereum:7';
  navigation.request(current(), current, (done) => callbacks.push(done), () => visits.push('tools'));
  navigation.request(current(), current, (done) => callbacks.push(done), () => visits.push('settings'));
  callbacks[0]!(); assert.deepEqual(visits, []);
  callbacks[1]!(); callbacks[1]!(); assert.deepEqual(visits, ['settings']);
});
test('lock, unmount and account/network A-B-A revoke pending public departure', () => {
  for (const interruption of ['lock', 'unmount', 'aba'] as const) {
    const navigation = new TabDeparture(); let scope: string | null = 'hd:60:0:ethereum:7';
    let complete!: () => void; let navigated = false;
    navigation.request(scope, () => scope, (done) => { complete = done; }, () => { navigated = true; });
    if (interruption === 'lock') scope = null;
    else if (interruption === 'unmount') navigation.invalidate();
    else scope = 'hd:60:0:ethereum:9';
    complete(); assert.equal(navigated, false);
  }
});
test('leaving a public Wallet tab aborts its request without changing its selected account or privacy lock', async () => {
  let signal!: AbortSignal; let resolve!: (value: { chainId: number; units: string }) => void;
  const account = createWatchAccount('watch', 'Watch', '0x1111111111111111111111111111111111111111');
  const authority = new WatchOnlyAuthority([account], { readBalance: async (_network, _address, request) => {
    signal = request; return new Promise((done) => { resolve = done; });
  } });
  authority.unlock(); authority.selectNetwork('base');
  const pending = authority.refresh(); assert.equal(signal.aborted, false);
  authority.cancelRefresh();
  assert.equal(signal.aborted, true); assert.equal(authority.getSnapshot().status, 'ready');
  assert.equal(authority.getSnapshot().selectedAccountId, 'watch'); assert.equal(authority.getSnapshot().selectedNetworkId, 'base');
  assert.equal(authority.getSnapshot().balance.status, 'unknown');
  resolve({ chainId: 8453, units: '10' }); await pending;
  assert.equal(authority.getSnapshot().balance.status, 'unknown');
  authority.lock(); const generation = authority.getSnapshot().generation; authority.cancelRefresh();
  assert.equal(authority.getSnapshot().status, 'locked'); assert.equal(authority.getSnapshot().generation, generation);
});
