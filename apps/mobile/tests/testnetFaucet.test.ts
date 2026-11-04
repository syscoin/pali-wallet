import assert from 'node:assert/strict';
import test from 'node:test';
import { getNativeNetwork, NATIVE_NETWORKS, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import { getTestnetFaucet, openTestnetFaucet } from '../src/custody/testnetFaucet.ts';

const network = getNativeNetwork('zksys-testnet');
const url = 'https://faucet-zk.tanenbaum.io/';

test('only the exact fixed 57057 registration has a public faucet handoff', () => {
  assert.equal(network.chainId, '57057');
  assert.equal(getTestnetFaucet(network)?.url, url);
  assert(Object.isFrozen(getTestnetFaucet(network)));
  for (const other of NATIVE_NETWORKS.filter((entry) => entry !== network)) assert.equal(getTestnetFaucet(other), null);
});

test('cloned, forged and accessor contexts are rejected without invoking getters', () => {
  let reads = 0;
  for (const forged of [{ ...network }, { ...network, chainId: '1' }, Object.create(network), { get id() { reads++; return network.id; } }]) {
    assert.throws(() => getTestnetFaucet(forged as NativeNetworkRegistration), { code: 'INVALID_CONTEXT' });
  }
  assert.equal(reads, 0);
});

test('handoff passes only the constant URL, and unsupported or forged contexts never open', async () => {
  const opened: string[] = [];
  const open = async (value: string) => { opened.push(value); };
  await openTestnetFaucet(network, open, () => undefined);
  assert.deepEqual(opened, [url]);
  assert.equal(new URL(opened[0]!).search, '');
  assert.equal(new URL(opened[0]!).hash, '');
  await assert.rejects(openTestnetFaucet(getNativeNetwork('syscoin-nevm-testnet'), open, () => undefined), { code: 'UNSUPPORTED_NETWORK' });
  await assert.rejects(openTestnetFaucet({ ...network }, open, () => undefined), { code: 'INVALID_CONTEXT' });
  assert.deepEqual(opened, [url]);
});

test('revocation before opening prevents external handoff', async () => {
  let calls = 0;
  const revoked = new Error('Revoked');
  await assert.rejects(openTestnetFaucet(network, async () => { calls++; }, () => { throw revoked; }), (error) => error === revoked);
  assert.equal(calls, 0);
});

test('revocation while the external opener is pending cannot complete the old action', async () => {
  let release!: () => void;
  let active = true;
  const revoked = new Error('Revoked');
  const pending = openTestnetFaucet(network, () => new Promise<void>((resolve) => { release = resolve; }), () => { if (!active) throw revoked; });
  active = false; release();
  await assert.rejects(pending, (error) => error === revoked);
});

test('external-opening failures are bounded to a public error and a later revoked action stays revoked', async () => {
  await assert.rejects(openTestnetFaucet(network, async () => { throw Error('OS detail'); }, () => undefined), { code: 'OPEN_FAILED', message: 'OPEN_FAILED' });
  let active = true;
  const revoked = new Error('Revoked');
  await assert.rejects(openTestnetFaucet(network, async () => { active = false; throw Error('OS detail'); }, () => { if (!active) throw revoked; }), (error) => error === revoked);
});
