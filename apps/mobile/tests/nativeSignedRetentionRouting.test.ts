import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { createNativeRetirementReadForChain, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { createNativeNetwork, getNativeNetwork } from '../src/custody/networkContext.ts';

const network = createNativeNetwork({ ...getNativeNetwork('ethereum'), rpcUrl: 'https://configured.example/rpc' });
const noop = () => undefined;

test('retirement routes use only the captured catalogue and never change the active chain', async () => {
  const context = new AbortController(), aggregate = new AbortController();
  const activeChain = '8453';
  const calls: string[] = [];
  const read: NonNullable<KeyringRuntimeDependencies['readEvmRetirement']> = async (selected, method, _params, _signal, check) => {
    check(); calls.push(`${selected.chainId}:${selected.rpcUrl}:${method}`); return '0x1';
  };
  const registeredBuiltIn = getNativeNetwork('base');
  const registrations = [network, registeredBuiltIn];
  const resolve = createNativeRetirementReadForChain(registrations, read, context.signal, noop);
  registrations[0] = createNativeNetwork({ ...network, rpcUrl: 'https://changed.example/rpc' });
  assert.equal(resolve('999999999', aggregate.signal, noop), null);
  assert.equal(resolve(getNativeNetwork('arbitrum').chainId, aggregate.signal, noop), null);
  assert.deepEqual(calls, []);
  const configured = resolve('1', aggregate.signal, noop)!;
  assert.equal(await configured('eth_chainId', []), '0x1');
  await resolve(registeredBuiltIn.chainId, aggregate.signal, noop)!('eth_chainId', []);
  assert.deepEqual(calls, [
    `1:${network.rpcUrl}:eth_chainId`,
    `${registeredBuiltIn.chainId}:${registeredBuiltIn.rpcUrl}:eth_chainId`,
  ]);
  assert.equal(activeChain, '8453');
  assert.equal(getEventListeners(context.signal, 'abort').length, 0);
  assert.equal(getEventListeners(aggregate.signal, 'abort').length, 0);
});

test('retirement reads reject a replaced catalogue or active owner before publishing a result', async () => {
  for (const change of ['catalogue', 'active chain'] as const) {
    const context = new AbortController(), aggregate = new AbortController();
    const capturedCatalogue = {}, capturedChain = '8453';
    let catalogue = capturedCatalogue, chain = capturedChain;
    let finish!: () => void;
    const read: NonNullable<KeyringRuntimeDependencies['readEvmRetirement']> = async () => {
      await new Promise<void>((resolve) => { finish = resolve; }); return '0x1';
    };
    const resolve = createNativeRetirementReadForChain([network], read, context.signal, () => {
      if (catalogue !== capturedCatalogue || chain !== capturedChain) throw new Error('revoked owner');
    });
    const pending = resolve('1', aggregate.signal, noop)!('eth_chainId', []);
    if (change === 'catalogue') catalogue = {};
    else chain = '1';
    finish();
    await assert.rejects(pending, /revoked owner/);
    assert.equal(getEventListeners(context.signal, 'abort').length, 0);
    assert.equal(getEventListeners(aggregate.signal, 'abort').length, 0);
  }
});

for (const first of ['context', 'aggregate'] as const) test(`retirement transport aborts when ${first} expires first and removes both listeners`, async () => {
  const context = new AbortController(), aggregate = new AbortController();
  let observedAbort = false;
  const read: NonNullable<KeyringRuntimeDependencies['readEvmRetirement']> = (_network, _method, _params, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { observedAbort = true; reject(new Error('transport aborted')); }, { once: true });
  });
  const resolve = createNativeRetirementReadForChain([network], read, context.signal, noop);
  const reader = resolve('1', aggregate.signal, noop)!;
  const pending = reader('eth_chainId', []);
  assert.equal(getEventListeners(context.signal, 'abort').length, 1);
  assert.equal(getEventListeners(aggregate.signal, 'abort').length, 1);
  (first === 'context' ? context : aggregate).abort();
  await assert.rejects(pending, /transport aborted/);
  assert.equal(observedAbort, true);
  assert.equal(getEventListeners(context.signal, 'abort').length, 0);
  assert.equal(getEventListeners(aggregate.signal, 'abort').length, 0);
  (first === 'context' ? aggregate : context).abort();
  await assert.rejects(reader('eth_chainId', []), { code: 'CANCELLED' });
});

test('retirement checks the aggregate guard even when no configured route exists', () => {
  const resolve = createNativeRetirementReadForChain([network], async () => { throw new Error('unexpected read'); }, new AbortController().signal, noop);
  assert.throws(() => resolve('999999999', new AbortController().signal, () => { throw new Error('expired aggregate'); }), /expired aggregate/);
});
